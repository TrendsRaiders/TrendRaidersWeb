// Bigfoot: Take Two, deterministic one-button timing rules. Pure logic: no DOM, no randomness, no wall clock.
// All times are integer microseconds of ACTIVE simulation time (intro, pauses and hidden time never count), so the
// table values (1.80 s, 0.26 s ...) are exact and results never depend on frame rate. See docs/bigfoot-take-two.md.

export const US = 1_000_000;
export const CFG = Object.freeze({
  rollingUs: 650_000, // stationary lead-in per shot; POSE is ignored (not queued)
  walkUs: 3_200_000, // walking time from the left mark to the right mark
  resultUs: 900_000, // shot_result feedback
  xStart: 0.08, // footpoint x at t=0, fraction of arena width
  xSpan: 0.84, // x(t) = xStart + xSpan * t / walkUs
  shots: 5,
  usableGoal: 4,
  missLimit: 2,
  maxFrameGapUs: 250_000, // a longer foreground gap pauses instead of simulating (controller / ActiveClock)
});

/** Per-shot target centre `c` and inclusive half-window `w` (microseconds). A pose succeeds when |t-c| <= w. */
export const SHOTS = Object.freeze([
  { n: 1, cUs: 1_800_000, wUs: 260_000 },
  { n: 2, cUs: 2_250_000, wUs: 230_000 },
  { n: 3, cUs: 1_550_000, wUs: 210_000 },
  { n: 4, cUs: 2_050_000, wUs: 190_000 },
  { n: 5, cUs: 1_700_000, wUs: 180_000 },
].map((s) => Object.freeze(s)));

/** Footpoint x as a fraction of arena width at walking time t (microseconds). Same path every shot. */
export const footX = (tUs) => CFG.xStart + CFG.xSpan * (tUs / CFG.walkUs);
/** Normalized x of a shot's centre tape and the two ends of its usable strip. */
export function targetSpan(shotIndex) {
  const s = SHOTS[shotIndex];
  return { centre: footX(s.cUs), left: footX(s.cUs - s.wUs), right: footX(s.cUs + s.wUs) };
}

/** @typedef {'usable'|'early'|'late'|'missed'} ShotKind */
/** @typedef {{ shot: number, kind: ShotKind, tUs: number, deltaUs: number|null }} ShotResult */
/** @typedef {{ type: 'walk'|'shot'|'next'|'won'|'lost', shot?: number, result?: ShotResult, atUs: number }} TakeEvent */

export const RESULT_TEXT = Object.freeze({
  usable: 'Usable',
  early: 'Too early',
  late: 'Too late',
  missed: 'Missed the mark',
});

export class Take {
  /** @type {'intro'|'rolling'|'walking'|'shot_result'|'lost'|'won'} */
  state = 'intro';
  shot = 1;
  usable = 0;
  misses = 0;
  /** active time inside the current phase */
  phaseUs = 0;
  /** active time since Start */
  totalUs = 0;
  /** @type {ShotResult|null} */
  result = null;
  /** @type {ShotResult[]} one entry per consumed shot, in order */
  photos = [];
  /** @type {TakeEvent[]} */
  events = [];

  constructor() { this.reset(); }

  reset() {
    this.state = 'intro';
    this.shot = 1;
    this.usable = 0;
    this.misses = 0;
    this.phaseUs = 0;
    this.totalUs = 0;
    this.result = null;
    this.photos = [];
    this.events = [];
  }

  /** Start (or restart after reset): usable=0, shot=1, no stored input, stationary rolling lead-in. */
  begin() {
    if (this.state !== 'intro') return;
    this.state = 'rolling';
    this.phaseUs = 0;
  }

  get over() { return this.state === 'won' || this.state === 'lost'; }
  get current() { return SHOTS[this.shot - 1]; }
  /** Walking time of the footpoint, or 0 outside walking. */
  get walkUsNow() { return this.state === 'walking' ? this.phaseUs : 0; }

  /** Deadline phase time: the last instant at which a pose still counts as a hit. */
  get deadlineUs() { return this.current.cUs + this.current.wUs; }

  /** Advance by dtUs of active time. Phase changes land exactly on their boundaries; leftover time carries over. */
  advance(dtUs) { this.#run(this.totalUs + Math.max(0, Math.round(dtUs)), false); }

  /** Advance to the absolute active time `toUs` (never backwards). */
  advanceTo(toUs) { this.#run(Math.max(this.totalUs, Math.round(toUs)), false); }

  /**
   * Consume one fresh POSE activation that happened at absolute active time `atUs`. Time up to the event (including
   * the exact c+w boundary) is simulated first WITHOUT the overdue timeout, so an event at exactly c+w succeeds
   * whatever the frame/batch order. An event after c+w that the simulation had not yet timed out is "Too late".
   * Returns the shot result, or null when the input is ignored (not walking, or the shot is already consumed).
   * @returns {ShotResult|null}
   */
  poseAt(atUs) {
    const at = Math.max(this.totalUs, Math.round(atUs));
    this.#run(at, true);
    if (this.state !== 'walking') return null;
    const tUs = this.phaseUs + (at - this.totalUs);
    this.totalUs = at;
    return this.#consume(tUs);
  }

  /** Pose at the current instant. */
  pose() { return this.poseAt(this.totalUs); }

  // ---- internals -------------------------------------------------------------------------------
  /** @param {number} target @param {boolean} holdTimeout when true the walking phase stops at c+w instead of timing out */
  #run(target, holdTimeout) {
    let guard = 0;
    while (this.totalUs < target && !this.over && this.state !== 'intro' && guard++ < 64) {
      const left = target - this.totalUs;
      if (this.state === 'rolling') {
        const need = CFG.rollingUs - this.phaseUs;
        if (left < need) { this.phaseUs += left; this.totalUs = target; return; }
        this.totalUs += need;
        this.state = 'walking';
        this.phaseUs = 0;
        this.events.push({ type: 'walk', shot: this.shot, atUs: this.totalUs });
      } else if (this.state === 'walking') {
        // the first instant strictly after c+w is the overdue timeout
        const dead = this.deadlineUs;
        if (holdTimeout) {
          const room = dead - this.phaseUs;
          if (left <= room) { this.phaseUs += left; this.totalUs = target; return; }
          this.phaseUs = dead; this.totalUs += Math.max(0, room);
          return; // caller decides what happens beyond c+w
        }
        const need = dead + 1 - this.phaseUs;
        if (left < need) { this.phaseUs += left; this.totalUs = target; return; }
        this.totalUs += need;
        this.phaseUs = dead + 1;
        this.#consume(dead + 1, 'missed');
      } else if (this.state === 'shot_result') {
        const need = CFG.resultUs - this.phaseUs;
        if (left < need) { this.phaseUs += left; this.totalUs = target; return; }
        this.totalUs += need;
        this.#evaluate();
      } else return;
    }
  }

  /** @param {number} tUs @param {'missed'} [forced] */
  #consume(tUs, forced) {
    const s = this.current;
    const delta = forced ? null : tUs - s.cUs;
    /** @type {ShotKind} */
    let kind;
    if (forced) kind = forced;
    else if (Math.abs(tUs - s.cUs) <= s.wUs) kind = 'usable';
    else if (tUs < s.cUs) kind = 'early';
    else kind = 'late';
    if (kind === 'usable') this.usable += 1; else this.misses += 1;
    this.result = { shot: this.shot, kind, tUs, deltaUs: delta };
    this.photos.push(this.result);
    this.state = 'shot_result';
    this.phaseUs = 0;
    this.events.push({ type: 'shot', shot: this.shot, result: this.result, atUs: this.totalUs });
    return this.result;
  }

  #evaluate() {
    this.phaseUs = 0;
    if (this.usable >= CFG.usableGoal) { this.state = 'won'; this.events.push({ type: 'won', atUs: this.totalUs }); return; }
    if (this.misses >= CFG.missLimit) { this.state = 'lost'; this.events.push({ type: 'lost', atUs: this.totalUs }); return; }
    this.shot += 1; // never beyond 5: usable+misses = shots played, and 4 usable or 2 misses always ends by shot 5
    this.state = 'rolling';
    this.events.push({ type: 'next', shot: this.shot, atUs: this.totalUs });
  }
}

/**
 * Translates monotonic browser timestamps (rAF / event.timeStamp, milliseconds) into the active simulation clock.
 * Time only accumulates through `frame()`; pausing, hiding or stopping simply stops calling it and calls `rebase()`.
 * A foreground gap above maxFrameGapUs reports a stall instead of advancing, so the caller can auto-pause.
 */
export class ActiveClock {
  activeUs = 0;
  lastStampMs = /** @type {number|null} */ (null);

  /** Resume counting from `stampMs` (after Start/Resume): the paused interval is never added. */
  rebase(stampMs) { this.lastStampMs = stampMs; }
  stop() { this.lastStampMs = null; }
  reset() { this.activeUs = 0; this.lastStampMs = null; }

  /** @returns {{ ok: true, dtUs: number, activeUs: number } | { ok: false, stall: true, gapUs: number }} */
  frame(stampMs) {
    if (this.lastStampMs === null) { this.lastStampMs = stampMs; return { ok: true, dtUs: 0, activeUs: this.activeUs }; }
    const gapUs = Math.round(Math.max(0, stampMs - this.lastStampMs) * 1000);
    if (gapUs > CFG.maxFrameGapUs) { this.lastStampMs = stampMs; return { ok: false, stall: true, gapUs }; }
    this.lastStampMs = stampMs;
    this.activeUs += gapUs;
    return { ok: true, dtUs: gapUs, activeUs: this.activeUs };
  }

  /**
   * Active time of an input stamped `eventMs`. Call BEFORE `frame()` for the frame that will consume the input: the
   * clock still holds the previous frame's stamp, so the event lands between that frame and the next one.
   */
  toActive(eventMs) {
    if (this.lastStampMs === null) return this.activeUs;
    return this.activeUs + Math.max(0, Math.round((eventMs - this.lastStampMs) * 1000));
  }
}

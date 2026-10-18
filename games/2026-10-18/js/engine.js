// Fly the Simulation: deterministic course and collision rules. Pure logic, no DOM, no randomness, no wall clock.
// Time is an integer number of microseconds so every table value (3.6 s, 2.4 s, 0.14 s ...) is exact.
// Arena coordinates are normalized to [0,1]; y=0 is the top. See docs/fly-the-simulation.md.

export const US = 1_000_000;
export const CFG = Object.freeze({
  flyX: 0.23,
  startY: 0.5,
  speed: 0.52, // arena heights per second, immediate start/stop
  yMin: 0.06,
  yMax: 0.94,
  rx: 0.018, // fly collision half-extents (axis-aligned core)
  ry: 0.025,
  wallHalf: 0.024,
  gapHalf: 0.14, // opening full height 0.28
  wallSpeed: 0.3, // arena widths per second
  previewLeadUs: 2_400_000, // recompile preview visible from T-2.4 s ...
  commitLeadUs: 1_400_000, // ... until T-1.4 s, when the final opening becomes real
  overlapUs: 140_000, // (0.024+0.018)/0.30 = 0.14 s either side of arrival
  durationUs: 20 * US,
  maxStepUs: 8333, // <= 1/120 s
  maxFrameGapUs: 100_000, // a longer foreground gap pauses instead of simulating (controller)
  eps: 1e-9, // float tolerance: equality at an opening edge is safe, any real penetration loses
});

/** @type {readonly {n:number, arrivalUs:number, kind:'normal'|'recompile', initial:number, final:number}[]} */
export const SEAMS = Object.freeze([
  { n: 1, arrivalUs: 3_600_000, kind: 'normal', initial: 0.5, final: 0.5 },
  { n: 2, arrivalUs: 6_000_000, kind: 'recompile', initial: 0.25, final: 0.75 },
  { n: 3, arrivalUs: 8_400_000, kind: 'normal', initial: 0.25, final: 0.25 },
  { n: 4, arrivalUs: 10_800_000, kind: 'recompile', initial: 0.25, final: 0.75 },
  { n: 5, arrivalUs: 13_200_000, kind: 'normal', initial: 0.25, final: 0.25 },
  { n: 6, arrivalUs: 15_600_000, kind: 'recompile', initial: 0.75, final: 0.25 },
  { n: 7, arrivalUs: 18_000_000, kind: 'normal', initial: 0.75, final: 0.75 },
]);
export const SEAM_COUNT = SEAMS.length;
export const CLEARED_AT_US = (i) => SEAMS[i].arrivalUs + CFG.overlapUs; // cleared once t is strictly greater
export const COMMIT_US = (i) => SEAMS[i].arrivalUs - CFG.commitLeadUs;
export const PREVIEW_US = (i) => SEAMS[i].arrivalUs - CFG.previewLeadUs;
/** Palette index (garden, wireframe, desktop tiles, glitched garden) = number of commits that have happened. */
export const PALETTE_NAMES = Object.freeze(['garden', 'wireframe', 'desktop', 'glitch']);

/** Sorted, unique instants at which the simulation must land exactly (events, overlap edges, clear, win). */
export const BOUNDARIES_US = Object.freeze([...new Set([
  CFG.durationUs,
  ...SEAMS.flatMap((s, i) => [
    PREVIEW_US(i), COMMIT_US(i), s.arrivalUs - CFG.overlapUs, s.arrivalUs + CFG.overlapUs, CLEARED_AT_US(i) + 1,
  ]),
])].sort((a, b) => a - b));

/** Opening centre that is solid/collidable at time t (old opening until the commit instant, final from it). */
export function gapCenterAt(seam, tUs) {
  return tUs >= seam.arrivalUs - CFG.commitLeadUs ? seam.final : seam.initial;
}
/** Wall centre x at time t (may be off-screen). */
export function seamX(seam, tUs) { return CFG.flyX + CFG.wallSpeed * ((seam.arrivalUs - tUs) / US); }
/** True when the fly core (centre y) lies fully inside an opening centred at `center`. Equality is safe. */
export function fitsGap(y, center) {
  return y - CFG.ry >= center - CFG.gapHalf - CFG.eps && y + CFG.ry <= center + CFG.gapHalf + CFG.eps;
}
/** Fly-centre interval that survives an opening centred at `center` (width 0.23). */
export function safeBand(center) {
  return [center - CFG.gapHalf + CFG.ry, center + CFG.gapHalf - CFG.ry];
}

/**
 * @typedef {{type:'preview'|'commit'|'clear'|'win'|'lose', seam?:number, tUs:number}} SimEvent
 * @typedef {{tUs:number, seam:number, flyX:number, flyY:number, wallX:number, gapCenter:number}} Collision
 */
export class Sim {
  /** @type {'ready'|'running'|'won'|'lost'} */
  status = 'ready';
  tUs = 0;
  y = /** @type {number} */ (CFG.startY);
  dir = 0; // -1 up, +1 down
  cleared = 0;
  commits = 0;
  previewed = 0;
  /** @type {SimEvent[]} */
  events = [];
  /** @type {Collision|null} */
  collision = null;

  constructor() { this.reset(); }

  reset() {
    this.status = 'ready';
    this.tUs = 0;
    this.y = CFG.startY;
    this.dir = 0;
    this.cleared = 0;
    this.commits = 0;
    this.previewed = 0;
    this.events = [];
    this.collision = null;
  }

  get t() { return this.tUs / US; }
  get over() { return this.status === 'won' || this.status === 'lost'; }

  /** Begin the clock (the controller calls this once Start's activating input has been released). */
  begin() { if (this.status === 'ready') this.status = 'running'; }

  /** Both directions together cancel; neutral holds altitude. */
  setHeld(up, down) { this.dir = (down ? 1 : 0) - (up ? 1 : 0); }
  clearHeld() { this.dir = 0; }

  /** Advance by dt seconds (rounded to whole microseconds) in fixed steps, splitting at every boundary. */
  advance(dtSeconds) { this.advanceUs(Math.round(dtSeconds * US)); }

  advanceUs(totalUs) {
    let left = Math.max(0, Math.floor(totalUs));
    while (left > 0 && this.status === 'running') {
      let step = Math.min(left, CFG.maxStepUs);
      const next = BOUNDARIES_US.find((b) => b > this.tUs);
      if (next !== undefined) step = Math.min(step, next - this.tUs);
      this.y = Math.min(CFG.yMax, Math.max(CFG.yMin, this.y + this.dir * CFG.speed * (step / US)));
      this.tUs += step;
      left -= step;
      this.#settle();
    }
  }

  #settle() {
    const t = this.tUs;
    // 1. collision: inside either wall's horizontal overlap the core must fit the currently solid opening
    for (let i = 0; i < SEAMS.length; i++) {
      const s = SEAMS[i];
      if (Math.abs(t - s.arrivalUs) > CFG.overlapUs) continue;
      const center = gapCenterAt(s, t);
      if (!fitsGap(this.y, center)) {
        this.status = 'lost';
        this.dir = 0;
        this.collision = { tUs: t, seam: i + 1, flyX: CFG.flyX, flyY: this.y, wallX: seamX(s, t), gapCenter: center };
        this.events.push({ type: 'lose', seam: i + 1, tUs: t });
        return;
      }
    }
    // 2. announcements and credit, each exactly once and in course order
    while (this.previewed < SEAMS.length && t >= PREVIEW_US(this.previewed)) {
      if (SEAMS[this.previewed].kind === 'recompile') this.events.push({ type: 'preview', seam: this.previewed + 1, tUs: t });
      this.previewed++;
    }
    while (this.commits < SEAMS.length && t >= COMMIT_US(this.commits)) {
      if (SEAMS[this.commits].kind === 'recompile') this.events.push({ type: 'commit', seam: this.commits + 1, tUs: t });
      this.commits++;
    }
    while (this.cleared < SEAMS.length && t > CLEARED_AT_US(this.cleared)) {
      this.cleared++;
      this.events.push({ type: 'clear', seam: this.cleared, tUs: t });
    }
    // 3. victory only after all seven are cleared while alive
    if (t >= CFG.durationUs && this.cleared === SEAMS.length) {
      this.status = 'won';
      this.dir = 0;
      this.events.push({ type: 'win', tUs: t });
    }
  }

  /** Number of recompile commits so far (selects the scenery palette). */
  get paletteIndex() {
    let n = 0;
    for (let i = 0; i < SEAMS.length; i++) if (SEAMS[i].kind === 'recompile' && this.tUs >= COMMIT_US(i)) n++;
    return n;
  }

  /** Render/query view of every wall that is on screen (or about to be). */
  seamViews() {
    const t = this.tUs;
    return SEAMS.map((s, i) => {
      const x = seamX(s, t);
      const committed = t >= COMMIT_US(i);
      const previewing = s.kind === 'recompile' && t >= PREVIEW_US(i) && !committed;
      return {
        index: i, n: s.n, kind: s.kind, x,
        visible: x + CFG.wallHalf > 0 && x - CFG.wallHalf < 1,
        center: gapCenterAt(s, t), oldCenter: s.initial, newCenter: s.final,
        previewing, committed, cleared: i < this.cleared,
        commitAgeUs: s.kind === 'recompile' && committed ? t - COMMIT_US(i) : -1,
      };
    });
  }

  /** Banana: appears once seam 7 is clear and reaches the fly exactly at t=20 s, sliding to the fly's height. */
  banana() {
    const from = CLEARED_AT_US(SEAMS.length - 1);
    if (this.tUs <= from) return { visible: false, x: 1.06, y: 0.5, p: 0 };
    const p = Math.min(1, (this.tUs - from) / (CFG.durationUs - from));
    return { visible: true, x: 1.06 + (CFG.flyX - 1.06) * p, y: 0.5 + (this.y - 0.5) * p, p };
  }
}

/**
 * Optional reference route for scripted/automated wins and the paper walkthrough: the fly-centre target at time t.
 * It follows OLD→FINAL openings only after the commit (never the tempting old gap) and otherwise holds the band centre.
 */
export function routeTarget(tUs) {
  for (let i = 0; i < SEAMS.length; i++) {
    const s = SEAMS[i];
    // aim at the opening that will be solid at contact, starting once the previous seam is behind us
    const prevEnd = i === 0 ? 0 : SEAMS[i - 1].arrivalUs + CFG.overlapUs;
    if (tUs <= s.arrivalUs + CFG.overlapUs && tUs >= prevEnd - 1) return s.final;
  }
  return 0.5;
}

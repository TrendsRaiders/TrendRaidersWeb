// Deterministic combat simulation for 30-Second KO (spec r3, combat constants unchanged from r2).
// Pure logic: no DOM, no wall clock. All times are active-simulation milliseconds.

export const C = Object.freeze({
  DEADLINE: 30000,
  START_HP: 100,
  PUNCH_STARTUP: 100,
  PUNCH_TOTAL: 500,
  PUNCH_DAMAGE: 3,
  COUNTER_DAMAGE: 20,
  ENEMY_DAMAGE_UNGUARDED: 22,
  ENEMY_DAMAGE_GUARDED: 4,
  STUN: 400,
  WINDUP: 600,
  RECOVERY: 650,
  FIRST_WINDUP: 800,
  IDLE_GAPS: Object.freeze([650, 850, 450]),
});

// Equal-timestamp order: deadline, enemy strike, player impact, cosmetics.
const PRIORITY = { deadline: 0, strike: 1, impact: 2, windup: 3, 'recovery-end': 3 };

/**
 * @typedef {{ t: number, type: string, [key: string]: any }} SimEvent
 * @typedef {{ outcome: 'win'|'loss'|'draw', reason: 'ko'|'timeout'|'double-ko', t: number,
 *   hundredths: number, playerHp: number, enemyHp: number }} SimResult
 */

const clampHp = (v) => Math.max(0, Math.min(C.START_HP, v));

export class Sim {
  /** @param {{ ai?: boolean, playerHp?: number, enemyHp?: number }} [opts] ai:false and hp are test fixtures. */
  constructor(opts = {}) {
    this.now = 0;
    this.playerHp = clampHp(opts.playerHp ?? C.START_HP);
    this.enemyHp = clampHp(opts.enemyHp ?? C.START_HP);
    /** @type {SimResult|null} */
    this.result = null;
    /** @type {SimEvent[]} */
    this.events = [];
    this.guardHeld = false;
    this.stunUntil = 0;
    /** @type {{start:number, impactAt:number, end:number, landed:boolean}|null} */
    this.action = null;
    /** @type {{start:number, end:number, used:boolean}|null} */
    this.opportunity = null;
    this.aiEnabled = opts.ai !== false;
    this.strikeCount = 0;
    /** @type {{t:number, type:string}|null} */
    this.aiNext = this.aiEnabled ? { t: C.FIRST_WINDUP, type: 'windup' } : null;
    this.aiPhase = 'idle';
    this.windupStart = 0;
    this.lastStrike = -Infinity;
  }

  get over() { return this.result !== null; }
  get remainingSeconds() { return Math.max(0, Math.ceil((C.DEADLINE - this.now) / 1000)); }

  /** Guard effective now: held, not stunned, not mid-action (including startup). */
  guardEffective(t = this.now) {
    return this.guardHeld && t >= this.stunUntil && !this.actionActive(t);
  }
  actionActive(t = this.now) { return this.action !== null && t < this.action.end; }
  stunned(t = this.now) { return t < this.stunUntil; }
  counterOpen(t = this.now) {
    const o = this.opportunity;
    return !!o && !o.used && t >= o.start && t < o.end;
  }

  /** Process every event due at or before t, chronologically, then set the clock to t. */
  advance(t) {
    this.#process(t, true);
    if (!this.over && t > this.now) this.now = t;
  }

  /** Fresh Punch press at t. Inputs at t apply before combat events at t. Returns whether accepted. */
  punch(t) {
    this.#process(t, false);
    if (this.over) return false;
    this.now = Math.max(this.now, t);
    if (t < this.stunUntil || this.actionActive(t)) return false;
    this.action = { start: t, impactAt: t + C.PUNCH_STARTUP, end: t + C.PUNCH_TOTAL, landed: false };
    this.#log(t, 'punch-start');
    return true;
  }

  setGuard(t, held) {
    this.#process(t, false);
    if (this.over) return;
    this.now = Math.max(this.now, t);
    this.guardHeld = !!held;
  }

  /** Release held inputs (pause, blur, modal...). Does not advance the clock. */
  clearInputs() { this.guardHeld = false; }

  /** Test-only: route damage through the normal KO resolution (e.g. the both-zero fixture). */
  applyDamageForTest(t, toPlayer, toEnemy) { this.#damage(t, toPlayer, toEnemy); }

  /** Render helper: enemy pose at time t. */
  aiView(t = this.now) {
    if (this.aiPhase === 'windup') {
      return { phase: 'windup', progress: Math.min(1, Math.max(0, (t - this.windupStart) / C.WINDUP)) };
    }
    if (this.aiPhase === 'recovery') {
      return { phase: t - this.lastStrike < 150 ? 'strike' : 'recovery', progress: 0 };
    }
    return { phase: 'idle', progress: 0 };
  }

  #nextEvent() {
    /** @type {{t:number, type:string}[]} */
    const c = [{ t: C.DEADLINE, type: 'deadline' }];
    if (this.aiNext) c.push(this.aiNext);
    if (this.action && !this.action.landed) c.push({ t: this.action.impactAt, type: 'impact' });
    c.sort((a, b) => a.t - b.t || PRIORITY[a.type] - PRIORITY[b.type]);
    return c[0];
  }

  #process(limit, inclusive) {
    while (!this.over) {
      const e = this.#nextEvent();
      if (inclusive ? e.t > limit : e.t >= limit) break;
      this.now = Math.max(this.now, e.t);
      if (e.type === 'deadline') this.#deadline(e.t);
      else if (e.type === 'strike') this.#strike(e.t);
      else if (e.type === 'impact') this.#impact(e.t);
      else this.#cosmetic(e);
    }
  }

  #log(t, type, extra = {}) { this.events.push({ t, type, ...extra }); }

  #deadline(t) {
    this.#end(t, { outcome: 'draw', reason: 'timeout' });
  }

  #cosmetic(e) {
    if (e.type === 'windup') {
      this.aiPhase = 'windup';
      this.windupStart = e.t;
      this.aiNext = { t: e.t + C.WINDUP, type: 'strike' };
      this.#log(e.t, 'windup');
    } else {
      this.aiPhase = 'idle';
      const gap = C.IDLE_GAPS[(this.strikeCount - 1) % C.IDLE_GAPS.length];
      this.aiNext = { t: e.t + gap, type: 'windup' };
      this.#log(e.t, 'recovery-end');
    }
  }

  #strike(t) {
    this.strikeCount += 1;
    this.lastStrike = t;
    this.aiPhase = 'recovery';
    this.aiNext = { t: t + C.RECOVERY, type: 'recovery-end' };
    if (this.guardEffective(t)) {
      this.opportunity = { start: t, end: t + C.RECOVERY, used: false };
      this.#log(t, 'strike', { result: 'block', damage: C.ENEMY_DAMAGE_GUARDED });
      this.#damage(t, C.ENEMY_DAMAGE_GUARDED, 0);
    } else {
      this.opportunity = null;
      this.stunUntil = t + C.STUN;
      if (this.action && !this.action.landed) this.#log(t, 'cancel');
      this.action = null;
      this.#log(t, 'strike', { result: 'hit', damage: C.ENEMY_DAMAGE_UNGUARDED });
      this.#damage(t, C.ENEMY_DAMAGE_UNGUARDED, 0);
    }
  }

  #impact(t) {
    const a = /** @type {NonNullable<typeof this.action>} */ (this.action);
    a.landed = true;
    const o = this.opportunity;
    const counter = !!o && !o.used && t >= o.start && t < o.end;
    if (counter && o) o.used = true;
    const damage = counter ? C.COUNTER_DAMAGE : C.PUNCH_DAMAGE;
    this.#log(t, 'impact', { damage, counter });
    this.#damage(t, 0, damage);
  }

  #damage(t, toPlayer, toEnemy) {
    this.playerHp = clampHp(this.playerHp - toPlayer);
    this.enemyHp = clampHp(this.enemyHp - toEnemy);
    if (this.playerHp === 0 && this.enemyHp === 0) this.#end(t, { outcome: 'draw', reason: 'double-ko' });
    else if (this.enemyHp === 0) this.#end(t, { outcome: 'win', reason: 'ko' });
    else if (this.playerHp === 0) this.#end(t, { outcome: 'loss', reason: 'ko' });
  }

  #end(t, partial) {
    this.guardHeld = false;
    this.result = {
      ...partial,
      t,
      hundredths: Math.floor(t / 10),
      playerHp: this.playerHp,
      enemyHp: this.enemyHp,
    };
    this.#log(t, 'end', { outcome: partial.outcome, reason: partial.reason });
  }
}

/** Integer hundredths -> "9.10". */
export function formatHundredths(h) {
  return `${Math.floor(h / 100)}.${String(h % 100).padStart(2, '0')}`;
}

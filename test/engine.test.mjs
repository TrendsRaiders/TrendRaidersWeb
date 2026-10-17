import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, C, formatHundredths } from '../games/2026-10-17/js/engine.js';

/** Drive a Sim with a time-ordered script of [t, 'guard'|'release'|'punch'] inputs, then advance to `until`. */
function run(script, until, opts) {
  const sim = new Sim(opts);
  for (const [t, kind] of [...script].sort((a, b) => a[0] - b[0])) {
    if (kind === 'guard') sim.setGuard(t, true);
    else if (kind === 'release') sim.setGuard(t, false);
    else sim.punch(t);
  }
  sim.advance(until);
  return sim;
}
const strikes = (sim) => sim.events.filter((e) => e.type === 'strike');

test('constants match the accepted r3 spec', () => {
  assert.equal(C.DEADLINE, 30000);
  assert.deepEqual([C.PUNCH_STARTUP, C.PUNCH_TOTAL, C.PUNCH_DAMAGE, C.COUNTER_DAMAGE], [100, 500, 3, 20]);
  assert.deepEqual([C.ENEMY_DAMAGE_UNGUARDED, C.ENEMY_DAMAGE_GUARDED, C.STUN], [22, 4, 400]);
  assert.deepEqual([C.WINDUP, C.RECOVERY, C.FIRST_WINDUP], [600, 650, 800]);
  assert.deepEqual([...C.IDLE_GAPS], [650, 850, 450]);
});

test('1. fresh sim: no advancement without clock, 100/100 and 30s', () => {
  const sim = new Sim();
  assert.deepEqual([sim.playerHp, sim.enemyHp, sim.now, sim.remainingSeconds], [100, 100, 0, 30]);
  assert.equal(sim.events.length, 0);
});

test('1. AI strike schedule is identical across rendering rates', () => {
  const expected = [1400, 3300, 5400, 7100, 9000, 11100];
  for (const step of [1, 7, 16.67, 33, 250, 1000, 12345]) {
    const sim = new Sim();
    sim.setGuard(0, true); // stay alive: guarded strikes only
    for (let t = step; t < 12000 + step; t += step) sim.advance(t);
    assert.deepEqual(strikes(sim).map((e) => e.t).slice(0, 6), expected, `step ${step}`);
    assert.deepEqual(sim.events.filter((e) => e.type === 'windup').map((e) => e.t).slice(0, 3), [800, 2700, 4800]);
  }
});

test('1. late frame processes all due events chronologically up to terminal', () => {
  const sim = new Sim();
  sim.advance(60000);
  assert.equal(sim.result.outcome, 'loss'); // no guard: loses on the 5th strike
  assert.equal(sim.result.t, 9000);
  assert.equal(sim.now, 9000);
  assert.deepEqual(strikes(sim).map((e) => e.t), [1400, 3300, 5400, 7100, 9000]);
});

test('2. guard at 1399: strike 1400 leaves 96 HP; punch 1401 counters for 20 at 1501', () => {
  const sim = run([[1399, 'guard'], [1401, 'punch']], 1600);
  assert.equal(sim.playerHp, 96);
  assert.equal(sim.enemyHp, 80);
  assert.deepEqual(sim.events.find((e) => e.type === 'impact'), { t: 1501, type: 'impact', damage: 20, counter: true });
  assert.equal(sim.stunned(1500), false);
});

test('2. second impact in same window is 3, not 20', () => {
  // Punch 1401 (impact 1501), next punch allowed at 1901 (impact 2001) still inside [1400, 2050).
  const sim = run([[1399, 'guard'], [1401, 'punch'], [1901, 'punch']], 2100);
  const impacts = sim.events.filter((e) => e.type === 'impact');
  assert.deepEqual(impacts.map((e) => [e.t, e.damage, e.counter]), [[1501, 20, true], [2001, 3, false]]);
  assert.equal(sim.enemyHp, 77);
});

test('3. no guard at 1400: 78 HP, stun to 1800, no counter, stunned input ignored', () => {
  const sim = new Sim();
  sim.advance(1400);
  assert.equal(sim.playerHp, 78);
  assert.equal(sim.stunUntil, 1800);
  assert.equal(sim.counterOpen(1500), false);
  assert.equal(sim.punch(1500), false);
  assert.equal(sim.punch(1799), false);
  assert.equal(sim.punch(1800), true);
  sim.advance(1900);
  assert.equal(sim.events.find((e) => e.type === 'impact').damage, 3);
});

test('3. pending impact at 1400 is canceled by the unguarded strike and never lands later', () => {
  const sim = run([[1300, 'punch']], 3000);
  assert.equal(sim.events.some((e) => e.type === 'impact'), false);
  assert.equal(sim.events.some((e) => e.type === 'cancel'), true);
  assert.equal(sim.enemyHp, 100);
  assert.equal(sim.playerHp, 78);
});

test('4. guard held + punch 1350: impact 1450 canceled by unguarded strike 1400', () => {
  const sim = run([[0, 'guard'], [1350, 'punch']], 2000);
  assert.equal(sim.playerHp, 78);
  assert.equal(sim.enemyHp, 100);
  assert.equal(sim.events.some((e) => e.type === 'impact'), false);
  assert.equal(strikes(sim)[0].result, 'hit');
});

test('4. punch at 1400 (input before combat) prevents block despite held guard', () => {
  const sim = run([[0, 'guard'], [1400, 'punch']], 1600);
  assert.equal(sim.playerHp, 78);
  assert.equal(strikes(sim)[0].result, 'hit');
  assert.equal(sim.events.some((e) => e.type === 'impact'), false);
});

test('4. guard pressed at exactly 1400 counts (input before combat)', () => {
  const sim = run([[1400, 'guard']], 1401);
  assert.equal(sim.playerHp, 96);
});

test('5. counter window: impact 2049 qualifies, 2050 deals 3 (independent fixtures)', () => {
  const a = run([[0, 'guard'], [1949, 'punch']], 2100);
  assert.deepEqual(a.events.find((e) => e.type === 'impact'), { t: 2049, type: 'impact', damage: 20, counter: true });
  const b = run([[0, 'guard'], [1950, 'punch']], 2100);
  assert.deepEqual(b.events.find((e) => e.type === 'impact'), { t: 2050, type: 'impact', damage: 3, counter: false });
});

test('5. opportunity cannot be reused and a new block creates a new one', () => {
  const sim = run([[0, 'guard'], [1401, 'punch'], [2000, 'punch'], [3301, 'punch']], 3500);
  const dmg = sim.events.filter((e) => e.type === 'impact').map((e) => e.damage);
  assert.deepEqual(dmg, [20, 3, 20]);
});

test('normal and counter hits do not interrupt AI timing', () => {
  const sim = run([[0, 'guard'], [700, 'punch']], 6000);
  assert.deepEqual(strikes(sim).map((e) => e.t), [1400, 3300, 5400]);
});

test('punch while already punching is ignored; guard suppressed during the whole action', () => {
  const sim = new Sim({ ai: false });
  sim.setGuard(0, true);
  assert.equal(sim.punch(100), true);
  assert.equal(sim.guardEffective(100), false);
  assert.equal(sim.guardEffective(599), false);
  assert.equal(sim.punch(300), false);
  assert.equal(sim.guardEffective(600), true); // held guard resumes at action end
  assert.equal(sim.punch(599), false);
  assert.equal(sim.punch(600), true);
});

test('held guard becomes effective only after stun', () => {
  const sim = new Sim();
  sim.setGuard(0, true);
  sim.punch(1300); // unguarded strike 1400 stuns until 1800
  sim.advance(1500);
  assert.equal(sim.guardEffective(1500), false);
  assert.equal(sim.guardEffective(1800), true);
});

test('equal timestamp: unguarded strike cancels coincident impact', () => {
  const sim = new Sim();
  sim.punch(1300); // impact would be exactly 1400, same timestamp as the strike
  sim.advance(1400);
  assert.equal(sim.events.some((e) => e.type === 'impact'), false);
  assert.equal(sim.enemyHp, 100);
});

test('a punch in progress at the strike is unguarded even with guard held', () => {
  const sim = new Sim();
  sim.setGuard(0, true);
  sim.punch(1300); // punching suppresses guard -> unguarded; impact canceled
  sim.advance(1500);
  assert.equal(sim.playerHp, 78);
});

test('6. walkthrough: five counters win at 9,101 ms (9.10s), player 80 HP', () => {
  const punches = [1401, 3301, 5401, 7101, 9001];
  const sim = run([[0, 'guard'], ...punches.map((t) => [t, 'punch'])], 12000);
  assert.deepEqual(sim.result, { outcome: 'win', reason: 'ko', t: 9101, hundredths: 910, playerHp: 80, enemyHp: 0 });
  assert.equal(formatHundredths(sim.result.hundredths), '9.10');
  assert.equal(sim.now, 9101);
});

test('6. never-guard punch spam loses at 9,000', () => {
  const sim = new Sim();
  let t = 0;
  while (!sim.over && t < 40000) { sim.punch(t); t += 20; sim.advance(t); }
  assert.equal(sim.result.outcome, 'loss');
  assert.equal(sim.result.t, 9000);
  assert.ok(sim.enemyHp > 0);
});

test('7. guard-only reaches timeout draw regardless of health difference', () => {
  const sim = run([[0, 'guard']], 31000);
  assert.equal(sim.result.outcome, 'draw');
  assert.equal(sim.result.reason, 'timeout');
  assert.equal(sim.result.t, 30000);
  assert.ok(sim.playerHp < sim.enemyHp);
  assert.equal(sim.remainingSeconds, 0);
});

test('7. no-damage 100/100 fixture draws; ahead on health still draws', () => {
  const idle = new Sim({ ai: false });
  idle.advance(30000);
  assert.deepEqual([idle.result.outcome, idle.playerHp, idle.enemyHp], ['draw', 100, 100]);
  const ahead = new Sim({ ai: false, playerHp: 100, enemyHp: 1 });
  ahead.advance(30000);
  assert.equal(ahead.result.outcome, 'draw');
});

test('7. impact at 29,999 may win; impact at 30,000 never lands', () => {
  const win = new Sim({ ai: false, enemyHp: 3 });
  win.punch(29899);
  win.advance(30000);
  assert.equal(win.result.outcome, 'win');
  assert.equal(win.result.t, 29999);
  assert.equal(win.result.hundredths, 2999);

  const late = new Sim({ ai: false, enemyHp: 3 });
  late.punch(29900);
  late.advance(31000);
  assert.equal(late.result.outcome, 'draw');
  assert.equal(late.enemyHp, 3);
});

test('7. no damage at or after 30,000 and inputs after terminal are ignored', () => {
  const sim = new Sim({ ai: false });
  sim.advance(30000);
  assert.equal(sim.punch(30001), false);
  sim.setGuard(30001, true);
  assert.equal(sim.guardHeld, false);
});

test('7. both-zero terminal fixture is a Double KO draw', () => {
  const sim = new Sim({ ai: false });
  sim.applyDamageForTest(500, 100, 100);
  assert.deepEqual([sim.result.outcome, sim.result.reason], ['draw', 'double-ko']);
});

test('player KO and enemy KO stop immediately', () => {
  const sim = new Sim({ ai: true, playerHp: 4 });
  sim.setGuard(0, true);
  sim.advance(1400);
  assert.equal(sim.result.outcome, 'loss');
  sim.advance(5000);
  assert.equal(strikes(sim).length, 1);
});

test('health is clamped to 0..100', () => {
  const sim = new Sim({ ai: false, playerHp: 500, enemyHp: -3 });
  assert.deepEqual([sim.playerHp, sim.enemyHp], [100, 0]);
});

test('8. freeze: pausing means no clock advancement, resume continues from the same sim time', () => {
  // The UI only calls advance() with active time; a paused interval simply produces no calls.
  const sim = new Sim();
  sim.setGuard(0, true);
  sim.advance(1000); // mid wind-up (800..1400)
  assert.equal(sim.aiView(1000).phase, 'windup');
  sim.clearInputs();
  assert.equal(sim.guardHeld, false);
  assert.equal(sim.playerHp, 100);
  // (wall clock passes; nothing is called) -> resumed, guard must be pressed again
  sim.setGuard(1000, true);
  sim.advance(1400);
  assert.equal(sim.playerHp, 96);
});

test('8. cleared guard before strike means the strike is unguarded', () => {
  const sim = new Sim();
  sim.setGuard(0, true);
  sim.advance(1000);
  sim.clearInputs();
  sim.advance(1400);
  assert.equal(sim.playerHp, 78);
});

test('9. retry: a fresh Sim has first strike 1,400, full health and no leaked state', () => {
  for (const finish of [
    () => { const s = new Sim(); s.advance(60000); return s; },
    () => run([[0, 'guard'], [1401, 'punch'], [3301, 'punch'], [5401, 'punch'], [7101, 'punch'], [9001, 'punch']], 10000),
    () => run([[0, 'guard']], 31000),
  ]) {
    assert.ok(finish().over);
    const fresh = new Sim();
    assert.deepEqual([fresh.playerHp, fresh.enemyHp, fresh.now, fresh.guardHeld], [100, 100, 0, false]);
    assert.equal(fresh.action, null);
    assert.equal(fresh.opportunity, null);
    assert.equal(fresh.events.length, 0);
    fresh.advance(1400);
    assert.deepEqual(strikes(fresh).map((e) => e.t), [1400]);
  }
});

test('remaining time is ceiling seconds; KO time floors to hundredths', () => {
  const sim = new Sim({ ai: false });
  sim.advance(1);
  assert.equal(sim.remainingSeconds, 30);
  sim.advance(29001);
  assert.equal(sim.remainingSeconds, 1);
  assert.equal(formatHundredths(Math.floor(9109 / 10)), '9.10');
  assert.equal(formatHundredths(5), '0.05');
});

test('input order: advance() includes events at t, punch() excludes them', () => {
  const sim = new Sim();
  sim.setGuard(0, true);
  sim.advance(1400);
  assert.equal(strikes(sim).length, 1); // events at exactly t are due when advancing to t
  const other = new Sim();
  other.setGuard(0, true);
  other.punch(1400);
  assert.equal(strikes(other).length, 0); // ...they are processed after the punch input
  other.advance(1400);
  assert.equal(strikes(other).length, 1);
  assert.equal(strikes(other)[0].result, 'hit');
});

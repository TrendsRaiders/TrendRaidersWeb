// Bigfoot: Take Two engine: exact constants, inclusive boundaries, timeout ordering, 900 ms result, 4/4 + 4/5 wins,
// second-miss loss, no sixth shot, frame-rate independence and the active clock. No DOM, no wall clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Take, ActiveClock, CFG, SHOTS, US, footX, targetSpan } from '../games/2026-10-19/js/engine.js';

/** A started attempt at the first walking instant of the current shot. */
function started() { const t = new Take(); t.begin(); return t; }
const toWalking = (t) => { t.advance(CFG.rollingUs); assert.equal(t.state, 'walking'); };
/** Pose at walking time `w` (microseconds) of the current shot, from its walking onset. */
function poseAtWalk(t, w) { toWalking(t); return t.poseAt(t.totalUs + w); }
/** Run a shot to its end of the result window and let the engine evaluate. */
const finishResult = (t) => t.advance(CFG.resultUs);

test('constants match the spec exactly', () => {
  assert.equal(CFG.rollingUs, 650_000); assert.equal(CFG.walkUs, 3_200_000); assert.equal(CFG.resultUs, 900_000);
  assert.deepEqual(SHOTS.map((s) => s.cUs / US), [1.8, 2.25, 1.55, 2.05, 1.7]);
  assert.deepEqual(SHOTS.map((s) => s.wUs / US), [0.26, 0.23, 0.21, 0.19, 0.18]);
  assert.equal(CFG.shots, 5); assert.equal(CFG.usableGoal, 4); assert.equal(CFG.missLimit, 2);
  assert.ok(Object.isFrozen(SHOTS) && Object.isFrozen(CFG));
});

test('footpoint path x(t) = 0.08 + 0.84 t/3.2 and the target strip maps through the same function', () => {
  assert.equal(footX(0), 0.08);
  assert.ok(Math.abs(footX(CFG.walkUs) - 0.92) < 1e-12);
  assert.ok(Math.abs(footX(1_600_000) - 0.5) < 1e-12);
  SHOTS.forEach((s, i) => {
    const sp = targetSpan(i);
    assert.equal(sp.centre, footX(s.cUs)); assert.equal(sp.left, footX(s.cUs - s.wUs)); assert.equal(sp.right, footX(s.cUs + s.wUs));
    // the visible strip is wide enough at the smallest supported width (320 CSS px, 4 px minimum)
    assert.ok((sp.right - sp.left) * 320 >= 4);
    assert.ok(sp.right < 0.92, 'the whole strip is reached before the walk ends');
  });
});

test('Start: usable 0, shot 1, rolling lead-in is stationary and POSE is ignored (not queued)', () => {
  const t = new Take();
  assert.equal(t.state, 'intro');
  t.advance(5 * US); assert.equal(t.state, 'intro'); assert.equal(t.totalUs, 0, 'the clock does not run in intro');
  assert.equal(t.poseAt(100), null);
  t.begin();
  assert.deepEqual([t.state, t.shot, t.usable, t.misses], ['rolling', 1, 0, 0]);
  assert.equal(t.walkUsNow, 0);
  t.advance(649_999); assert.equal(t.state, 'rolling');
  assert.equal(t.poseAt(t.totalUs), null, 'rolling input is ignored');
  assert.equal(t.state, 'rolling');
  t.advance(1); assert.equal(t.state, 'walking'); assert.equal(t.phaseUs, 0);
  assert.equal(t.usable + t.misses, 0, 'a rolling input left no queued pose');
});

test('inclusive boundaries: c-w, c and c+w succeed; one microsecond outside fails (every shot)', () => {
  SHOTS.forEach((s) => {
    for (const [w, kind] of [[s.cUs - s.wUs, 'usable'], [s.cUs, 'usable'], [s.cUs + s.wUs, 'usable'], [s.cUs - s.wUs - 1, 'early'], [s.cUs + s.wUs + 1, 'late']]) {
      const t = started();
      t.shot = s.n; // position at shot s.n without playing the earlier ones (its rolling lead-in is still fresh)
      const r = poseAtWalk(t, w);
      assert.equal(r?.kind, kind, `shot ${s.n} at walking t=${w}`);
    }
  });
});

test('timeout: only t > c+w; the timeout instant is c+w+1 and results never depend on the frame size', () => {
  const t = started(); toWalking(t);
  t.advance(SHOTS[0].cUs + SHOTS[0].wUs); // exactly c+w
  assert.equal(t.state, 'walking', 'not overdue at exactly c+w');
  assert.equal(t.pose()?.kind, 'usable', 'a pose at exactly c+w succeeds');
  const u = started(); toWalking(u);
  u.advance(SHOTS[0].cUs + SHOTS[0].wUs + 1);
  assert.equal(u.state, 'shot_result'); assert.equal(u.result?.kind, 'missed'); assert.equal(u.misses, 1);
  assert.equal(u.phaseUs, 0, 'the 900 ms result window starts at the timeout instant');
  // a huge single step lands on the same boundary and carries the leftover into the result window
  const v = started(); v.advance(CFG.rollingUs + SHOTS[0].cUs + SHOTS[0].wUs + 1 + 400_000);
  assert.equal(v.result?.kind, 'missed'); assert.equal(v.phaseUs, 400_000);
});

test('a queued input at exactly c+w resolves before the overdue timeout, whatever the batch order', () => {
  const dead = CFG.rollingUs + SHOTS[0].cUs + SHOTS[0].wUs;
  // frame jumps past the deadline, but the event happened at exactly c+w: input first, then time
  const a = started(); a.poseAt(dead); a.advanceTo(dead + 16_000);
  assert.equal(a.result?.kind, 'usable');
  // an event after c+w that the simulation had not yet timed out is "Too late", never a hit
  const b = started(); b.poseAt(dead + 1); b.advanceTo(dead + 16_000);
  assert.equal(b.result?.kind, 'late'); assert.equal(b.usable, 0);
  // a no-input timeout is "missed"
  const c = started(); c.advanceTo(dead + 16_000);
  assert.equal(c.result?.kind, 'missed');
});

test('a shot consumes exactly once: repeated, held and synthesized poses never double count', () => {
  const t = started(); toWalking(t);
  const at = t.totalUs + SHOTS[0].cUs;
  assert.equal(t.poseAt(at)?.kind, 'usable');
  for (let i = 0; i < 20; i++) assert.equal(t.poseAt(at + i), null);
  assert.equal(t.pose(), null);
  assert.equal(t.usable, 1); assert.equal(t.photos.length, 1);
  assert.equal(t.state, 'shot_result');
  t.advance(450_000); assert.equal(t.poseAt(t.totalUs), null, 'no pose during the result window');
});

test('feedback lasts exactly 900 ms of active time, then the next shot rolls', () => {
  const t = started(); poseAtWalk(t, SHOTS[0].cUs);
  assert.equal(t.state, 'shot_result');
  t.advance(899_999); assert.equal(t.state, 'shot_result');
  t.advance(1);
  assert.deepEqual([t.state, t.shot, t.phaseUs], ['rolling', 2, 0]);
  assert.deepEqual(t.events.map((e) => e.type), ['walk', 'shot', 'next']);
});

test('paper walkthrough: 1.80 usable, 1.80 early on shot 2, then 1.55, 2.05, 1.70 -> 4/5 win', () => {
  const t = started();
  assert.equal(poseAtWalk(t, 1_800_000)?.kind, 'usable'); finishResult(t);
  assert.equal(poseAtWalk(t, 1_800_000)?.kind, 'early'); finishResult(t); // 2.25 +/- 0.23
  assert.deepEqual([t.usable, t.misses, t.shot], [1, 1, 3]);
  assert.equal(poseAtWalk(t, 1_550_000)?.kind, 'usable'); finishResult(t);
  assert.equal(poseAtWalk(t, 2_050_000)?.kind, 'usable'); finishResult(t);
  assert.equal(t.state, 'rolling'); assert.equal(t.shot, 5);
  assert.equal(poseAtWalk(t, 1_700_000)?.kind, 'usable');
  assert.equal(t.state, 'shot_result'); assert.equal(t.usable, 4);
  finishResult(t);
  assert.equal(t.state, 'won'); assert.equal(t.shot, 5);
  assert.deepEqual(t.photos.map((p) => p.kind), ['usable', 'early', 'usable', 'usable', 'usable']);
});

test('4/4 wins immediately after shot 4 (no shot 5)', () => {
  const t = started();
  SHOTS.slice(0, 4).forEach((s) => { assert.equal(poseAtWalk(t, s.cUs)?.kind, 'usable'); finishResult(t); });
  assert.equal(t.state, 'won'); assert.equal(t.shot, 4); assert.equal(t.photos.length, 4);
});

test('second miss loses immediately; Retry state is a clean intro; no sixth shot ever', () => {
  const t = started();
  toWalking(t); t.advance(SHOTS[0].cUs + SHOTS[0].wUs + 1); finishResult(t); // miss 1 (timeout)
  assert.equal(t.state, 'rolling'); assert.equal(t.shot, 2);
  assert.equal(poseAtWalk(t, 0)?.kind, 'early'); // miss 2 (early)
  assert.equal(t.misses, 2); finishResult(t);
  assert.equal(t.state, 'lost'); assert.equal(t.shot, 2); assert.equal(t.usable, 0);
  t.advance(60 * US); assert.equal(t.state, 'lost'); assert.equal(t.shot, 2);
  t.reset();
  assert.deepEqual([t.state, t.shot, t.usable, t.misses, t.totalUs, t.photos.length], ['intro', 1, 0, 0, 0, 0]);
});

test('every reachable attempt ends by shot 5 and never plays a sixth (exhaustive over hit/miss patterns)', () => {
  for (let mask = 0; mask < 32; mask++) {
    const t = started();
    let guard = 0;
    while (!t.over && guard++ < 10) {
      const s = SHOTS[t.shot - 1];
      const hit = (mask >> (t.shot - 1)) & 1;
      toWalking(t);
      t.poseAt(t.totalUs + (hit ? s.cUs : 0));
      finishResult(t);
    }
    assert.ok(t.over, `mask ${mask} finished`);
    assert.ok(t.shot <= 5 && t.photos.length <= 5);
    assert.equal(t.state === 'won', t.usable === 4);
    assert.equal(t.state === 'lost', t.misses === 2 && t.usable < 4);
  }
});

test('frame-rate independence: 30/60/120 Hz replays agree on every boundary outcome', () => {
  /** Simulate a shot with an input at walking time `at`, stepping the engine through frames of `hz`. */
  function run(hz, at, useInput) {
    const t = started();
    const clock = new ActiveClock();
    clock.rebase(0);
    const dtMs = 1000 / hz;
    const inputActive = CFG.rollingUs + at; // active-time of the input
    let stamp = 0; let fired = !useInput;
    for (let i = 0; i < 2000 && t.state !== 'shot_result'; i++) {
      const next = stamp + dtMs;
      if (!fired && inputActive <= Math.round(next * 1000)) { t.poseAt(inputActive); fired = true; } // event handled at its own time
      const f = clock.frame(next);
      assert.ok(f.ok);
      t.advanceTo(f.activeUs);
      stamp = next;
    }
    return t.result?.kind;
  }
  const s = SHOTS[0];
  for (const [at, expectUsable] of [[s.cUs - s.wUs, true], [s.cUs, true], [s.cUs + s.wUs, true], [s.cUs - s.wUs - 1000, false], [s.cUs + s.wUs + 1000, false]]) {
    const outcomes = [30, 60, 120].map((hz) => run(hz, at, true));
    for (const o of outcomes) assert.equal(o === 'usable', expectUsable, `at ${at}: ${outcomes}`);
  }
  // no input at all: every rate times out as missed
  for (const hz of [30, 60, 120]) assert.equal(run(hz, 0, false), 'missed');
});

test('ActiveClock: accumulates elapsed time, reports a >250 ms foreground gap as a stall, never counts paused time', () => {
  const c = new ActiveClock();
  c.rebase(1000);
  assert.deepEqual(c.frame(1016.667), { ok: true, dtUs: 16_667, activeUs: 16_667 });
  const stall = c.frame(1016.667 + 251);
  assert.equal(stall.ok, false); assert.equal(stall.stall, true);
  assert.equal(c.activeUs, 16_667, 'a stall leaves the last simulation time untouched');
  assert.equal(c.frame(1016.667 + 251 + 250).ok, true, 'exactly 250 ms is a normal interval');
  c.stop(); c.rebase(9_000_000); // a long pause
  assert.equal(c.frame(9_000_016).dtUs, 16_000);
  assert.equal(c.activeUs, 16_667 + 250_000 + 16_000);
  assert.equal(c.toActive(9_000_020), c.activeUs + 4_000);
});

test('pausing is the controller not advancing: counters and the result window survive any wall-clock gap', () => {
  const t = started(); poseAtWalk(t, SHOTS[0].cUs);
  const snap = [t.usable, t.misses, t.phaseUs, t.totalUs, t.state];
  // (a pause calls neither advance nor poseAt)
  assert.deepEqual([t.usable, t.misses, t.phaseUs, t.totalUs, t.state], snap);
  t.advance(300_000); assert.equal(t.phaseUs, 300_000);
  t.advance(600_000); assert.equal(t.shot, 2);
});

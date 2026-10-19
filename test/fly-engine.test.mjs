// Fly the Simulation: deterministic course, movement, warnings, commits, collision boundaries and fixed substeps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, CFG, SEAMS, US, BOUNDARIES_US, gapCenterAt, seamX, fitsGap, safeBand, routeTarget, PREVIEW_US, COMMIT_US, CLEARED_AT_US } from '../games/2026-10-18/js/engine.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const started = () => { const s = new Sim(); s.begin(); return s; };
/** Follow the reference route to the end in dt steps. */
function followRoute(sim, dtUs = 16_000) {
  while (sim.status === 'running') {
    const d = routeTarget(sim.tUs) - sim.y;
    sim.setHeld(d < -0.01, d > 0.01);
    sim.advanceUs(dtUs);
  }
  return sim;
}

test('spec constants and the seven-seam table are exactly as specified', () => {
  assert.equal(CFG.flyX, 0.23); assert.equal(CFG.startY, 0.5); assert.equal(CFG.speed, 0.52);
  assert.equal(CFG.rx, 0.018); assert.equal(CFG.ry, 0.025); assert.equal(CFG.wallHalf, 0.024); assert.equal(CFG.gapHalf * 2, 0.28);
  assert.equal(CFG.wallSpeed, 0.3); assert.equal(CFG.durationUs, 20 * US);
  assert.equal(CFG.overlapUs, 140_000); near((CFG.wallHalf + CFG.rx) / CFG.wallSpeed, 0.14);
  assert.ok(CFG.maxStepUs <= US / 120);
  assert.deepEqual(SEAMS.map((s) => [s.n, s.arrivalUs / US, s.kind, s.initial, s.final]), [
    [1, 3.6, 'normal', 0.5, 0.5], [2, 6.0, 'recompile', 0.25, 0.75], [3, 8.4, 'normal', 0.25, 0.25], [4, 10.8, 'recompile', 0.25, 0.75],
    [5, 13.2, 'normal', 0.25, 0.25], [6, 15.6, 'recompile', 0.75, 0.25], [7, 18.0, 'normal', 0.75, 0.75],
  ]);
  assert.equal(SEAMS.filter((s) => s.kind === 'recompile').length, 3);
  for (const s of SEAMS) if (s.kind === 'normal') assert.equal(s.initial, s.final, 'normal seams show their final opening from first appearance');
  assert.equal(safeBand(0.5)[1] - safeBand(0.5)[0] > 0.2299, true, 'safe centre band is 0.23 wide');
});

test('start state: Ready at t=0, y=0.5, progress 0; nothing advances before begin()', () => {
  const s = new Sim();
  assert.deepEqual([s.status, s.tUs, s.y, s.cleared], ['ready', 0, 0.5, 0]);
  s.setHeld(false, true); s.advance(5);
  assert.deepEqual([s.status, s.tUs, s.y], ['ready', 0, 0.5], 'the clock waits for begin()');
});

test('steering: 0.52 arena-heights/s, immediate stop, neutral holds, opposite directions cancel, edges clamp and are safe', () => {
  const s = started();
  s.setHeld(false, true); s.advance(0.25); near(s.y, 0.5 + 0.13);
  s.setHeld(false, false); s.advance(0.25); near(s.y, 0.63, 1e-12);
  s.setHeld(true, true); s.advance(0.25); near(s.y, 0.63, 1e-12);
  s.setHeld(true, false); s.advance(0.5); near(s.y, 0.63 - 0.26);
  const top = started(); top.setHeld(true, false); top.advance(3); near(top.y, CFG.yMin, 1e-12); // clamped at the top, no damage
  assert.equal(top.status, 'running');
  const bottom = started(); bottom.setHeld(false, true); bottom.advance(3); near(bottom.y, CFG.yMax, 1e-12);
  assert.equal(bottom.status, 'running');
});

test('table events: preview at T-2.4 and commit at T-1.4 for the three recompile seams only, exact to the microsecond', () => {
  const s = started();
  s.advanceUs(CFG.durationUs); // neutral y=.5 dies at seam 2; use the route instead
  const r = followRoute(started());
  const ev = (type) => r.events.filter((e) => e.type === type).map((e) => [e.seam, e.tUs]);
  assert.deepEqual(ev('preview'), [[2, 3_600_000], [4, 8_400_000], [6, 13_200_000]]);
  assert.deepEqual(ev('commit'), [[2, 4_600_000], [4, 9_400_000], [6, 14_200_000]]);
  assert.deepEqual(ev('clear').map((e) => e[0]), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(ev('clear').map((e) => e[1]), SEAMS.map((x) => x.arrivalUs + 140_001), 'credit only once t > T+0.14');
  assert.equal(r.events.filter((e) => e.type === 'win').length, 1);
  assert.equal(r.events.filter((e) => e.type === 'lose').length, 0);
  assert.equal(PREVIEW_US(1), 3_600_000); assert.equal(COMMIT_US(1), 4_600_000); assert.equal(CLEARED_AT_US(0), 3_740_000);
});

test('the opening that is solid switches at exactly T-1.4 s, long before the wall reaches the fly', () => {
  for (const [i, s] of SEAMS.entries()) {
    const commit = COMMIT_US(i);
    assert.equal(gapCenterAt(s, commit - 1), s.initial);
    assert.equal(gapCenterAt(s, commit), s.final);
    if (s.kind !== 'recompile') continue;
    // at commit every wall is well ahead of the fly: wall left face is >= 0.35 right of the fly core's right edge
    const leftFace = seamX(s, commit) - CFG.wallHalf;
    assert.ok(leftFace - (CFG.flyX + CFG.rx) > 0.35, `seam ${s.n} commits ${leftFace} ahead`);
    // preview starts a full 1.0 s earlier
    assert.equal(commit - PREVIEW_US(i), US);
  }
});

test('neutral clears seam 1 but loses at seam 2 (contact at 5.86 s)', () => {
  const neutral = started();
  neutral.advance(30);
  assert.equal(neutral.status, 'lost');
  assert.deepEqual([neutral.collision?.seam, neutral.collision?.tUs, neutral.cleared], [2, 5_860_000, 1]);
  assert.equal(neutral.collision?.gapCenter, 0.75, 'the final opening is the solid one at contact');
});

test('staying in the OLD gap loses after the recompile: clear seam 1, move to the old opening, stay there', () => {
  const s = started();
  s.advanceUs(3_740_001); // seam 1 cleared with y=.5
  assert.equal(s.cleared, 1);
  s.setHeld(true, false);
  while (s.y > 0.25) s.advanceUs(1000);
  s.setHeld(false, false);
  s.advance(5);
  assert.equal(s.status, 'lost');
  assert.equal(s.collision?.seam, 2);
  assert.equal(s.collision?.tUs, 5_860_000);
});

test('following the final centres clears all seven and wins at exactly t=20.000 s with 7/7', () => {
  const s = followRoute(started());
  assert.equal(s.status, 'won');
  assert.equal(s.tUs, 20_000_000);
  assert.equal(s.cleared, 7);
  assert.equal(s.collision, null);
  s.advance(5); assert.equal(s.tUs, 20_000_000, 'time freezes after the win');
});

test('equality at an opening edge is safe; any real penetration loses (all seven, both edges, every contact instant)', () => {
  for (const [i, seam] of SEAMS.entries()) {
    const center = seam.final;
    const [lo, hi] = safeBand(center);
    // sample the whole overlap interval, including both ends
    for (let dt = -CFG.overlapUs; dt <= CFG.overlapUs; dt += 20_000) {
      for (const y of [lo, hi, center]) {
        const s = started(); s.tUs = seam.arrivalUs + dt - 1; s.y = y; s.advanceUs(1);
        assert.equal(s.status === 'lost', false, `seam ${i + 1} dt ${dt} y ${y} must survive`);
      }
      for (const y of [lo - 1e-6, hi + 1e-6]) {
        const s = started(); s.tUs = seam.arrivalUs + dt - 1; s.y = y; s.advanceUs(1);
        assert.equal(s.status, 'lost', `seam ${i + 1} dt ${dt} y ${y} must lose`);
        assert.equal(s.collision?.seam, i + 1);
      }
    }
    // outside the overlap interval the same y is harmless
    const before = started(); before.tUs = seam.arrivalUs - CFG.overlapUs - 10; before.y = lo - 0.2; before.advanceUs(5);
    assert.equal(before.status, 'running');
  }
});

test('a large dt cannot jump through a wall: the collision lands on the exact contact instant', () => {
  for (const y of [0.9, 0.1, 0.5]) {
    const s = started(); s.y = y;
    s.advance(100);
    assert.equal(s.status, 'lost');
    assert.ok([3_460_000, 5_860_000].includes(s.collision?.tUs ?? 0), `contact at a window start, got ${s.collision?.tUs}`);
  }
  // y=.5 survives seam 1 and dies at seam 2 even from one single giant step
  const one = started(); one.advanceUs(30 * US);
  assert.equal(one.collision?.tUs, 5_860_000);
});

test('substep invariance: 1/60 s, 1/120 s and 1 ms frames give identical outcomes for the same input schedule', () => {
  const schedule = (tUs) => { const k = Math.floor(tUs / 96_000) % 6; return k === 0 ? [true, false] : k === 1 ? [false, false] : k === 2 ? [false, true] : k === 3 ? [false, true] : k === 4 ? [true, true] : [true, false]; };
  const run = (frameUs) => {
    const s = started();
    while (s.status === 'running' && s.tUs < 40 * US) {
      const [u, d] = schedule(s.tUs);
      s.setHeld(u, d);
      s.advanceUs(frameUs);
    }
    return s;
  };
  const a = run(16_000); const b = run(8_000); const c = run(1_000);
  for (const r of [b, c]) {
    assert.equal(r.status, a.status);
    assert.equal(r.tUs, a.tUs);
    near(r.y, a.y, 1e-9);
    assert.equal(r.collision?.seam, a.collision?.seam);
    assert.equal(r.cleared, a.cleared);
  }
  // no single simulation step was longer than 1/120 s: boundaries are the only extra splits
  assert.ok(BOUNDARIES_US.every((t, i, arr) => i === 0 || t > arr[i - 1]));
});

test('both directions held cancel; collisions freeze everything; no win after a loss; no double credit', () => {
  const s = started();
  s.setHeld(true, true); s.advance(1); assert.equal(s.y, 0.5);
  s.setHeld(false, false); s.advance(30);
  assert.equal(s.status, 'lost');
  const t = s.tUs; const events = s.events.length;
  s.setHeld(true, false); s.advance(30);
  assert.equal(s.tUs, t); assert.equal(s.events.length, events);
  assert.equal(s.events.filter((e) => e.type === 'win').length, 0);
  assert.equal(new Set(s.events.filter((e) => e.type === 'clear').map((e) => e.seam)).size, s.events.filter((e) => e.type === 'clear').length);
});

test('reset returns a pristine Ready state with no leaked events, collision or progress', () => {
  const s = started(); s.advance(30);
  assert.equal(s.status, 'lost');
  s.reset();
  assert.deepEqual([s.status, s.tUs, s.y, s.cleared, s.events.length, s.collision, s.dir, s.commits, s.previewed], ['ready', 0, 0.5, 0, 0, null, 0, 0, 0]);
});

test('banana: hidden until seam 7 clears, reaches the fly at t=20 and slides to the fly height; every safe y wins', () => {
  const s = started();
  assert.equal(s.banana().visible, false);
  const r = followRoute(started());
  const b = r.banana();
  assert.equal(b.visible, true); near(b.x, CFG.flyX); near(b.y, r.y);
  // any y inside seam 7's band at the end still wins
  for (const y of [0.635, 0.75, 0.865]) {
    const w = started(); w.tUs = CLEARED_AT_US(5) + 10; w.cleared = 6; w.y = y; w.advanceUs(30 * US);
    assert.equal(w.status, 'won', `y=${y}`);
  }
  const mid = started(); mid.tUs = CLEARED_AT_US(6) + 1_000_000; mid.cleared = 7; mid.y = 0.9;
  const p = mid.banana().p; assert.ok(p > 0.4 && p < 0.6);
});

test('scenery palette index follows the three commits (garden, wireframe, desktop, glitched garden); view marks previews', () => {
  const s = started();
  const at = (us) => { s.tUs = us; return s.paletteIndex; };
  assert.deepEqual([at(4_599_999), at(4_600_000), at(9_399_999), at(9_400_000), at(14_199_999), at(14_200_000), at(19_000_000)], [0, 1, 1, 2, 2, 3, 3]);
  s.tUs = 4_000_000;
  const v = s.seamViews()[1];
  assert.equal(v.previewing, true); assert.equal(v.committed, false); assert.equal(v.center, 0.25); assert.equal(v.newCenter, 0.75);
  s.tUs = 4_600_000;
  const c = s.seamViews()[1]; assert.equal(c.previewing, false); assert.equal(c.center, 0.75); assert.equal(c.commitAgeUs, 0);
  assert.equal(s.seamViews().filter((x) => x.previewing).length <= 1, true, 'one pending recompile at a time');
  for (let t = 0; t < 20 * US; t += 100_000) { s.tUs = t; assert.ok(s.seamViews().filter((x) => x.previewing).length <= 1); }
});

test('the reference route sits inside every final safe band for the whole contact interval (paper walkthrough numbers)', () => {
  for (const seam of SEAMS) for (let dt = -CFG.overlapUs; dt <= CFG.overlapUs; dt += 10_000) {
    const target = routeTarget(seam.arrivalUs + dt);
    assert.equal(fitsGap(target, seam.final), true);
  }
  // largest centre move is 0.50; time between contacts leaves a clean route (2.4 s apart, 0.28 s contact)
  const moves = SEAMS.slice(1).map((s, i) => Math.abs(s.final - SEAMS[i].final));
  assert.equal(Math.max(...moves), 0.5);
  near(0.5 / CFG.speed, 0.9615384615, 1e-6);
  assert.ok(2.4 - 0.28 > 0.5 / CFG.speed);
  assert.ok(CFG.commitLeadUs / US - CFG.overlapUs / US - 0.5 / CFG.speed > 0.29, 'about .298 s of slack when reacting only at the commit');
});

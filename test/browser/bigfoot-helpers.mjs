// Shared helpers for the Bigfoot: Take Two browser tests (real Chromium, Playwright fake clock, mocked X provider).
// Time is frozen after load, so the active clock advances only through runFor/fastForward and a pose lands on an exact
// millisecond: active time = fake time since Start.
import assert from 'node:assert/strict';
import { openGame, setup as baseSetup } from './helpers.mjs';

/** The Bigfoot suites run against the repository's real preview registry (all staged candidates), exactly as staged. */
export const setup = (o = {}) => baseSetup({ realPreview: true, ...o });
export const BIG = '/games/2026-10-19/';
export const ROLL_MS = 650;
export const SHOT_MS = [{ c: 1800, w: 260 }, { c: 2250, w: 230 }, { c: 1550, w: 210 }, { c: 2050, w: 190 }, { c: 1700, w: 180 }];

export async function open(env, o = {}) {
  const g = await openGame(env, { route: BIG, ...o });
  if (!o.freeze) await g.page.clock.pauseAt(new Date(Date.now() + 60_000)); // freeze: openGame already paused near load time
  return g;
}

/** Run fn, always close the context, and fail on unexpected console/page errors (X blocking is expected and filtered). */
export async function withGame(env, o, fn) {
  const g = await open(env, o);
  try {
    await fn(g);
    const unexpected = g.problems.filter((p) => !/platform\.twitter\.com/.test(p) && !/ERR_FAILED|ERR_BLOCKED|ERR_INTERNET/.test(p));
    assert.deepEqual(unexpected, [], 'no console errors or page errors');
  } finally { await g.context.close(); }
}

export const read = (page) => page.evaluate(() => {
  const g = document.getElementById('game');
  return {
    state: g.dataset.state, engine: g.dataset.engineState, t: Number(g.dataset.tUs), phase: Number(g.dataset.phaseUs), shot: Number(g.dataset.shot),
    usable: Number(g.dataset.usable), misses: Number(g.dataset.misses), result: g.dataset.result, outcome: g.dataset.outcome ?? null,
    footX: Number(g.dataset.footX), target: (g.dataset.target || '').split(',').map(Number), pausedBy: g.dataset.pausedBy ?? null,
    cue: document.getElementById('cue').hidden ? '' : document.getElementById('cue').textContent.trim(),
    focus: document.activeElement?.id || document.activeElement?.tagName,
  };
});
export const focusedId = (page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
export const rect = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; }, sel);

const sched = new WeakMap(); // page -> { onset } : fake-clock time (ms) at which the CURRENT shot starts walking
/** For tests that start the game their own way (keyboard): declare the fake time of the Start activation. */
export const beginSchedule = (page, t0) => sched.set(page, { onset: t0 + ROLL_MS });
export const fakeNow = (page) => page.evaluate(() => performance.now());

/** Click Start with the mouse and return the state; the click is released, so nothing is held. */
export async function start(page) {
  const t0 = await fakeNow(page);
  await page.click('#btn-start');
  sched.set(page, { onset: t0 + ROLL_MS });
  await page.clock.runFor(16);
  const s = await read(page);
  assert.equal(s.engine, 'rolling');
  return s;
}

/** Run until the CURRENT shot is exactly `ms` into its walking phase (the schedule is tracked on the fake clock). */
export async function runToWalk(page, ms) {
  const { onset } = sched.get(page);
  const now = await fakeNow(page);
  assert.ok(onset + ms >= now, `cannot go back in time (${onset + ms} < ${now})`);
  await page.clock.runFor(onset + ms - now);
  return read(page);
}
/** Play one whole shot: walk to `ms`, press Space, let the 900 ms result window end. Returns the state after the result. */
export async function playShot(page, ms) {
  await runToWalk(page, ms);
  await page.keyboard.press('Space');
  const r = await read(page);
  const at = await fakeNow(page);
  await page.clock.runFor(920); // the engine advances on frames: a frame or two past the 900 ms window
  sched.set(page, { onset: at + 900 + ROLL_MS }); // next shot's walking onset
  return { r, after: await read(page) };
}
/** Let the current shot time out with no input (walking onset + 2.6 s is past every c+w), then its result window. */
export async function timeoutShot(page) {
  await runToWalk(page, 2600);
  const at = await fakeNow(page);
  await page.clock.runFor(920);
  sched.set(page, { onset: at + 900 + ROLL_MS });
}
/** The paper-walkthrough route to a 4/5 win (shot 2 deliberately early). */
export async function winFourOfFive(page) {
  await start(page);
  const out = [];
  for (const ms of [1800, 1800, 1550, 2050, 1700]) {
    out.push((await playShot(page, ms)).r.result);
    if ((await read(page)).engine === 'won') break;
  }
  return out;
}
/** Two timeouts: a loss without any input. */
export async function loseByTimeouts(page) {
  await start(page);
  for (let i = 0; i < 2; i++) await timeoutShot(page);
}
export const canvasHash = (page) => page.evaluate(() => {
  const c = /** @type {HTMLCanvasElement} */ (document.getElementById('scene'));
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0x811c9dc5; for (let i = 0; i < d.length; i += 7) { h ^= d[i] + (d[i + 1] << 8) + (d[i + 2] << 16); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${c.width}x${c.height}:${h >>> 0}`;
});
export const pixel = (page, x, y) => page.evaluate(([px, py]) => { const c = /** @type {HTMLCanvasElement} */ (document.getElementById('scene')); return [...c.getContext('2d').getImageData(Math.round(px), Math.round(py), 1, 1).data]; }, [x, y]);

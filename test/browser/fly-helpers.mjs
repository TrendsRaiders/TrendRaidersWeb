// Shared helpers for the Fly the Simulation browser tests (real Chromium, Playwright fake clock, mocked X provider).
import assert from 'node:assert/strict';
import { openGame } from './helpers.mjs';
import { readSim, createBot, playFake } from '../../scripts/lib/fly-bot.mjs';
import { setup as baseSetup } from './helpers.mjs';
/** The Fly suites run against the repository's real preview registry (both candidates), exactly as staged. */
export const setup = (o = {}) => baseSetup({ realPreview: true, ...o });
export { readSim, createBot, playFake };

export const FLY = '/games/2026-10-18/';

/** Open the edition on a fake clock. Collects console errors/failed requests in `problems`. */
export async function open(env, o = {}) {
  const g = await openGame(env, { route: FLY, ...o });
  // Freeze page time: the fake clock otherwise keeps flowing in real time between test steps, so "state at an event boundary"
  // would depend on CDP latency. From here the course advances only through runFor/fastForward.
  await g.page.clock.pauseAt(new Date(Date.now() + 60_000));
  return g;
}

/** Run fn then always close the context; unexpected console/page errors fail the test. */
export async function withGame(env, o, fn) {
  const g = await open(env, o);
  try {
    await fn(g);
    assert.deepEqual(g.problems, [], 'no console errors, page errors or failed requests');
  } finally { await g.context.close(); }
}

/** Click Start with a mouse (the click is released) and let a few frames run. */
export async function start(page) {
  await page.click('#btn-start');
  await page.clock.runFor(48);
  const s = await readSim(page);
  assert.equal(s.state, 'running');
  return s;
}
export const focusedId = (page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
export const rect = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; }, sel);
export const canvasHash = (page) => page.evaluate(() => {
  const c = /** @type {HTMLCanvasElement} */ (document.getElementById('scene'));
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0x811c9dc5; for (let i = 0; i < d.length; i += 7) { h ^= d[i] + (d[i + 1] << 8) + (d[i + 2] << 16); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${c.width}x${c.height}:${h >>> 0}`;
});
/** Run on the fake clock until the course time reaches tUs (the bot follows the reference route unless `bot` is given). */
export async function runTo(page, tUs, opts = {}) {
  let s = await readSim(page);
  const bot = opts.bot ?? createBot(page);
  for (let i = 0; i < 2500 && s.state === 'running' && s.tUs < tUs; i++) {
    await bot.tick(s);
    await page.clock.runFor(16);
    s = await readSim(page);
  }
  await bot.release();
  return s;
}
export const attr = (page, sel, name) => page.getAttribute(sel, name);
export const visible = (page, sel) => page.isVisible(sel);

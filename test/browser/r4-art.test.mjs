import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, openGame, state, text, startFight, playToWin } from './helpers.mjs';
import { renderArena, renderPayoff, frameHash } from '../../games/2026-10-17/js/art.js';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

/** FNV-1a over the canvas pixels, identical to frameHash(). */
const canvasHash = (page, sel) => page.evaluate((s) => {
  const c = document.querySelector(s); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0x811c9dc5;
  for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}, sel);
/** State attributes and canvas hash read in ONE evaluate so no frame can land between them (the fake clock still ticks in real time). */
const sampleWithHash = (page) => page.evaluate(() => {
  const a = document.getElementById('art');
  const d = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
  let h = 0x811c9dc5;
  for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return { player: a.dataset.playerPose, enemy: a.dataset.enemyPose, guard: a.dataset.guard === 'on', counter: !document.getElementById('counter-badge').hidden, hash: h.toString(16).padStart(8, '0') };
});
const sample = (page) => page.evaluate(() => {
  const a = document.getElementById('art');
  return { now: performance.now(), player: a.dataset.playerPose, enemy: a.dataset.enemyPose, guard: a.dataset.guard === 'on', counter: !document.getElementById('counter-badge').hidden };
});

test('arena is a real 256x144 pixel canvas at an integer scale: 1x at 320, 2x on desktop, letterboxed, nearest-neighbor', async () => {
  for (const [vp, scale] of [[{ width: 320, height: 640 }, 1], [{ width: 390, height: 800 }, 1], [{ width: 667, height: 375 }, 1], [{ width: 1280, height: 800 }, 2]]) {
    const g = await openGame(env, { viewport: vp });
    const { page } = g;
    const m = await page.evaluate(() => {
      const c = document.getElementById('art'); const st = document.getElementById('stage'); const ar = document.getElementById('arena');
      const r = c.getBoundingClientRect();
      return { cw: c.width, ch: c.height, w: r.width, h: r.height, x: r.x, y: r.y, scale: Number(st.dataset.scale), rendering: getComputedStyle(c).imageRendering, arenaInner: ar.clientWidth, sw: document.documentElement.scrollWidth, iw: window.innerWidth };
    });
    assert.deepEqual([m.cw, m.ch], [256, 144]);
    assert.equal(m.scale, scale, `${vp.width}x${vp.height}`);
    assert.deepEqual([m.w, m.h], [256 * scale, 144 * scale], 'whole-number multiple, never stretched or cropped');
    assert.ok(Number.isInteger(m.w) && Number.isInteger(m.h));
    assert.match(m.rendering, /pixelated|crisp-edges/);
    assert.ok(m.arenaInner >= 256, `at least 256 CSS px for the art (${m.arenaInner})`);
    assert.ok(m.sw <= m.iw);
    await g.context.close();
  }
});

test('intro subheading and arena placard are present, readable DOM text, and the placard does not cover the art', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 640 } });
  const { page } = g;
  assert.equal(await text(page, '#panel-intro .subhead'), 'The headline lasted 30 seconds. Your rematch gets 30.');
  assert.equal(await text(page, '#placard'), '30-SECOND HEADLINE CHALLENGE');
  const [pl, st] = await page.evaluate(() => ['placard', 'stage'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right }; }));
  assert.ok(pl.b <= st.t + 0.5, 'placard sits above the stage');
  assert.ok(pl.r - pl.l <= 320);
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('placard')).fontSize), '11.2px');
  await g.context.close();
});

test('canvas pixels match the spec art for every pose reached in play; wind-up and counter cues stay on the r3 timeline', async () => {
  const g = await openGame(env, { viewport: { width: 390, height: 800 }, reducedMotion: 'reduce' });
  const { page } = g;
  await startFight(page);
  const seen = { player: new Set(), enemy: new Set() };
  const start = (await sample(page)).now; // within one frame of sim time 0
  let windupAt = -1; let counterSeen = false; let punched = false; let t = 0;
  for (let i = 0; i < 3; i++) { await page.clock.runFor(16); t += 16; const s0 = await sample(page); seen.player.add(s0.player); seen.enemy.add(s0.enemy); }
  await page.keyboard.down('k');
  for (let i = 0; i < 200; i++) {
    await page.clock.runFor(16); t += 16;
    const s = await sample(page);
    seen.player.add(s.player); seen.enemy.add(s.enemy);
    if (s.enemy === 'windup' && windupAt < 0) windupAt = s.now - start;
    if (s.counter) counterSeen = true;
    if (s.counter && !punched) { await page.keyboard.press('Space'); punched = true; }
    if (i % 4 === 0) {
      const after = await sampleWithHash(page);
      const expected = frameHash(renderArena({ player: /** @type {any} */ (after.player), enemy: /** @type {any} */ (after.enemy), guard: after.guard, counter: after.counter }));
      assert.equal(after.hash, expected, `frame ${i} ${JSON.stringify(after)}`);
    }
  }
  for (const p of ['idle', 'guard', 'startup', 'punch', 'recover']) assert.ok(seen.player.has(p), `player pose ${p}; saw ${[...seen.player]}`);
  for (const e of ['idle', 'windup', 'strike', 'recovery']) assert.ok(seen.enemy.has(e), `enemy pose ${e}; saw ${[...seen.enemy]}`);
  assert.ok(counterSeen && punched);
  // first wind-up begins at sim 800 ms; sampled at 16 ms frames after the ~0-16 ms start offset
  assert.ok(Math.abs(windupAt - 800) <= 60, // the fake clock still ticks in real time between Playwright calls
     `wind-up pose begins at the r3 time (${windupAt})`);
  await g.context.close();
});

test('wind-up label/progress and counter badge remain visible with normal and reduced motion', async () => {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const g = await openGame(env, { viewport: { width: 320, height: 640 }, reducedMotion });
    const { page } = g;
    await startFight(page);
    await page.keyboard.down('k');
    await page.clock.runFor(1000);
    assert.equal(await page.isVisible('#windup-wrap'), true, reducedMotion);
    assert.match(await text(page, '#windup-wrap'), /WIND-UP/);
    const prog = await page.evaluate(() => getComputedStyle(document.getElementById('windup-fill')).transform);
    assert.notEqual(prog, 'none');
    await page.clock.runFor(450);
    assert.equal(await page.isVisible('#counter-badge'), true, reducedMotion);
    assert.match(await text(page, '#cue'), /BLOCK/);
    assert.equal(await page.evaluate(() => document.getElementById('art').dataset.guard), 'on', 'shield shape on guard');
    // numeric health/timer are DOM outside the art grid
    assert.equal(await page.evaluate(() => !document.getElementById('stage').contains(document.getElementById('hp-player')) && !document.getElementById('stage').contains(document.getElementById('time-left'))), true);
    await g.context.close();
  }
});

test('art failure falls back to simple shapes with cues and controls intact and play still works', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 640 }, init: () => { HTMLCanvasElement.prototype.getContext = () => null; } });
  const { page } = g;
  assert.equal(await page.getAttribute('#app', 'data-art'), 'fallback');
  assert.equal(await page.isVisible('#art-fallback'), true);
  assert.equal(await page.isVisible('#art'), false);
  await startFight(page);
  await page.keyboard.down('k');
  await page.clock.runFor(1000);
  assert.equal(await page.isVisible('#windup-wrap'), true);
  await page.clock.runFor(450);
  assert.match(await text(page, '#cue'), /BLOCK/);
  assert.equal(await page.getAttribute('#fb-enemy', 'data-pose'), 'strike');
  await page.clock.runFor(200);
  assert.equal(await page.getAttribute('#fb-enemy', 'data-pose'), 'recovery');
  await page.keyboard.press('Space');
  await page.clock.runFor(150);
  assert.equal(await text(page, '#hp-enemy'), '80');
  await g.context.close();
});

test('win payoff: pixel stool/stopwatch canvas, actual KO time, BEAT THE BUZZER, exact punchline; static equivalent with reduced motion', async () => {
  for (const reducedMotion of ['reduce', 'no-preference']) {
    const g = await openGame(env, { viewport: { width: 320, height: 640 }, reducedMotion });
    const { page } = g;
    await startFight(page);
    await playToWin(page);
    assert.equal(await state(page), 'result');
    assert.equal(await text(page, '#result-headline'), 'KO! You beat the 30-second headline.');
    assert.equal(await text(page, '#payoff .punchline'), 'Headline speedrun complete. The timeline can wait.');
    const time = (await text(page, '#result-time')).match(/KO time: (\d+\.\d\d)s/)[1];
    assert.match(await text(page, '.stamp-line'), new RegExp(`BEAT THE BUZZER\\s+${time}s`));
    const dims = await page.evaluate(() => { const c = document.getElementById('payoff-art'); const r = c.getBoundingClientRect(); return [c.width, c.height, r.width, r.height, getComputedStyle(c).imageRendering]; });
    assert.deepEqual(dims.slice(0, 2), [128, 72]);
    assert.equal(dims[2] % 128, 0);
    assert.match(String(dims[4]), /pixelated|crisp-edges/);
    if (reducedMotion === 'reduce') {
      assert.equal(await canvasHash(page, '#payoff-art'), frameHash(renderPayoff(3)), 'static final scene at once');
      assert.equal(await page.isVisible('#btn-skip-anim'), false);
    } else {
      await page.click('#btn-skip-anim');
      assert.equal(await canvasHash(page, '#payoff-art'), frameHash(renderPayoff(3)), 'skip jumps to the final scene');
    }
    assert.equal(await page.isEnabled('#btn-retry'), true);
    assert.equal(await page.isEnabled('#btn-share'), true);
    assert.deepEqual(g.problems, []);
    await g.context.close();
  }
});

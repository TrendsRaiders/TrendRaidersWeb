// Fly the Simulation: responsive compositions and geometry at 1280x800, 320x568, 390x844, 568x320 and 844x390.
// Measured from the live page (bounding boxes, computed fonts, pixels), not just horizontal overflow. Emulated viewports and
// touch: they cannot establish real phone address-bar, safe-area or thumb-reach behavior.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, withGame, start, readSim, runTo, focusedId } from './fly-helpers.mjs';
import { measureLayout, rectGap } from '../../scripts/lib/fly-measure.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const VIEWPORTS = [
  { name: '1280x800', width: 1280, height: 800, kind: 'desktop', touch: false },
  { name: '320x568', width: 320, height: 568, kind: 'portrait', touch: true },
  { name: '390x844', width: 390, height: 844, kind: 'portrait', touch: true },
  { name: '568x320', width: 568, height: 320, kind: 'landscape', touch: true },
  { name: '844x390', width: 844, height: 390, kind: 'landscape', touch: true },
];
const inside = (r, vw, vh) => r.x >= -0.5 && r.y >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5;
const within = (inner, outer) => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.right <= outer.right + 0.5 && inner.bottom <= outer.bottom + 0.5;

for (const vp of VIEWPORTS) {
  test(`${vp.name} (${vp.kind}): Intro shows goal + relevant controls + Start inside the arena without scrolling; text >= 16px; header compact`, async () => {
    await withGame(env, { viewport: { width: vp.width, height: vp.height }, touch: vp.touch }, async ({ page }) => {
      const m = await measureLayout(page);
      assert.equal(m.scrollW <= m.vw, true, 'no horizontal overflow');
      assert.equal(m.introVisible, true);
      assert.deepEqual([m.introLines.goal, m.introLines.start], [true, true]);
      assert.equal(m.introLines.keys || m.introLines.touch, true, 'at least the relevant control line');
      if (vp.touch) assert.equal(m.introLines.touch, true, 'touch viewports show the touch line');
      else assert.equal(m.introLines.keys, true, 'desktop shows the keyboard line');
      assert.ok(within(m.intro, m.arena), 'Intro sits inside the arena');
      assert.ok(inside(m.start, m.vw, m.vh) && inside(m.intro, m.vw, m.vh), 'Start visible without scrolling');
      const noScroll = await page.evaluate(() => { const i = document.getElementById('panel-intro'); return i.scrollHeight <= i.clientHeight + 1; });
      assert.equal(noScroll, true, 'Intro content fits without its own scrolling at normal text size');
      assert.ok(m.fonts.goal >= 16 && m.fonts.start >= 16 && (m.fonts.keys >= 16 || !m.introLines.keys) && (m.fonts.touch >= 16 || !m.introLines.touch));
      assert.ok(m.start.h >= 44);
      assert.equal(m.scrollY, 0);
      if (vp.kind === 'desktop') assert.ok(m.header.h >= 40 && m.header.h <= 48, `header ${m.header.h}`);
      if (vp.kind === 'portrait') assert.ok(m.header.h <= 52, `one compact row: ${m.header.h}`);
      if (vp.kind === 'landscape') assert.ok(m.header.h <= 36, `header <= 36: ${m.header.h}`);
    });
  });

  test(`${vp.name} (${vp.kind}): active composition, arena size, control sizes and separation`, async () => {
    await withGame(env, { viewport: { width: vp.width, height: vp.height }, touch: vp.touch }, async ({ page }) => {
      await start(page);
      const m = await measureLayout(page);
      const { vw, vh } = m;
      assert.equal(m.scrollW <= vw, true, 'no horizontal overflow');
      for (const k of ['arena', 'strip', 'up', 'down', 'pause', 'restart']) assert.ok(inside(m[k], vw, vh), `${k} inside the viewport without scrolling: ${JSON.stringify(m[k])}`);
      // utilities are never in the arena, never beside/over the steering buttons, and keep >= 24px clear of each steering target
      for (const u of [m.pause, m.restart]) {
        assert.ok(u.w >= 44 && u.h >= 44, `utility target ${u.w}x${u.h} >= 44x44`);
        assert.equal(u.pseudo, false, 'no invisible pseudo-element hit area extends the target');
        for (const s of [m.up, m.down]) assert.ok(rectGap(u, s) >= 24, `utility/steering gap ${rectGap(u, s)}`);
        assert.equal(rectGap(u, m.arena) > 0 || u.y >= m.arena.bottom, true, 'utilities are outside the arena');
        assert.ok(u.y >= m.arena.bottom, 'utilities sit below the arena');
      }
      for (const s of [m.up, m.down]) { assert.equal(s.pseudo, false); assert.equal(rectGap(s, m.arena) > 0 || s.x >= m.arena.right, true, 'steering is not over the arena'); }
      assert.ok(m.fonts.seams >= 14 && m.fonts.pause >= 14, 'compact HUD/utility text >= 14px');
      assert.ok(m.fonts.ctl >= 16, 'steering label >= 16px');
      if (vp.kind === 'portrait') {
        for (const s of [m.up, m.down]) assert.ok(s.w >= 96 && s.h >= 56, `steering ${s.w}x${s.h} >= 96x56`);
        assert.ok(Math.abs(m.up.y - m.down.y) < 1 && m.up.right <= m.down.x, 'one steering row');
        assert.ok(m.pause.y >= m.up.bottom + 24 - 0.5 && m.restart.y >= m.up.bottom + 24 - 0.5, 'separate utility row 24px+ below the steering row');
        assert.ok(m.arena.w >= vw - 32, `arena fills the width (${m.arena.w})`);
        assert.ok(m.strip.h <= 32);
        if (vp.width === 320) assert.ok(m.arena.h >= 270, `arena >= 270 at 320x568 (${m.arena.h})`);
        assert.ok(m.arena.h >= 0.55 * vh, `arena takes most of the play panel (${m.arena.h}/${vh})`);
      }
      if (vp.kind === 'landscape') {
        for (const s of [m.up, m.down]) assert.ok(s.w >= 88 && s.h >= 56, `rail control ${s.w}x${s.h} >= 88x56`);
        assert.ok(m.up.x >= m.arena.right, 'steering rail to the right of the arena');
        assert.ok(Math.abs(m.up.x - m.down.x) < 1 && m.up.bottom <= m.down.y, 'rail stacks the two controls');
        assert.ok(m.pause.y >= m.arena.bottom && m.restart.y >= m.arena.bottom, 'utility strip below the arena');
        assert.ok(m.pause.right <= m.up.x - 24 + 0.5 && m.restart.right <= m.up.x - 24 + 0.5, 'utilities are not at the end of the steering rail');
        if (vp.width === 568) assert.ok(m.arena.h >= 180, `arena >= 180 at 568x320 (${m.arena.h})`);
        assert.ok(m.arena.h >= 0.6 * vh);
      }
      if (vp.kind === 'desktop') {
        assert.ok(m.arena.w <= 1100 + 1 && m.arena.w >= 1000, `column max 1100 (${m.arena.w})`);
        assert.ok(m.arena.h >= 0.6 * vh && m.arena.h <= 0.7 * vh, `arena 60-70% of the first viewport (${m.arena.h / vh})`);
        assert.ok(m.strip.h <= 32);
        assert.ok(m.news.y > m.arena.bottom, 'News is below the game');
      }
      // sprites keep one whole-number scale and are never stretched to the arena aspect
      assert.ok(Number.isInteger(m.canvas.scale) && m.canvas.scale >= 1);
      assert.equal(m.canvas.w, Math.round(m.arena.w)); assert.equal(m.canvas.h, Math.round(m.arena.h));
    });
  });
}

test('active: the arena, sprite scale and canvas never change between Intro, running, Paused and the result (no layout pause on state change)', async () => {
  for (const vp of VIEWPORTS) {
    await withGame(env, { viewport: { width: vp.width, height: vp.height }, touch: vp.touch }, async ({ page }) => {
      const a = await measureLayout(page);
      await start(page);
      const b = await measureLayout(page);
      await page.keyboard.press('Escape');
      const c = await measureLayout(page);
      await page.click('#btn-resume'); await page.clock.runFor(16);
      for (let i = 0; i < 400 && (await readSim(page)).state === 'running'; i++) await page.clock.runFor(16);
      const d = await measureLayout(page);
      for (const x of [b, c, d]) { assert.deepEqual(x.arena, a.arena, `${vp.name} arena`); assert.deepEqual(x.canvas, a.canvas); assert.deepEqual(x.up, a.up); assert.deepEqual(x.pause, a.pause); }
      assert.equal((await readSim(page)).state, 'lost', 'the run ended in the result, not a stray layout pause');
    });
  }
});

test('Paused and result panels stay inside the arena, never over the controls, and the result does not cover the collision point', async () => {
  for (const vp of VIEWPORTS) {
    await withGame(env, { viewport: { width: vp.width, height: vp.height }, touch: vp.touch }, async ({ page }) => {
      await start(page);
      await page.keyboard.press('Escape');
      let m = await measureLayout(page);
      assert.ok(within(m.paused, m.arena), `${vp.name} Paused inside the arena`);
      assert.equal(await focusedId(page), 'btn-resume');
      assert.equal(await page.evaluate(() => document.getElementById('room-note').hidden), true, 'no "more room needed" when the arena fits');
      await page.click('#btn-resume');
      for (let i = 0; i < 400 && (await readSim(page)).state === 'running'; i++) await page.clock.runFor(16);
      m = await measureLayout(page);
      assert.ok(within(m.result, m.arena), `${vp.name} result inside the arena`);
      assert.ok(m.result.h <= m.arena.h);
      // the collision burst must stay visible: the card must not cover x=0.23..0.30 at the hit height
      const hitY = Number(await page.getAttribute('#game', 'data-hit-y'));
      const px = m.arena.x + 0.25 * m.arena.w; const py = m.arena.y + hitY * m.arena.h;
      const covered = px >= m.result.x && px <= m.result.right && py >= m.result.y && py <= m.result.bottom;
      assert.equal(covered, false, `${vp.name}: result card covers the collision point`);
      const overflow = await page.evaluate(() => { const r = document.getElementById('panel-result'); return r.scrollHeight - r.clientHeight; });
      assert.ok(overflow <= 1, `${vp.name}: result card content fits without internal scroll (${overflow})`);
    });
  }
});

test('win card + reveal fit inside the arena at every viewport (final frame, reduced motion) with Play again and Copy result reachable', async () => {
  const { playFake } = await import('./fly-helpers.mjs');
  for (const vp of VIEWPORTS) {
    await withGame(env, { viewport: { width: vp.width, height: vp.height }, touch: vp.touch, reducedMotion: 'reduce' }, async ({ page }) => {
      await start(page);
      await playFake(page);
      const m = await measureLayout(page);
      assert.ok(within(m.result, m.arena), `${vp.name}`);
      const btns = await page.evaluate(() => ['btn-again', 'btn-copy'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); const p = document.getElementById('panel-result').getBoundingClientRect(); return r.top >= p.top - 0.5 && r.bottom <= p.bottom + 0.5 && r.height >= 44; }));
      assert.deepEqual(btns, [true, true], `${vp.name}: both buttons >= 44px and inside the card`);
      const overflow = await page.evaluate(() => { const r = document.getElementById('panel-result'); return r.scrollHeight - r.clientHeight; });
      assert.ok(overflow <= 1, `${vp.name} win card fits (${overflow})`);
    });
  }
});

test('Pause on an actual arena change (address-bar-like height change): paused, nothing hidden, explicit Resume only', async () => {
  await withGame(env, { viewport: { width: 390, height: 844 }, touch: true }, async ({ page }) => {
    await start(page);
    await runTo(page, 1_000_000);
    await page.setViewportSize({ width: 390, height: 790 }); // like a collapsing address bar: the arena really changes
    await page.waitForFunction(() => document.getElementById('game').dataset.state === 'paused', null, { timeout: 5000 });
    const s = await readSim(page);
    assert.equal(s.state, 'paused');
    const m = await measureLayout(page);
    assert.ok(inside(m.pause, m.vw, m.vh) && inside(m.up, m.vw, m.vh) && inside(m.restart, m.vw, m.vh), 'controls still on screen');
    await page.clock.runFor(2000);
    assert.equal((await readSim(page)).tUs, s.tUs);
  });
});

test('large text / zoom: controls stay readable, News and footer stay, Intro may scroll internally and Start is reachable', async () => {
  await withGame(env, { viewport: { width: 320, height: 568 }, touch: true }, async ({ page }) => {
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; }); // CSSOM change (inline <style> is blocked by the CSP)
    await page.clock.runFor(50);
    const m = await measureLayout(page);
    assert.equal(await page.isVisible('#news'), true);
    assert.equal(await page.isVisible('.site-footer'), true);
    assert.ok(m.fonts.goal >= 32, 'text scaled up');
    await page.locator('#btn-start').scrollIntoViewIfNeeded();
    await page.click('#btn-start', { timeout: 5000 });
    await page.clock.runFor(100);
    const s = await readSim(page);
    assert.ok(['running', 'paused'].includes(s.state), 'Start worked at large text');
  });
});

test('flat, opaque UI: no translucent overlay fills, no box-shadows, nearest-neighbour canvas', async () => {
  await withGame(env, { viewport: { width: 390, height: 844 }, touch: true }, async ({ page }) => {
    const bad = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('#game *')) {
        const cs = getComputedStyle(el);
        if (/rgba\([^)]*,\s*0?\.\d+\)/.test(cs.backgroundColor)) out.push(`${el.id || el.className} bg ${cs.backgroundColor}`);
        if (cs.boxShadow !== 'none') out.push(`${el.id || el.className} shadow`);
        if (cs.opacity !== '1') out.push(`${el.id || el.className} opacity ${cs.opacity}`);
      }
      return out;
    });
    assert.deepEqual(bad, []);
    assert.match(await page.evaluate(() => getComputedStyle(document.getElementById('scene')).imageRendering), /pixelated|crisp-edges/);
  });
});

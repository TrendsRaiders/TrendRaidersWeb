// r6 rendered-layout checks at the spec sizes. Real Chromium viewports (emulation, not physical devices): they prove
// geometry, wrapping, flat styling and resize behavior, not how a real phone's browser chrome or safe areas behave.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, openGame, state, text, hp, startFight } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const SIZES = [
  { name: '320x568 portrait', w: 320, h: 568, mode: 'portrait' },
  { name: '390x844 portrait', w: 390, h: 844, mode: 'portrait' },
  { name: '667x375 short landscape', w: 667, h: 375, mode: 'landscape' },
  { name: '1280x720 desktop', w: 1280, h: 720, mode: 'desktop' },
];
const SELS = { head: '#game-title', hud: '#hud', arena: '#arena', cue: '#cuebar', guard: '#btn-guard', punch: '#btn-punch', pause: '#btn-pause', restart: '#btn-restart-play' };
// Measured r5 active geometry (r5-work/shots/geometry.json): arena size and thumb-control bottom, for the r6 comparison.
const R5 = { '320x568': { arenaH: 210, arenaW: 296 }, '390x844': { arenaH: 304, arenaW: 366 }, '667x375': { arenaH: 207, arenaW: 515 }, '1280x720': { arenaH: 346, arenaW: 1120 } };

const geometry = (page) => page.evaluate((sels) => {
  const out = { vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, scrollY: scrollY, r: {}, font: {}, header: { h: document.querySelector('.site-header').getBoundingClientRect().height } };
  for (const [k, s] of Object.entries(sels)) { const b = document.querySelector(s).getBoundingClientRect(); out.r[k] = { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; }
  const fs = (s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize);
  out.font = { ctl: fs('#btn-guard'), cue: fs('#cue'), hp: fs('#hp-player'), timer: fs('#time-left'), pause: fs('#btn-pause'), intro: fs('.intro-goal'), start: fs('#btn-start') };
  const panel = document.getElementById('game').getBoundingClientRect(); out.panel = { x: panel.x, w: panel.width };
  return out;
}, SELS);
const overlap = (a, b) => a.x < b.right - 0.5 && b.x < a.right - 0.5 && a.y < b.bottom - 0.5 && b.y < a.bottom - 0.5;

for (const sz of SIZES) {
  test(`${sz.name}: first-entry Intro fits inside the inactive arena at >=16px with Start focused; nothing runs behind it`, async () => {
    const g = await openGame(env, { viewport: { width: sz.w, height: sz.h }, touch: sz.mode !== 'desktop' });
    const { page } = g;
    const m = await page.evaluate(() => {
      const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; };
      const fs = (s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize);
      return { arena: r('#arena'), intro: r('#panel-intro'), start: r('#btn-start'), header: r('.site-header'), sw: document.documentElement.scrollWidth, vw: innerWidth, fonts: [fs('.intro-heading'), fs('.intro-goal'), fs('.intro-keys'), fs('.intro-touch'), fs('#btn-start')], active: document.activeElement?.id, overlay: document.querySelectorAll('#panel-intro').length, rail: getComputedStyle(document.querySelector('.rail')).display, cue: getComputedStyle(document.getElementById('cuebar')).display, pause: getComputedStyle(document.getElementById('btn-pause')).display };
    });
    assert.ok(m.intro.x >= m.arena.x - 0.5 && m.intro.right <= m.arena.right + 0.5 && m.intro.y >= m.arena.y - 0.5 && m.intro.bottom <= m.arena.bottom + 0.5, `Intro ${JSON.stringify(m.intro)} inside arena ${JSON.stringify(m.arena)}`);
    assert.ok(m.fonts.every((f) => f >= 16), `intro type >= 16px ${m.fonts}`);
    assert.ok(m.start.h >= 44 && m.start.w >= 120, 'Start target');
    assert.ok(m.sw <= m.vw, 'no horizontal overflow');
    assert.equal(m.active, 'btn-start');
    assert.deepEqual([m.rail, m.cue, m.pause], ['none', 'none', 'none'], 'no combat or tutorial-adjacent controls while stopped');
    const base = { '320x568': 227.2, '390x844': 337.6, '667x375': 223, '1280x720': 374.4 }[sz.name.split(' ')[0]];
    assert.ok(Math.abs(m.arena.h - base) <= 1, `arena keeps its normal height in Intro (${m.arena.h} vs ${base}): the overlay fits without growing it`);
    if (sz.mode === 'desktop') assert.ok(m.header.h <= 72, `header ${m.header.h}px <= 72`);
    await page.clock.runFor(40000); // wait far longer than a round
    assert.deepEqual([await state(page), await text(page, '#time-left'), ...(await hp(page))], ['intro', '30', 100, 100]);
    assert.deepEqual(g.problems, []);
    await g.context.close();
  });

  test(`${sz.name}: after Start, HUD, arena, cue strip, both thumb controls, Pause and Restart are visible together; no instruction or overlay remains`, async () => {
    const g = await openGame(env, { viewport: { width: sz.w, height: sz.h }, touch: sz.mode !== 'desktop' });
    const { page } = g;
    await startFight(page); // clicks Start round: the app itself positions the panel
    await page.keyboard.down('k');
    await page.clock.runFor(1000); // WIND-UP showing
    const m = await geometry(page);
    assert.ok(m.sw <= m.vw, `no horizontal overflow (${m.sw} > ${m.vw})`);
    for (const k of Object.keys(SELS)) {
      const r = m.r[k];
      assert.ok(r.x >= -0.5 && r.right <= m.vw + 0.5 && r.y >= -0.5 && r.bottom <= m.vh + 0.5, `${k} inside the active view ${JSON.stringify(r)} in ${m.vw}x${m.vh}`);
    }
    const parts = ['hud', 'arena', 'cue', 'guard', 'punch', 'pause', 'restart'];
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) assert.ok(!overlap(m.r[parts[i]], m.r[parts[j]]), `${parts[i]} overlaps ${parts[j]}`);
    assert.ok(m.r.pause.h >= 44 && m.r.pause.w >= 44 && m.r.restart.h >= 44 && m.r.restart.w >= 44, 'Pause and Restart targets >= 44px');
    assert.ok(m.r.guard.h >= 64 && m.r.punch.h >= 64, `thumb controls >= 64px high (${m.r.guard.h}, ${m.r.punch.h})`);
    assert.ok(m.r.cue.h >= 40 && m.r.cue.h <= 48, `cue strip ${m.r.cue.h}`);
    assert.ok(m.font.ctl >= 16 && m.font.cue >= 20 && m.font.hp >= 18 && m.font.timer >= 18, JSON.stringify(m.font));
    assert.ok(sz.mode === 'landscape' ? m.r.guard.y < m.r.punch.y : m.r.guard.x < m.r.punch.x, 'Guard first (left, or top in the rail), Punch second');
    assert.equal(await page.isVisible('#windup-wrap'), true);
    assert.match(await text(page, '#windup-wrap'), /WIND-UP/);
    // No tutorial remains anywhere in the active layout or the accessibility tree.
    const gone = await page.evaluate(() => ({ introHidden: document.getElementById('panel-intro').hidden, introDisplay: getComputedStyle(document.getElementById('panel-intro')).display, instr: document.querySelectorAll('#instr-play, .instr').length, goalText: [...document.querySelectorAll('#game *')].filter((e) => e.offsetParent !== null && /Block the hit/.test(e.textContent) && e.children.length === 0).length }));
    assert.deepEqual([gone.introHidden, gone.introDisplay, gone.instr, gone.goalText], [true, 'none', 0, 0]);
    assert.ok(m.r.head.h <= 32, `one compact play heading (${m.r.head.h}px)`);
    const r5 = R5[sz.name.split(' ')[0]];

    if (sz.mode === 'portrait') {
      assert.ok(m.r.arena.w >= 296 && m.r.arena.h >= 210, `arena ${m.r.arena.w}x${m.r.arena.h}`);
      const expectH = Math.min(360, Math.max(210, Math.round(sz.h * 0.4)));
      assert.ok(Math.abs(m.r.arena.h - expectH) <= 1, `arena height clamp(210, 40svh, 360) = ${expectH}, got ${m.r.arena.h}`);
      assert.ok(m.r.arena.x >= 8 && m.r.arena.x <= 12, `gutter ${m.r.arena.x}`);
      assert.ok(Math.abs(m.r.arena.right - (m.vw - m.r.arena.x)) <= 1, 'arena spans the full inner width');
      const gap = m.r.punch.x - m.r.guard.right;
      assert.ok(gap >= 8 && gap <= 12, `thumb gap ${gap}`);
      assert.ok(Math.abs(m.r.guard.w - m.r.punch.w) <= 1 && m.r.guard.w >= (m.r.arena.w - 12) / 2 - 2, 'each thumb control is about half the row');
      assert.ok(m.r.hud.h >= 40 && m.r.hud.h <= 52, `HUD ${m.r.hud.h}`);
      assert.ok(m.r.pause.y >= m.r.guard.bottom && m.r.restart.y >= m.r.guard.bottom, 'Pause and Restart sit below the thumbs, not between them or over the cues');
      assert.ok(m.r.arena.h >= r5.arenaH + 8, `arena gained height over r5 (${r5.arenaH} -> ${m.r.arena.h})`);
    }
    if (sz.mode === 'landscape') {
      assert.ok(m.r.arena.h >= 200, `arena ${m.r.arena.h}`);
      assert.ok(m.r.guard.w >= 104 && m.r.guard.w <= 128 && Math.abs(m.r.guard.x - m.r.punch.x) < 1, `right thumb rail width ${m.r.guard.w}`);
      assert.ok(m.r.guard.x >= m.r.arena.right, 'rail to the right of the arena');
      assert.ok(m.r.cue.right <= m.r.guard.x && Math.abs(m.r.cue.y - m.r.arena.bottom) < 12, 'cue strip in the lower band under the arena, not behind the rail (r7: beside the utilities)');
      assert.ok(m.r.arena.w >= m.vw - 12 - 8 - 12 - 128 - 1, 'arena takes the remaining width');
      assert.ok(m.r.hud.bottom <= m.r.arena.y && m.r.pause.y >= m.r.arena.bottom && m.r.restart.y >= m.r.arena.bottom, 'r7: Pause/Restart moved from above the HUD to the lower-left band under the arena');
      assert.ok(m.r.arena.h >= r5.arenaH, `arena at least as tall as r5 (${r5.arenaH} -> ${m.r.arena.h})`);
    }
    if (sz.mode === 'desktop') {
      assert.equal(Math.round(m.panel.w), 1120, 'centered play panel at the 1120px maximum');
      assert.ok(Math.abs(m.panel.x - (m.vw - m.panel.w) / 2) <= 1, 'centered');
      assert.ok(Math.abs(m.r.arena.w - 1120) <= 1, 'full-width arena');
      assert.ok(Math.abs(m.r.arena.h - 374) <= 2, `arena height ~374 (clamp(320px,52svh,500px)), got ${m.r.arena.h}`);
      assert.ok(m.r.hud.w >= 1100 && m.r.hud.h <= 52, 'single-row HUD');
      assert.ok(m.r.cue.y >= m.r.arena.bottom && m.r.guard.y >= m.r.cue.bottom, 'cue below arena, controls directly below');
      assert.ok(m.r.arena.h >= r5.arenaH + 20, `arena gained height over r5 (${r5.arenaH} -> ${m.r.arena.h})`);
      assert.ok(m.header.h <= 72, `compact header ${m.header.h}px`);
    }
    assert.deepEqual(g.problems, []);
    await g.context.close();
  });
}

test('arena sprites: boxer is 25-40% of arena height and the scene spans the full arena in every composition', async () => {
  for (const sz of SIZES) {
    const g = await openGame(env, { viewport: { width: sz.w, height: sz.h } });
    const m = await g.page.evaluate(() => { const c = document.getElementById('art'); return { px: Number(c.dataset.px), h: document.getElementById('arena').getBoundingClientRect().height }; });
    const frac = (60 * m.px) / m.h;
    assert.ok(frac >= 0.25 && frac <= 0.4, `${sz.name}: boxer ${(frac * 100).toFixed(1)}% of arena height (px ${m.px}, arena ${m.h})`);
    await g.context.close();
  }
});

test('flat retro theme: no gradients, shadows, glow, filters, translucent fills or rounded corners on the play panel', async () => {
  const g = await openGame(env, { viewport: { width: 390, height: 844 } });
  const bad = await g.page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('#game *, #news *, .site-nav *, .game-nav *, .dialog *')) {
      const c = getComputedStyle(el);
      if (c.backgroundImage !== 'none') out.push(`${el.tagName}.${el.className} background-image ${c.backgroundImage.slice(0, 30)}`);
      if (c.boxShadow !== 'none') out.push(`${el.tagName}.${el.className} box-shadow`);
      if (c.textShadow !== 'none') out.push(`${el.tagName}.${el.className} text-shadow`);
      if (c.filter !== 'none' || c.backdropFilter !== 'none') out.push(`${el.tagName}.${el.className} filter`);
      if (/rgba\(.*, 0?\.\d+\)/.test(c.backgroundColor)) out.push(`${el.tagName}.${el.className} translucent background ${c.backgroundColor}`);
      if (el.id !== 'art' && parseFloat(c.borderTopLeftRadius) > 2) out.push(`${el.tagName}.${el.className} radius ${c.borderTopLeftRadius}`);
    }
    return out;
  });
  assert.deepEqual(bad, []);
  await g.context.close();
});

test('Start, Resume, Restart and Retry bring the whole panel into view, instantly (also with reduced motion); Resume keeps the round, Restart shows Intro', async () => {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const g = await openGame(env, { viewport: { width: 320, height: 568 }, reducedMotion });
    const { page } = g;
    assert.equal(await page.evaluate(() => scrollY), 0);
    await page.click('#btn-start');
    assert.equal(await state(page), 'countdown');
    const y1 = await page.evaluate(() => scrollY);
    assert.ok(y1 > 0, 'scrolled to the panel');
    const head = await page.evaluate(() => document.querySelector('.panel-head').getBoundingClientRect().top);
    assert.ok(Math.abs(head) <= 1, `panel head at the top of the view (${head})`);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => scrollY), y1, 'no animated scrolling in progress');
    for (let i = 0; i < 400 && (await state(page)) !== 'playing'; i++) await page.clock.runFor(16);
    await page.keyboard.press('Escape');
    assert.equal(await state(page), 'paused');
    await page.evaluate(() => scrollTo(0, 0)); // the user scrolls away while paused (content scrolls normally)
    await page.click('#btn-resume');
    assert.equal(await state(page), 'countdown');
    assert.ok(Math.abs(await page.evaluate(() => document.querySelector('.panel-head').getBoundingClientRect().top)) <= 1, 'Resume repositions the panel');
    assert.equal(await page.isVisible('#panel-intro'), false, 'Resume is not a reset: no Intro');
    for (let i = 0; i < 400 && (await state(page)) !== 'playing'; i++) await page.clock.runFor(16);
    await page.keyboard.press('Escape');
    await page.evaluate(() => scrollTo(0, 0));
    await page.click('#btn-restart');
    assert.equal(await state(page), 'intro');
    assert.ok(Math.abs(await page.evaluate(() => document.querySelector('.panel-head').getBoundingClientRect().top)) <= 1, 'Restart repositions the panel for the fresh Intro');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-start');
    await g.context.close();
  }
});

test('resize and rotation clear input and pause an active round, preserving health and time; Resume is explicit', async () => {
  const g = await openGame(env, { viewport: { width: 390, height: 844 } });
  const { page } = g;
  await startFight(page);
  await page.keyboard.down('k');
  await page.clock.runFor(1500);
  assert.deepEqual(await hp(page), [96, 100]);
  const time = await text(page, '#time-left');
  await page.setViewportSize({ width: 844, height: 390 }); // rotate to landscape
  await page.clock.runFor(300);
  assert.equal(await state(page), 'paused');
  assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'false', 'input cleared');
  assert.equal(await page.isVisible('#dlg-pause'), true);
  await page.clock.runFor(5000);
  assert.deepEqual(await hp(page), [96, 100]);
  assert.equal(await text(page, '#time-left'), time);
  await page.keyboard.up('k');
  await page.click('#btn-resume');
  assert.equal(await state(page), 'countdown');
  for (let i = 0; i < 400 && (await state(page)) !== 'playing'; i++) await page.clock.runFor(16);
  // the landscape composition is live and complete after recomposition
  const m = await geometry(page);
  assert.ok(m.r.guard.x >= m.r.arena.right && m.r.guard.bottom <= m.vh && m.r.pause.y >= 0, 'rail composition after rotation');
  // a resize during the countdown pauses as well; resize while paused changes nothing
  await page.keyboard.press('Escape');
  await page.click('#btn-resume');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.runFor(200);
  assert.equal(await state(page), 'paused');
  const t2 = await text(page, '#time-left');
  await page.setViewportSize({ width: 400, height: 800 });
  await page.clock.runFor(2000);
  assert.equal(await state(page), 'paused');
  assert.equal(await text(page, '#time-left'), t2);
  assert.deepEqual(g.problems, []);
  await g.context.close();
});

test('touch: arena and thumb controls suppress gestures; nav/news scroll normally; dual-touch does not pan; zoom is not disabled', async () => {
  const g = await openGame(env, { viewport: { width: 390, height: 844 }, touch: true });
  const { page, context } = g;
  const ta = await page.evaluate(() => Object.fromEntries(['#arena', '#btn-guard', '#btn-punch', '#news', '.site-nav', 'body', '#embed-area'].map((s) => [s, getComputedStyle(document.querySelector(s)).touchAction])));
  assert.deepEqual([ta['#arena'], ta['#btn-guard'], ta['#btn-punch']], ['none', 'none', 'none']);
  for (const k of ['#news', '.site-nav', 'body', '#embed-area']) assert.equal(ta[k], 'auto', `${k} keeps normal scrolling`);
  assert.doesNotMatch(await page.getAttribute('meta[name="viewport"]', 'content'), /user-scalable\s*=\s*(no|0)|maximum-scale/);
  await startFight(page);
  const y0 = await page.evaluate(() => scrollY);
  const c = (sel) => page.locator(sel).boundingBox().then((b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }));
  const guard = await c('#btn-guard'); const punch = await c('#btn-punch'); const arena = await c('#arena');
  const cdp = await context.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  await touch('touchStart', [{ ...guard, id: 1 }, { ...punch, id: 2 }]);
  await touch('touchMove', [{ x: guard.x, y: guard.y - 200, id: 1 }, { x: punch.x, y: punch.y - 200, id: 2 }]);
  await touch('touchMove', [{ x: guard.x, y: guard.y + 100, id: 1 }, { x: punch.x, y: punch.y + 100, id: 2 }]);
  await touch('touchEnd', []);
  assert.equal(await page.evaluate(() => scrollY), y0, 'dual-touch drag on the controls does not pan the page');
  await touch('touchStart', [{ ...arena, id: 3 }]);
  await touch('touchMove', [{ x: arena.x, y: arena.y - 150, id: 3 }]);
  await touch('touchEnd', []);
  assert.equal(await page.evaluate(() => scrollY), y0, 'dragging on the arena does not pan the page');
  await page.keyboard.press('Escape');
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  assert.ok((await page.evaluate(() => scrollY)) > y0, 'content scrolls normally outside active play');
  await context.close();
});

test('text wraps naturally: Intro copy and thumb labels are never clipped or shrunk, in every compact composition', async () => {
  for (const sz of SIZES.filter((s) => s.mode !== 'desktop')) {
    const g = await openGame(env, { viewport: { width: sz.w, height: sz.h } });
    const { page } = g;
    const chk = () => page.evaluate(() => {
      const f = (s) => { const e = document.querySelector(s); const c = getComputedStyle(e); return { clippedX: e.scrollWidth > e.clientWidth + 1, clippedY: e.scrollHeight > e.clientHeight + 1, lines: Math.round(e.getBoundingClientRect().height / parseFloat(c.lineHeight)), ws: c.whiteSpace, fs: parseFloat(c.fontSize) }; };
      return { goal: f('.intro-goal'), keys: f('.intro-keys'), touch: f('.intro-touch'), intro: f('#panel-intro'), start: f('#btn-start') };
    });
    const m = await chk();
    if (sz.w <= 390) assert.ok(m.goal.lines >= 2, `${sz.name}: goal wraps naturally (${m.goal.lines} lines)`);
    for (const k of ['goal', 'keys', 'touch', 'intro', 'start']) assert.ok(!m[k].clippedX && !m[k].clippedY && m[k].ws === 'normal' && m[k].fs >= 16, `${sz.name} ${k} ${JSON.stringify(m[k])}`);
    await startFight(page);
    const a = await page.evaluate(() => { const f = (s) => { const e = document.querySelector(s); return { clippedX: e.scrollWidth > e.clientWidth + 1, clippedY: e.scrollHeight > e.clientHeight + 1 }; }; return { guard: f('#btn-guard'), punch: f('#btn-punch'), rail: f('.rail'), pause: f('#btn-pause'), restart: f('#btn-restart-play') }; });
    for (const [k, v] of Object.entries(a)) assert.ok(!v.clippedX && !v.clippedY, `${sz.name} ${k} clipped`);
    assert.equal(await text(page, '#btn-guard'), 'GUARD — hold');
    assert.equal(await text(page, '#btn-punch'), 'PUNCH — tap');
    await g.context.close();
  }
});

test('stopped-state expansion: with an enlarged root font (zoom/text size) the Intro grows the arena, nothing is clipped and Start stays reachable by scrolling', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 568 } });
  const { page } = g;
  await page.evaluate(() => { document.documentElement.style.fontSize = '28px'; });
  await page.clock.runFor(100);
  const m = await page.evaluate(() => {
    const a = document.getElementById('arena').getBoundingClientRect(); const i = document.getElementById('panel-intro').getBoundingClientRect(); const s = document.getElementById('btn-start').getBoundingClientRect();
    return { arenaH: a.height, introBottom: i.bottom, arenaBottom: a.bottom, startBottom: s.bottom, introScroll: document.getElementById('panel-intro').scrollHeight, introClient: document.getElementById('panel-intro').clientHeight, sw: document.documentElement.scrollWidth, vw: innerWidth };
  });
  assert.ok(m.arenaH > 227.5, `arena grew while stopped (${m.arenaH})`);
  assert.ok(m.introBottom <= m.arenaBottom + 0.5 && m.startBottom <= m.introBottom + 0.5, 'overlay and Start fully inside the arena');
  assert.ok(m.introScroll <= m.introClient + 1, 'not clipped');
  assert.ok(m.sw <= m.vw + 1, 'no horizontal overflow');
  await page.focus('#btn-start');
  await page.keyboard.press('Enter');
  assert.equal(await state(page), 'countdown', 'Start still works at the larger size');
  await g.context.close();
});

test('cue strip and status slot: BLOCK + COUNTER NOW fit together in the 320 strip without overlap or clipping', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 568 } });
  const { page } = g;
  await startFight(page);
  await page.keyboard.down('k');
  await page.clock.runFor(1500);
  const m = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const bar = r('#cuebar'); const cue = r('#cue'); const badge = r('#counter-badge');
    return { bar, cue, badge, text: document.getElementById('cue').textContent, cueClipped: document.getElementById('cue').scrollWidth > document.getElementById('cue').clientWidth + 1 };
  });
  assert.match(m.text, /BLOCK/);
  assert.equal(await page.isVisible('#counter-badge'), true);
  assert.ok(m.cue.right <= m.badge.left + 0.5, 'cue text and COUNTER NOW badge side by side');
  assert.ok(m.badge.right <= m.bar.right && m.badge.bottom <= m.bar.bottom + 0.5 && m.badge.top >= m.bar.top - 0.5, 'badge inside the strip');
  assert.equal(m.cueClipped, false);
  await g.context.close();
});

test('footer About: normal flow after the news, not fixed or sticky, never over the controls; header has no About, hero or share controls', async () => {
  for (const sz of SIZES) {
    const g = await openGame(env, { viewport: { width: sz.w, height: sz.h } });
    const { page } = g;
    const m = await page.evaluate(() => {
      const f = document.querySelector('footer.site-footer'); const b = document.getElementById('btn-about'); const n = document.getElementById('news');
      const h = document.querySelector('.site-header');
      return { pos: getComputedStyle(f).position, bpos: getComputedStyle(b).position, hpos: getComputedStyle(h).position, after: !!(n.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING), inArena: document.getElementById('arena').contains(b), fTop: f.getBoundingClientRect().top + scrollY, nBottom: n.getBoundingClientRect().bottom + scrollY, hText: h.textContent, hButtons: [...h.querySelectorAll('button')].map((x) => x.textContent.trim()), h1: document.querySelectorAll('h1').length, tools: [...document.querySelectorAll('#panel-tools button')].map((x) => x.id) };
    });
    assert.deepEqual([m.pos, m.bpos, m.hpos], ['static', 'static', 'static'], `${sz.name}: footer/header in normal flow`);
    assert.ok(m.after && m.fTop >= m.nBottom - 1 && !m.inArena, 'About sits below the news, outside the arena');
    assert.doesNotMatch(m.hText, /About|Share|Block the hit/);
    assert.deepEqual(m.hButtons.filter((t) => !/^(←|→|None|Previous|Next)/.test(t) && !/Previous|Next/.test(t)), [], 'header buttons are only the disabled arrows');
    assert.equal(m.h1, 1, 'one compact semantic play heading');
    assert.ok(!m.tools.includes('btn-about'), 'About is not a play tool');
    await g.context.close();
  }
});

test('Pause and Restart are the only play tools while a round is on; Sound only while stopped; header stays out of the active view after Start on phones', async () => {
  const g = await openGame(env, { viewport: { width: 390, height: 844 } });
  const { page } = g;
  const vis = () => page.evaluate(() => [...document.querySelectorAll('#panel-tools button')].filter((b) => b.getClientRects().length).map((b) => b.id));
  assert.deepEqual(await vis(), ['btn-sound']);
  await startFight(page);
  assert.deepEqual(await vis(), ['btn-pause', 'btn-restart-play']);
  const headerBottom = await page.evaluate(() => document.querySelector('.site-header').getBoundingClientRect().bottom);
  assert.ok(headerBottom <= 0, 'the compact header has scrolled away; the play heading keeps the selected date');
  assert.match(await text(page, '#game-title'), /17 (Oct|October) 2026/);
  await g.context.close();
});

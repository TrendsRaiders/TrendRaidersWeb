// r7: lower, smaller-looking mobile Pause inside a real >=44x44 button, >=16px from every combat target, inert gaps, and
// unchanged input routing. All clocks are FROZEN (page.clock.pauseAt); time only moves through explicit runFor().
// Emulated viewports and synthetic touch (Playwright + DevTools protocol): this is NOT physical-phone evidence.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, openGame, state, text, hp, startFight, until } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const MOBILE = [
  { name: '320x568 portrait', w: 320, h: 568, mode: 'portrait' },
  { name: '390x844 portrait', w: 390, h: 844, mode: 'portrait' },
  { name: '667x375 short landscape', w: 667, h: 375, mode: 'landscape' },
  { name: '768x1024 tall 600-899', w: 768, h: 1024, mode: 'portrait' },
];
const SELS = { arena: '#arena', cue: '#cuebar', hud: '#hud', guard: '#btn-guard', punch: '#btn-punch', pause: '#btn-pause', restart: '#btn-restart-play', badge: '.pause-badge' };

const rects = (page) => page.evaluate((sels) => {
  const out = { vw: innerWidth, vh: innerHeight };
  for (const [k, s] of Object.entries(sels)) { const e = document.querySelector(s); const b = e.getBoundingClientRect(); out[k] = { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom, shown: e.getClientRects().length > 0 }; }
  return out;
}, SELS);
/** Edge-to-edge distance between two rectangles (0 when touching/overlapping). */
const dist = (a, b) => Math.hypot(Math.max(0, a.x - b.right, b.x - a.right), Math.max(0, a.y - b.bottom, b.y - a.bottom));
const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const lum = (hex) => { const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const hex = (rgb) => rgb.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
const requests = (page) => page.getAttribute('#app', 'data-punch-requests');

async function activePage(sz, opts = {}) {
  const g = await openGame(env, { viewport: { width: sz.w, height: sz.h }, touch: true, freeze: true, ...opts });
  await startFight(g.page);
  return g;
}

for (const sz of MOBILE) {
  test(`${sz.name}: Pause is one real >=44x44 button with a 24x24 outlined neutral badge, full-target focus, Restart >=44px, gaps >=16/>=12, correct lower placement`, async () => {
    const g = await activePage(sz);
    const { page } = g;
    await page.keyboard.down('k');
    await page.clock.runFor(1450); // BLOCK + COUNTER window showing
    const m = await rects(page);
    const { pause, restart, guard, punch, arena, cue, badge } = m;
    assert.equal(await page.locator('#btn-pause').count(), 1, 'one Pause button, no duplicate old HUD Pause');
    assert.equal(await page.evaluate(() => document.getElementById('btn-pause').tagName), 'BUTTON');
    assert.equal(await page.getByRole('button', { name: 'Pause game' }).count(), 1, 'accessible name');
    assert.ok(pause.w >= 44 && pause.h >= 44 && restart.h >= 44 && restart.w >= 44, `targets ${JSON.stringify([pause.w, pause.h, restart.w, restart.h])}`);
    assert.ok(Math.abs(badge.w - 24) < 0.5 && Math.abs(badge.h - 24) < 0.5, `badge ${badge.w}x${badge.h}`);
    assert.ok(Math.abs(center(badge).x - center(pause).x) < 0.5 && Math.abs(center(badge).y - center(pause).y) < 0.5, 'badge centered in the real button');
    assert.ok(pause.w < 52 && pause.h < 52, 'not a combat-sized surface (a normal 44px target)');
    const style = await page.evaluate(() => {
      const b = getComputedStyle(document.querySelector('.pause-badge')); const p = getComputedStyle(document.getElementById('btn-pause'));
      return { bg: b.backgroundColor, border: b.borderTopColor, bw: b.borderTopWidth, pbg: p.backgroundColor, pborder: p.borderTopWidth, bars: [...document.querySelectorAll('.pause-badge i')].map((i) => { const r = i.getBoundingClientRect(); return [r.width, r.height]; }), page: getComputedStyle(document.body).backgroundColor, before: getComputedStyle(document.getElementById('btn-pause'), '::before').content, after: getComputedStyle(document.getElementById('btn-pause'), '::after').content };
    });
    assert.equal(style.bg, 'rgba(0, 0, 0, 0)', 'badge is unfilled');
    assert.equal(style.pbg, 'rgba(0, 0, 0, 0)', 'button itself is not a filled surface');
    assert.equal(style.bw, '2px');
    assert.equal(style.bars.length, 2, 'two pause bars');
    assert.ok(ratio(hex(style.border), hex(style.page)) >= 3, `badge outline contrast ${ratio(hex(style.border), hex(style.page)).toFixed(2)}`);
    assert.deepEqual([style.before, style.after], ['none', 'none'], 'no pseudo-element hit slop');
    // gaps: every utility rectangle >=16px from every combat rectangle; utilities >=12px apart
    for (const u of [pause, restart]) for (const c of [guard, punch]) assert.ok(dist(u, c) >= 16 - 0.01, `${sz.name}: utility-to-combat gap ${dist(u, c).toFixed(2)}`);
    assert.ok(dist(pause, restart) >= 12 - 0.01, `utility gap ${dist(pause, restart)}`);
    // placement
    assert.ok(pause.y >= arena.bottom && restart.y >= arena.bottom, 'utilities are below the arena');
    for (const k of ['arena', 'cue', 'hud', 'guard', 'punch', 'pause', 'restart']) assert.ok(m[k].x >= -0.5 && m[k].right <= m.vw + 0.5 && m[k].y >= -0.5 && m[k].bottom <= m.vh + 0.5, `${k} inside the active view without scrolling ${JSON.stringify(m[k])}`);
    assert.ok(cue.h >= 40 && guard.h >= 64 && punch.h >= 64 && arena.h >= 200, 'minima not shrunk');
    if (sz.mode === 'portrait') {
      assert.ok(arena.h >= 210 && arena.w >= 296 - 0.5 || sz.w > 320, 'arena minimum');
      assert.ok(pause.y >= Math.max(guard.bottom, punch.bottom) + 16 - 0.01, 'lower utility row >=16px below the combat row');
      assert.ok(pause.x < restart.x, 'Pause left, Restart right of it');
      assert.ok(pause.x <= 16 && pause.w < 60, 'Pause is a small left-aligned target, not full width');
    } else {
      assert.ok(guard.y < punch.y && Math.abs(guard.x - punch.x) < 1 && guard.w >= 104 && guard.w <= 128, `right rail Guard over Punch (${guard.w})`);
      assert.ok(pause.right <= guard.x - 16 && restart.right <= guard.x - 16, 'no utilities in the rail; >=16px horizontally from it');
      assert.ok(pause.y >= arena.bottom && pause.h >= 44, 'lower-left band under the arena');
      assert.ok(cue.x >= restart.right + 12 - 0.01 && cue.right <= guard.x, `cue strip beside the utilities (gap ${cue.x - restart.right}), not behind the rail`);
      assert.ok(Math.min(pause.y, restart.y) >= arena.bottom && Math.abs(cue.y - arena.bottom) < 12, 'one shared band, no extra vertical utility row');
      assert.ok(arena.h >= 200, `arena ${arena.h}`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(g.problems, []);
    await g.context.close();
  });
}

test('keyboard focus shows a visible ring around the full 44x44 Pause target and Restart', async () => {
  const g = await activePage(MOBILE[1]);
  const { page } = g;
  await page.clock.runFor(100);
  await page.keyboard.press('Escape');
  assert.equal(await state(page), 'paused');
  await page.click('#btn-resume');
  for (let i = 0; i < 300 && (await state(page)) !== 'playing'; i++) await page.clock.runFor(16);
  // reach Pause with the keyboard during the countdown (where leaving the play region does not pause)
  await page.keyboard.press('Escape'); await page.click('#btn-resume');
  assert.equal(await state(page), 'countdown');
  await page.focus('#btn-pause');
  const ring = await page.evaluate(() => { const e = document.getElementById('btn-pause'); const c = getComputedStyle(e); const r = e.getBoundingClientRect(); return { style: c.outlineStyle, width: c.outlineWidth, active: document.activeElement === e, fv: e.matches(':focus-visible'), w: r.width, h: r.height }; });
  assert.deepEqual([ring.active, ring.style], [true, 'solid']);
  assert.ok(parseFloat(ring.width) >= 2 && ring.w >= 44 && ring.h >= 44, 'ring is drawn on the whole >=44px button');
  await page.focus('#btn-restart-play');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('btn-restart-play')).outlineStyle), 'solid');
  await g.context.close();
});

test('hit testing: the full Pause rectangle is Pause (corners and center), the 16px gap and the badge-adjacent space outside it are inert, no overlay/wrapper regions', async () => {
  for (const sz of MOBILE) {
    const g = await activePage(sz);
    const { page } = g;
    const m = await rects(page);
    const hit = (x, y) => page.evaluate(([px, py]) => { const e = document.elementFromPoint(px, py); const b = e?.closest('button, a'); return { id: b?.id || null, tag: e?.tagName, inPause: !!e?.closest('#btn-pause'), inRestart: !!e?.closest('#btn-restart-play') }; }, [x, y]);
    const p = m.pause;
    for (const [x, y] of [[p.x + 1, p.y + 1], [p.right - 1, p.y + 1], [p.x + 1, p.bottom - 1], [p.right - 1, p.bottom - 1], [p.x + p.w / 2, p.y + p.h / 2]]) assert.equal((await hit(x, y)).inPause, true, `${sz.name}: inside Pause ${x},${y}`);
    // the Pause/Restart gap (12px) and every point 2px outside the Pause rectangle are not Pause
    for (const [x, y] of [[p.x - 2, p.y + p.h / 2], [p.x + p.w / 2, p.y - 2], [p.x + p.w / 2, p.bottom + 2], [p.right + 2, p.y + p.h / 2], [p.right + 6, p.y + p.h / 2]]) {
      if (x < 0) continue;
      const h = await hit(x, y);
      assert.equal(h.inPause, false, `${sz.name}: outside Pause is inert ${x},${y}`);
    }
    // blank space between combat and utilities: nothing clickable (no button/link) at the middle of the >=16px gap
    const { guard, punch } = m;
    const gapPoints = sz.mode === 'portrait'
      ? [[guard.x + guard.w / 2, (guard.bottom + p.y) / 2], [punch.x + punch.w / 2, (punch.bottom + p.y) / 2], [p.x + p.w / 2, (guard.bottom + p.y) / 2]]
      : [[(m.restart.right + guard.x) / 2, p.y + p.h / 2], [guard.x - 8, p.y + p.h / 2]];
    for (const [x, y] of gapPoints) { const h = await hit(x, y); assert.equal(h.id, null, `${sz.name}: gap point ${x.toFixed(0)},${y.toFixed(0)} hits ${JSON.stringify(h)}`); }
    // no negative margins / absolute / fixed positioning on any utility
    const pos = await page.evaluate(() => ['btn-pause', 'btn-restart-play', 'panel-tools'].map((id) => { const c = getComputedStyle(document.getElementById(id)); return [c.position, c.marginTop, c.marginLeft, c.transform]; }));
    for (const [position, mt, ml, tf] of pos) assert.ok(['static', 'relative'].includes(position) && parseFloat(mt) >= 0 && parseFloat(ml) >= 0 && tf === 'none', JSON.stringify(pos));
    await g.context.close();
  }
});

test('taps: 1px inside the Pause edge pauses once; taps in the inert gaps do nothing (no pause, no punch); repeated Punch taps near its lower corners never pause', async () => {
  for (const sz of MOBILE.slice(0, 3)) {
    const g = await activePage(sz);
    const { page } = g;
    const m = await rects(page);
    const p = m.pause; const pu = m.punch;
    const before = await requests(page);
    // Chromium snaps taps that land within its touch slop to the nearest clickable target, so a tap in the 16px gap
    // next to Punch/Guard is a combat tap (never Pause) and a tap well away from every control is inert.
    const far = sz.mode === 'portrait' ? { x: m.restart.right + 80, y: p.bottom - 2 } : { x: (m.cue.x + m.cue.right) / 2, y: p.bottom + 2 };
    if (far.y < m.vh) await page.touchscreen.tap(far.x, far.y);
    const nearCombat = sz.mode === 'portrait' ? { x: pu.x + pu.w / 2, y: (pu.bottom + p.y) / 2 } : { x: (m.cue.right + m.guard.x) / 2, y: p.y + p.h / 2 };
    await page.touchscreen.tap(nearCombat.x, nearCombat.y);
    assert.equal(await state(page), 'playing', `${sz.name}: gap taps do not pause`);
    // repeated punches 2px inside the lower corners, away from Pause by >=16px
    const corners = sz.mode === 'portrait' ? [[pu.x + 2, pu.bottom - 2], [pu.right - 2, pu.bottom - 2]] : [[pu.x + 2, pu.bottom - 2], [pu.right - 2, pu.bottom - 2]];
    for (let i = 0; i < 6; i++) { const [x, y] = corners[i % 2]; await page.touchscreen.tap(x, y); }
    assert.ok(Number(await requests(page)) - Number(before) >= 6, `${sz.name}: every corner tap was a Punch request`);
    assert.equal(await state(page), 'playing', 'repeated lower-corner Punch taps never paused');
    // deliberate tap 1px inside the Pause edge
    await page.touchscreen.tap(p.x + 1, p.y + 1);
    assert.equal(await state(page), 'paused');
    assert.equal(await page.isVisible('#dlg-pause'), true);
    await g.context.close();
  }
});

/** CDP touch helpers: touchEnd lists the contacts being released (as in game.test.mjs multi-touch). */
async function touchApi(g) {
  const cdp = await g.context.newCDPSession(g.page);
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  return { start: (pts) => send('touchStart', pts), move: (pts) => send('touchMove', pts), end: (pts) => send('touchEnd', pts), cancel: () => send('touchCancel', []) };
}

for (const sz of MOBILE.slice(0, 3)) {
  test(`${sz.name}: a Guard or Punch touch dragged and released over Pause/Restart never activates the utility; Guard releases, Punch counts once; simultaneous Guard+Punch survive`, async () => {
    const g = await activePage(sz);
    const { page } = g;
    const t = await touchApi(g);
    const m = await rects(page);
    const gc = center(m.guard); const pc = center(m.punch); const pa = center(m.pause); const re = center(m.restart);
    await page.evaluate(() => { window.__clicks = []; for (const id of ['btn-pause', 'btn-restart-play']) document.getElementById(id).addEventListener('click', () => window.__clicks.push(id)); });
    // Guard drag over Pause then release over Restart
    await t.start([{ ...gc, id: 1 }]);
    assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'true');
    await t.move([{ ...pa, id: 1 }]);
    assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'true', 'capture keeps Guard held while dragging over Pause');
    await t.move([{ ...re, id: 1 }]);
    await t.end([{ ...re, id: 1 }]);
    assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'false', 'Guard released on pointerup');
    assert.deepEqual(await page.evaluate(() => window.__clicks), [], 'no utility click');
    assert.equal(await state(page), 'playing');
    // Punch drag over Pause and release there
    const before = Number(await requests(page));
    await t.start([{ ...pc, id: 2 }]);
    await t.move([{ ...pa, id: 2 }]);
    await t.end([{ ...pa, id: 2 }]);
    assert.equal(Number(await requests(page)) - before, 1, 'exactly one Punch request');
    assert.deepEqual(await page.evaluate(() => window.__clicks), []);
    assert.equal(await state(page), 'playing');
    // simultaneous Guard + Punch, Punch finger released over Pause, Guard finger keeps holding
    await t.start([{ ...gc, id: 3 }]);
    await t.start([{ ...gc, id: 3 }, { ...pc, id: 4 }]);
    assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'true');
    await t.move([{ ...gc, id: 3 }, { ...pa, id: 4 }]);
    await t.end([{ ...pa, id: 4 }]);
    assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'true', 'Guard still held after the Punch finger ended over Pause');
    assert.deepEqual(await page.evaluate(() => window.__clicks), []);
    assert.equal(await state(page), 'playing');
    await t.end([{ ...gc, id: 3 }]);
    assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'false');
    // pointercancel and lost capture release Guard and never click a utility
    await t.start([{ ...gc, id: 5 }]);
    assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'true');
    await t.cancel();
    assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'false', 'cancel releases Guard');
    await page.evaluate(() => { window.__pid = null; document.getElementById('btn-guard').addEventListener('pointerdown', (e) => { window.__pid = e.pointerId; }); });
    await t.start([{ ...gc, id: 6 }]);
    assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'true');
    // Chromium emulation does not deliver a browser-generated lostpointercapture for touch here, so the event is
    // dispatched synthetically to prove the handler (the same path a real lost capture takes).
    await page.evaluate(() => document.getElementById('btn-guard').dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: window.__pid, bubbles: false })));
    assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'false', 'lost capture releases Guard (synthetic event)');
    await t.end([{ ...gc, id: 6 }]);
    assert.deepEqual(await page.evaluate(() => window.__clicks), []);
    assert.equal(await state(page), 'playing');
    assert.deepEqual(g.problems, []);
    await g.context.close();
  });
}

test('mouse: a press that starts on Punch and is released over Pause does not activate Pause; a deliberate click on Pause pauses exactly once', async () => {
  const g = await activePage(MOBILE[1]);
  const { page } = g;
  const m = await rects(page);
  const pc = center(m.punch); const pa = center(m.pause);
  await page.evaluate(() => { window.__clicks = 0; document.getElementById('btn-pause').addEventListener('click', () => { window.__clicks += 1; }); });
  const before = Number(await requests(page));
  await page.mouse.move(pc.x, pc.y); await page.mouse.down(); await page.mouse.move(pa.x, pa.y, { steps: 4 }); await page.mouse.up();
  assert.equal(await page.evaluate(() => window.__clicks), 0);
  assert.equal(await state(page), 'playing');
  assert.equal(Number(await requests(page)) - before, 1);
  await page.mouse.click(pa.x, pa.y);
  assert.equal(await page.evaluate(() => window.__clicks), 1, 'one native click');
  assert.equal(await state(page), 'paused');
  assert.ok(await page.waitForSelector('#dlg-pause', { state: 'visible' }));
  await g.context.close();
});

for (const key of ['Enter', 'Space']) {
  test(`native keyboard activation (${key}) of Pause pauses once; Resume keeps the round (countdown, no Intro); Restart (utility) returns to focused Intro`, async () => {
    const g = await activePage(MOBILE[0]);
    const { page } = g;
    await page.keyboard.down('k');
    await page.clock.runFor(1500);
    assert.deepEqual(await hp(page), [96, 100]);
    await page.keyboard.up('k');
    // pausing by keyboard from the countdown (focus is still inside the play region there)
    await page.keyboard.press('Escape'); await page.click('#btn-resume');
    assert.equal(await state(page), 'countdown');
    await page.evaluate(() => { window.__clicks = 0; document.getElementById('btn-pause').addEventListener('click', () => { window.__clicks += 1; }); });
    await page.focus('#btn-pause');
    await page.keyboard.press(key);
    assert.equal(await page.evaluate(() => window.__clicks), 1, 'exactly one activation');
    assert.equal(await state(page), 'paused');
    assert.equal(await page.isVisible('#dlg-pause'), true);
    await page.click('#btn-resume');
    assert.equal(await state(page), 'countdown');
    assert.equal(await page.isVisible('#panel-intro'), false, 'Resume is not a reset');
    for (let i = 0; i < 300 && (await state(page)) !== 'playing'; i++) await page.clock.runFor(16);
    assert.deepEqual(await hp(page), [96, 100], 'same round');
    // Restart from the lower utility row
    await page.click('#btn-restart-play');
    assert.equal(await state(page), 'intro');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-start');
    assert.deepEqual([await text(page, '#time-left'), ...(await hp(page))], ['30', 100, 100]);
    await g.context.close();
  });
}

test('utilities are stable while the cue changes, input is held and provider events complete; Intro exposes no active launchers', async () => {
  const g = await openGame(env, { viewport: { width: 390, height: 844 }, touch: true, freeze: true, provider: 'deferred' });
  const { page } = g;
  const vis = () => page.evaluate(() => [...document.querySelectorAll('#panel-tools button')].filter((b) => b.getClientRects().length).map((b) => b.id));
  assert.deepEqual(await vis(), ['btn-sound'], 'Intro: only Sound, no Pause/Restart launchers');
  await startFight(page);
  assert.deepEqual(await vis(), ['btn-pause', 'btn-restart-play']);
  const snap = async () => { const m = await rects(page); return [m.pause, m.restart, m.guard, m.punch, m.arena, m.cue].map((r) => [r.x, r.y, r.w, r.h].map((v) => Math.round(v * 10) / 10)); };
  const first = await snap();
  await page.keyboard.down('k');
  for (const ms of [300, 700, 450]) { await page.clock.runFor(ms); assert.deepEqual(await snap(), first, `stable at +${ms}`); }
  await page.evaluate(() => window.__settle[0]('ok')); // provider completes mid-fight
  assert.deepEqual(await snap(), first, 'provider completion never moves the utilities');
  assert.equal(await state(page), 'playing');
  await g.context.close();
});

test('reduced motion: identical utility geometry; Pause/Resume/Restart behave the same', async () => {
  const sz = MOBILE[1];
  const a = await activePage(sz);
  const ma = await rects(a.page);
  await a.context.close();
  const g = await activePage(sz, { reducedMotion: 'reduce' });
  const mb = await rects(g.page);
  for (const k of ['pause', 'restart', 'guard', 'punch', 'arena', 'cue', 'badge']) assert.deepEqual([mb[k].x, mb[k].y, mb[k].w, mb[k].h], [ma[k].x, ma[k].y, ma[k].w, ma[k].h], k);
  await g.page.click('#btn-pause');
  assert.equal(await state(g.page), 'paused');
  await g.context.close();
});

test('desktop (>=900px) utility placement and look are unchanged: heading-row text buttons, no badge', async () => {
  const g = await openGame(env, { viewport: { width: 1280, height: 720 }, freeze: true });
  const { page } = g;
  await startFight(page);
  const m = await rects(page);
  assert.ok(m.pause.y < m.hud.y && m.restart.y < m.hud.y, 'in the heading row above the HUD');
  assert.equal(Math.round(m.pause.w), 74); assert.equal(Math.round(m.pause.h), 44);
  assert.equal(m.badge.shown, false, 'badge hidden on desktop');
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.pause-label')).display), 'none', 'text label shown on desktop');
  assert.equal(await page.getByRole('button', { name: 'Pause game' }).count(), 1);
  await g.context.close();
});

test('stopped states (Intro, Result) show no Pause/Restart launchers on mobile', async () => {
  const g = await openGame(env, { viewport: { width: 390, height: 844 }, touch: true, freeze: true });
  const { page } = g;
  for (const id of ['btn-pause', 'btn-restart-play']) assert.equal(await page.isVisible(`#${id}`), false);
  await startFight(page);
  await page.clock.runFor(9700); // loss
  assert.equal(await state(page), 'result');
  for (const id of ['btn-pause', 'btn-restart-play']) assert.equal(await page.isVisible(`#${id}`), false);
  await g.context.close();
});

test('touch: a press on Pause or Restart dragged away and released elsewhere does nothing (activation is on release, never on press)', async () => {
  const g = await activePage(MOBILE[1]);
  const { page } = g;
  const t = await touchApi(g);
  const m = await rects(page);
  const pa = center(m.pause); const re = center(m.restart); const ar = center(m.arena);
  await page.evaluate(() => { window.__clicks = []; for (const id of ['btn-pause', 'btn-restart-play']) document.getElementById(id).addEventListener('click', () => window.__clicks.push(id)); });
  await t.start([{ ...pa, id: 1 }]); await t.move([{ ...ar, id: 1 }]); await t.end([{ ...ar, id: 1 }]);
  assert.equal(await state(page), 'playing');
  await t.start([{ ...re, id: 2 }]); await t.move([{ x: re.x, y: re.y - 80, id: 2 }]); await t.end([{ x: re.x, y: re.y - 80, id: 2 }]);
  assert.equal(await state(page), 'playing');
  assert.deepEqual(await page.evaluate(() => window.__clicks), []);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'arena');
  await g.context.close();
});

test('mouse: a press on Pause held while the pointer leaves does nothing; blank-panel presses keep the round and focus; presses outside the panel still pause', async () => {
  const g = await activePage(MOBILE[1], { touch: false });
  const { page } = g;
  const m = await rects(page);
  const pa = center(m.pause);
  await page.mouse.move(pa.x, pa.y); await page.mouse.down();
  assert.equal(await state(page), 'playing', 'pressing Pause does not pause');
  await page.mouse.move(pa.x + 120, pa.y - 200, { steps: 3 }); await page.mouse.up();
  assert.equal(await state(page), 'playing');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'arena', 'focus stayed in the play region through the press');
  const hd = await page.evaluate(() => { const r = document.getElementById('hud').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(hd.x, hd.y);
  assert.equal(await state(page), 'playing');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'arena');
  await page.evaluate(() => document.getElementById('news').scrollIntoView());
  await page.click('#news h2');
  assert.equal(await state(page), 'paused', 'intentional interaction outside the play panel still pauses');
  await g.context.close();
});

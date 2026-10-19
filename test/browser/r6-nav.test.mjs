// Previous/Next game arrows. Neighbor editions here are ISOLATED NON-PUBLIC FIXTURES (stub pages in a temp build);
// nothing here is, or ships as, a real release. The real preview endpoints are checked in the first test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, openGame, state, text, startFight, hp } from './helpers.mjs';

const CAND = '/games/2026-10-17/';
const gn = (page, kind) => page.evaluate((k) => {
  const el = document.querySelector(`.site-nav [data-gn="${k}"]`);
  const r = el.getBoundingClientRect();
  return { tag: el.tagName, href: el.getAttribute('href'), disabled: el.disabled === true, hasHref: el.hasAttribute('href'), onclick: el.onclick, name: el.textContent.replace(/\s+/g, ' ').trim(), w: r.width, h: r.height,
    visible: el.querySelector('small')?.firstChild?.textContent ?? null, header: el.closest('.site-header') !== null, tabbable: el.tabIndex >= 0 && !el.disabled };
}, kind);

test('real preview endpoints (empty verified registry): both ends are genuine disabled buttons with honest messages', async () => {
  const env = await setup();
  try {
    const g = await openGame(env, { viewport: { width: 320, height: 640 } });
    const { page } = g;
    assert.equal(await page.getAttribute('nav.site-nav', 'aria-label'), 'Game navigation');
    assert.equal(await page.locator('nav').count(), 1, 'one compact navigation, no second toolbar');
    const [prev, next] = [await gn(page, 'prev'), await gn(page, 'next')];
    for (const e of [prev, next]) { assert.deepEqual([e.tag, e.disabled, e.hasHref], ['BUTTON', true, false]); assert.equal(e.tabbable, false); assert.ok(e.h >= 44 && e.w >= 44); }
    assert.match(prev.name, /^← Previous game None earlier — No earlier released game$/);
    assert.match(next.name, /^Next game → None later — No later released game$/);
    assert.equal(prev.visible, 'None earlier');
    assert.equal(next.visible, 'None later');
    assert.equal(await page.getByRole('button', { name: /Previous game.*No earlier released game/ }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: /Next game.*No later released game/ }).isDisabled(), true);
    assert.equal(await page.locator('.site-nav a[data-gn]').count(), 0);
    const geo = await page.evaluate(() => { const n = document.querySelector('.site-header').getBoundingClientRect(); const a = document.getElementById('arena').getBoundingClientRect(); return { navB: n.bottom, arenaT: a.top, sw: document.documentElement.scrollWidth, iw: window.innerWidth }; });
    assert.ok(geo.navB <= geo.arenaT, 'header above the arena');
    assert.ok(geo.sw <= geo.iw, 'no overflow at 320');
    assert.deepEqual(g.problems, []);
    await g.context.close();
  } finally { await env.close(); }
});

test('fixture: current only released and unrelated previews/scaffold never become destinations', async () => {
  const env = await setup({ fixture: { release: ['2026-10-17'], preview: ['2026-10-17', '2026-10-20'], stubs: [] } });
  try {
    const g = await openGame(env, { viewport: { width: 320, height: 640 } });
    for (const k of ['prev', 'next']) { const e = await gn(g.page, k); assert.equal(e.disabled, true); assert.equal(e.hasHref, false); }
    assert.equal(await g.page.locator('.site-nav a[data-gn]').count(), 0);
    assert.equal(await g.page.locator('.site-nav a[href="/games/2026-10-20/"]').count(), 1, 'the preview entry appears in the labeled date list only');
    await g.context.close();
  } finally { await env.close(); }
});

test('fixture: sparse released dates link the nearest released neighbors with exact routes, names, 44px targets, keyboard activation, back/forward', async () => {
  const release = ['2026-10-03', '2026-10-10', '2026-10-24', '2026-11-30'];
  const env = await setup({ fixture: { release, preview: ['2026-10-17', '2026-10-20'], stubs: release } });
  try {
    const g = await openGame(env, { viewport: { width: 320, height: 640 } });
    const { page } = g;
    const [prev, next] = [await gn(page, 'prev'), await gn(page, 'next')];
    assert.deepEqual([prev.tag, prev.href, next.tag, next.href], ['A', '/games/2026-10-10/', 'A', '/games/2026-10-24/']);
    assert.match(prev.name, /^← Previous game 10 Oct 2026 UTC$/);
    assert.match(next.name, /^Next game → 24 Oct 2026 UTC$/);
    assert.deepEqual([prev.visible, next.visible], ['10 Oct 2026', '24 Oct 2026']);
    assert.ok(prev.h >= 44 && prev.w >= 44 && next.h >= 44 && next.w >= 44);
    assert.equal(await page.getByRole('link', { name: /Previous game.*10 Oct 2026/ }).count(), 1);
    assert.equal(await page.getByRole('link', { name: /Next game.*24 Oct 2026/ }).count(), 1);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(sw[0] <= sw[1]);
    // selected date remains clearly displayed and the candidate is labeled preview
    assert.match(await text(page, 'nav[aria-label="Game navigation"] a[aria-current="page"]'), /^17 Oct 2026 — Preview \(not released\)\s*UTC edition$/);
    // keyboard activation of Next, then the fixture neighbor's own ends are computed from released editions only
    await page.focus('.site-nav [data-gn="next"]');
    await page.keyboard.press('Enter');
    await page.waitForURL(`${env.host.origin}/games/2026-10-24/`);
    assert.equal(await page.locator('.site-nav [data-gn="prev"]').getAttribute('href'), '/games/2026-10-10/', 'candidate is not a released destination');
    assert.equal(await page.locator('.site-nav [data-gn="next"]').getAttribute('href'), '/games/2026-11-30/');
    assert.match(await text(page, 'nav[aria-label="Game navigation"] a[aria-current="page"]'), /^24 Oct 2026\s*UTC edition$/);
    await page.goBack();
    await page.waitForURL(`${env.host.origin}${CAND}`);
    assert.equal(await state(page), 'intro');
    await page.goForward();
    await page.waitForURL(`${env.host.origin}/games/2026-10-24/`);
    assert.deepEqual(g.problems, []);
    await g.context.close();
  } finally { await env.close(); }
});

test('fixture: arrows behave like other links — leaving play stops the fight and returning shows Intro', async () => {
  const release = ['2026-10-10', '2026-10-24'];
  const env = await setup({ fixture: { release, preview: ['2026-10-17'], stubs: release } });
  try {
    const g = await openGame(env, { viewport: { width: 390, height: 800 } });
    const { page } = g;
    await startFight(page);
    await page.keyboard.down('k');
    await page.clock.runFor(1500);
    assert.deepEqual(await hp(page), [96, 100]);
    await page.evaluate(() => document.querySelector('.site-nav').scrollIntoView());
    await Promise.all([page.waitForURL(`${env.host.origin}/games/2026-10-10/`), page.click('.site-nav [data-gn="prev"]')]);
    await page.goBack();
    await page.waitForURL(`${env.host.origin}${CAND}`);
    assert.equal(await state(page), 'intro', 'never a resumed hidden fight');
    assert.deepEqual(await hp(page), [100, 100]);
    assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'false');
    await g.context.close();
  } finally { await env.close(); }
});

const headerGeometry = (page) => page.evaluate(() => {
  const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const box = (e) => { const r = e.getBoundingClientRect(); return { t: (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26), x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; };
  const head = document.querySelector('.site-header').getBoundingClientRect();
  const parts = [...document.querySelectorAll('.site-header .brand, .site-header .preview-badge, .site-header .steps > li > a, .site-header .steps > li > button, .site-header details.others > summary')].filter(vis).map(box);
  // cluster into visual rows (tolerance 20px)
  const rows = []; for (const p of [...parts].sort((a, b) => a.y - b.y)) { if (!rows.length || p.y - rows[rows.length - 1].y > 20) rows.push({ y: p.y, items: [p] }); else rows[rows.length - 1].items.push(p); }
  const cur = document.querySelector('.site-header a[aria-current="page"]');
  return { head: head.height, rows: rows.length, parts, cur: cur && vis(cur) ? box(cur) : null, curCount: document.querySelectorAll('.site-header a[aria-current="page"]').length, sw: document.documentElement.scrollWidth, vw: innerWidth, nav: document.querySelectorAll('nav').length, small: [...document.querySelectorAll('.site-header *')].filter((e) => vis(e) && e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => parseFloat(getComputedStyle(e).fontSize)) };
});

test('compact header: at most two short rows at 320/390/667, <=72px at 1280; 44px targets; selected date and Preview status visible; many dates stay bounded in a native chooser', async () => {
  const many = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-03', '2026-10-10', '2026-10-24', '2026-11-30'];
  for (const [label, fixture] of [['real registry (one date)', null], ['archive fixture (10 dates)', { release: many, preview: ['2026-10-17'], stubs: many }]]) {
    const env = await setup(fixture ? { fixture } : {});
    try {
      for (const [w, h, maxHeader, maxRows] of [[320, 568, 112, 2], [390, 844, 112, 2], [667, 375, 112, 2], [1280, 720, 72, 1]]) {
        const g = await openGame(env, { viewport: { width: w, height: h } });
        const { page } = g;
        const m = await headerGeometry(page);
        assert.ok(m.head <= maxHeader, `${label} ${w}x${h}: header ${m.head}px <= ${maxHeader}`);
        assert.ok(m.rows <= maxRows, `${label} ${w}x${h}: ${m.rows} rows <= ${maxRows} ${JSON.stringify(m.parts.map((p) => [p.t, Math.round(p.y)]))}`);
        assert.equal(m.curCount, 1, 'exactly one real aria-current link');
        assert.ok(m.cur && /^17 Oct 2026/.test(m.cur.t), `${label} ${w}: selected date visible (${m.cur?.t})`);
        assert.ok(await page.locator('.preview-badge').isVisible(), 'Preview status visible');
        assert.equal(m.nav, 1);
        assert.ok(m.sw <= m.vw, 'no horizontal overflow');
        for (const t of m.parts.filter((p) => !/^Preview — not released$/.test(p.t))) assert.ok(t.h >= 44 && t.w >= 44 && t.x >= -0.5 && t.right <= w + 0.5, `${label} ${w}: target ${JSON.stringify(t)}`);
        assert.ok(m.small.every((f) => f >= 13), `no tiny text ${m.small}`);
        await g.context.close();
      }
    } finally { await env.close(); }
  }
});

test('date chooser: every other edition stays a real link in a bounded native <details>; opening it never grows the header; keyboard opens it; arrows and news/footer paths still work', async () => {
  const many = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-03', '2026-10-10', '2026-10-24', '2026-11-30'];
  const env = await setup({ fixture: { release: many, preview: ['2026-10-17'], stubs: many } });
  try {
    for (const [w, h] of [[320, 568], [1280, 720]]) {
      const g = await openGame(env, { viewport: { width: w, height: h } });
      const { page } = g;
      const closed = await headerGeometry(page);
      assert.equal(await page.locator('details.others a.date-link').count(), 9, 'all other dates are real links');
      assert.equal(await page.locator('details.others a[aria-current]').count(), 0);
      assert.equal(await page.isVisible('details.others ul'), false, 'closed by default');
      await page.focus('details.others > summary');
      await page.keyboard.press('Enter');
      assert.equal(await page.isVisible('details.others ul'), true, 'keyboard opens the chooser');
      const open = await page.evaluate(() => { const u = document.querySelector('details.others ul').getBoundingClientRect(); return { h: u.height, right: u.right, left: u.left, vw: innerWidth, head: document.querySelector('.site-header').getBoundingClientRect().height, scroll: getComputedStyle(document.querySelector('details.others ul')).overflowY, max: getComputedStyle(document.querySelector('details.others ul')).maxHeight }; });
      assert.equal(open.head, closed.head, 'opening does not change the header height');
      assert.ok(open.h <= h * 0.5 + 1 && open.scroll === 'auto' && open.left >= -0.5 && open.right <= open.vw + 0.5, `bounded dropdown ${JSON.stringify(open)}`);
      await page.keyboard.press('Tab');
      assert.match(await page.evaluate(() => document.activeElement?.getAttribute('href') || ''), /^\/games\/2026-09-01\/$/, 'Tab goes into the first listed date');
      await page.focus('details.others > summary'); await page.keyboard.press('Enter');
      assert.equal(await page.isVisible('details.others ul'), false);
      // arrows: nearest released neighbors, the candidate is never a destination
      assert.equal(await page.locator('.site-nav [data-gn="prev"]').getAttribute('href'), '/games/2026-10-10/');
      assert.equal(await page.locator('.site-nav [data-gn="next"]').getAttribute('href'), '/games/2026-10-24/');
      // Tab path still reaches the news link and the footer About
      await page.focus('#btn-start');
      const seen = [];
      for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); seen.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.textContent?.trim().slice(0, 22))); }
      assert.ok(seen.includes('link-open-x') && seen.includes('btn-about') && seen.some((x) => /FearedBuck reporting/.test(x)), seen.join(' | '));
      await g.context.close();
    }
    // choosing another date navigates to its stable route
    const g = await openGame(env, { viewport: { width: 320, height: 568 } });
    await g.page.click('details.others > summary');
    await Promise.all([g.page.waitForURL(`${env.host.origin}/games/2026-09-08/`), g.page.click('details.others a[href="/games/2026-09-08/"]')]);
    assert.match(await g.page.textContent('h1'), /Fixture 2026-09-08/);
    assert.equal(await g.page.locator('.site-header a[aria-current="page"]').count(), 1);
    await g.context.close();
  } finally { await env.close(); }
});

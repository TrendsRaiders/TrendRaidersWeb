// Previous/Next game arrows. Neighbor editions here are ISOLATED NON-PUBLIC FIXTURES (stub pages in a temp build);
// nothing here is, or ships as, a real release. The real preview endpoints are checked in the first test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, openGame, state, text, startFight, hp } from './helpers.mjs';

const CAND = '/games/2026-10-17/';
const gn = (page, kind) => page.evaluate((k) => {
  const el = document.querySelector(`.game-nav [data-gn="${k}"]`);
  const r = el.getBoundingClientRect();
  return { tag: el.tagName, href: el.getAttribute('href'), disabled: el.disabled === true, hasHref: el.hasAttribute('href'), onclick: el.onclick, name: el.textContent.replace(/\s+/g, ' ').trim(), w: r.width, h: r.height,
    note: el.closest('.gn-item').querySelector('.gn-note')?.textContent ?? null, tabbable: el.tabIndex >= 0 && !el.disabled };
}, kind);

test('real preview endpoints (empty verified registry): both ends are genuine disabled buttons with honest messages', async () => {
  const env = await setup();
  try {
    const g = await openGame(env, { viewport: { width: 320, height: 640 } });
    const { page } = g;
    assert.equal(await page.getAttribute('nav.game-nav', 'aria-label'), 'Game navigation');
    const [prev, next] = [await gn(page, 'prev'), await gn(page, 'next')];
    for (const e of [prev, next]) { assert.deepEqual([e.tag, e.disabled, e.hasHref], ['BUTTON', true, false]); assert.equal(e.tabbable, false); assert.ok(e.h >= 44 && e.w >= 44); }
    assert.equal(prev.name, '← Previous game');
    assert.equal(next.name, 'Next game →');
    assert.equal(prev.note, 'No earlier released game');
    assert.equal(next.note, 'No later released game');
    assert.equal(await page.locator('.game-nav a').count(), 0);
    const geo = await page.evaluate(() => { const n = document.querySelector('.game-nav').getBoundingClientRect(); const a = document.getElementById('arena').getBoundingClientRect(); return { navB: n.bottom, arenaT: a.top, sw: document.documentElement.scrollWidth, iw: window.innerWidth }; });
    assert.ok(geo.navB <= geo.arenaT, 'above the arena');
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
    assert.equal(await g.page.locator('.game-nav a').count(), 0);
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
    assert.equal(prev.name, '← Previous game 10 Oct 2026');
    assert.equal(next.name, 'Next game → 24 Oct 2026');
    assert.ok(prev.h >= 44 && prev.w >= 44 && next.h >= 44 && next.w >= 44);
    assert.equal(await page.getByRole('link', { name: /Previous game.*10 Oct 2026/ }).count(), 1);
    assert.equal(await page.getByRole('link', { name: /Next game.*24 Oct 2026/ }).count(), 1);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(sw[0] <= sw[1]);
    // selected date remains clearly displayed and the candidate is labeled preview
    assert.equal(await text(page, 'nav[aria-label="Game editions"] a[aria-current="page"]'), '17 Oct 2026 — Preview (not released)');
    // keyboard activation of Next, then the fixture neighbor's own ends are computed from released editions only
    await page.focus('.game-nav [data-gn="next"]');
    await page.keyboard.press('Enter');
    await page.waitForURL(`${env.host.origin}/games/2026-10-24/`);
    assert.equal(await page.locator('.game-nav [data-gn="prev"]').getAttribute('href'), '/games/2026-10-10/', 'candidate is not a released destination');
    assert.equal(await page.locator('.game-nav [data-gn="next"]').getAttribute('href'), '/games/2026-11-30/');
    assert.equal(await text(page, 'nav[aria-label="Game editions"] a[aria-current="page"]'), '24 Oct 2026');
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
    await page.evaluate(() => document.querySelector('.game-nav').scrollIntoView());
    await Promise.all([page.waitForURL(`${env.host.origin}/games/2026-10-10/`), page.click('.game-nav [data-gn="prev"]')]);
    await page.goBack();
    await page.waitForURL(`${env.host.origin}${CAND}`);
    assert.equal(await state(page), 'intro', 'never a resumed hidden fight');
    assert.deepEqual(await hp(page), [100, 100]);
    assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'false');
    await g.context.close();
  } finally { await env.close(); }
});

// PUBLIC-mode candidate (17 Oct boxing + 18 Oct Fly), served from the repository's public build. Real Chromium, mocked X.
// This proves the STAGED artifact; no release has happened and nothing here is human play evidence.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, openGame, state, text, hp, startFight, playToWin } from './helpers.mjs';
import { open as openFly, start as flyStart, playFake, withGame } from './fly-helpers.mjs';
import { readSim } from '../../scripts/lib/fly-bot.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup({ publicCandidate: true }); });
after(async () => { await env.close(); });

const ORIGIN = 'https://empty-site-7f987b.netlify.app';
const BOX = '/games/2026-10-17/'; const FLY = '/games/2026-10-18/';
const url = (p) => `${env.host.origin}${p}`;
const here = (page) => new URL(page.url()).pathname;
const current = (page) => page.evaluate(() => { const a = document.querySelectorAll('.site-header a[aria-current="page"]'); return [a.length, a[0]?.getAttribute('href'), a[0]?.textContent.trim().slice(0, 11)]; });

test('root is the latest edition (Fly) with the selected UTC date, no preview framing, footer About; direct dated routes and refresh keep their date', async () => {
  const g = await openGame(env, { route: '/', viewport: { width: 1280, height: 720 } });
  const { page } = g;
  assert.deepEqual(await current(page), [1, FLY, '18 Oct 2026']);
  assert.equal(await page.locator('.preview-badge').count(), 0);
  assert.equal(await page.locator('meta[name="robots"]').count(), 0, 'public pages are indexable');
  assert.equal(await page.locator('footer #btn-about, footer a[href*="about" i], footer button').count() >= 1, true, 'footer About');
  await page.goto(url(BOX));
  assert.deepEqual(await current(page), [1, BOX, '17 Oct 2026']);
  assert.equal(await page.locator('footer #btn-about').count(), 1);
  await page.reload();
  assert.deepEqual(await current(page), [1, BOX, '17 Oct 2026']);
  assert.equal(await state(page), 'intro');
  await page.goto(url(FLY)); await page.reload();
  assert.deepEqual(await current(page), [1, FLY, '18 Oct 2026']);
  assert.deepEqual(g.problems, []);
  await g.context.close();
});

test('arrows link the two editions both ways with enabled 44px targets; back/forward and refresh select the right edition and start at Intro', async () => {
  const g = await openGame(env, { route: BOX, viewport: { width: 390, height: 844 } });
  const { page } = g;
  const prev = page.locator('.site-nav [data-gn="prev"]'); const next = page.locator('.site-nav [data-gn="next"]');
  assert.equal(await prev.evaluate((e) => e.tagName + e.disabled), 'BUTTONtrue');
  assert.equal(await next.getAttribute('href'), FLY);
  const bb = await next.boundingBox(); assert.ok(bb.width >= 44 && bb.height >= 44);
  await Promise.all([page.waitForURL(url(FLY)), next.click()]);
  assert.deepEqual(await current(page), [1, FLY, '18 Oct 2026']);
  assert.equal(await page.locator('.site-nav [data-gn="prev"]').getAttribute('href'), BOX);
  assert.equal(await page.locator('.site-nav [data-gn="next"]').evaluate((e) => e.tagName + e.disabled), 'BUTTONtrue');
  await page.goBack(); await page.waitForURL(url(BOX));
  assert.deepEqual(await current(page), [1, BOX, '17 Oct 2026']);
  assert.equal(await state(page), 'intro');
  await page.goForward(); await page.waitForURL(url(FLY));
  assert.deepEqual(await current(page), [1, FLY, '18 Oct 2026']);
  await Promise.all([page.waitForURL(url(BOX)), page.click('.site-nav [data-gn="prev"]')]);
  await page.reload(); assert.deepEqual(await current(page), [1, BOX, '17 Oct 2026']);
  await g.context.close();
});

test('mobile/keyboard date chooser at 320px: native <details> opens with Enter, Tab enters the other date, Enter navigates; header stays two rows', async () => {
  for (const start of [BOX, FLY]) {
    const g = await openGame(env, { route: start, viewport: { width: 320, height: 568 } });
    const { page } = g;
    const other = start === BOX ? FLY : BOX;
    assert.ok((await page.locator('.site-header').boundingBox()).height <= 112, 'compact header');
    await page.focus('details.others > summary');
    await page.keyboard.press('Enter');
    assert.equal(await page.isVisible('details.others ul'), true);
    const sb = await page.locator('details.others > summary').boundingBox(); assert.ok(sb.width >= 44 && sb.height >= 44);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('href')), other);
    await Promise.all([page.waitForURL(url(other)), page.keyboard.press('Enter')]);
    assert.equal((await current(page))[1], other);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await g.context.close();
  }
});

test('unknown dates are a genuine 404 listing only the two available editions; /games/ and a future date are not aliased to a game', async () => {
  for (const p of ['/games/2026-10-19/', '/games/2026-10-16/', '/games/']) {
    const r = await fetch(url(p));
    assert.equal(r.status, 404, p);
    const body = await r.text();
    assert.match(body, /Page not found/); assert.doesNotMatch(body, /id="app"|id="game"/);
    assert.ok(body.includes('href="/games/2026-10-17/"') && body.includes('href="/games/2026-10-18/"'));
  }
  const g = await openGame(env, { route: '/games/2026-10-19/' });
  assert.equal(await g.page.locator('#game').count(), 0);
  await g.context.close();
});

test('boxing (public): win -> Retry returns to Intro; Pause/Resume keep the round', async () => {
  const g = await openGame(env, { route: BOX, viewport: { width: 390, height: 844 }, touch: true, freeze: true });
  const { page } = g;
  await startFight(page);
  await page.keyboard.down('k'); await page.clock.runFor(1500);
  assert.deepEqual(await hp(page), [96, 100]);
  await page.keyboard.up('k');
  await page.click('#btn-pause');
  assert.equal(await state(page), 'paused');
  await page.click('#btn-resume');
  assert.equal(await state(page), 'countdown');
  for (let i = 0; i < 300 && (await state(page)) !== 'playing'; i++) await page.clock.runFor(16);
  assert.deepEqual(await hp(page), [96, 100]);
  await page.click('#btn-restart-play');
  assert.equal(await state(page), 'intro');
  await startFight(page); await playToWin(page);
  assert.equal(await state(page), 'result');
  assert.equal(await text(page, '#result-headline'), 'KO! You beat the 30-second headline.');
  assert.equal(await text(page, '#btn-share'), 'Share result');
  await page.click('#btn-retry');
  assert.equal(await state(page), 'intro');
  assert.deepEqual([await text(page, '#time-left'), ...(await hp(page))], ['30', 100, 100]);
  assert.deepEqual(g.problems, []);
  await g.context.close();
});

test('Fly (public): win -> Play again returns to Intro; Pause/Resume keep the run', async () => {
  await withGame(env, {}, async ({ page }) => {
    await flyStart(page);
    await page.click('#btn-pause');
    let s = await readSim(page);
    assert.equal(s.state, 'paused');
    const t = s.tUs;
    await page.clock.runFor(2000);
    assert.equal((await readSim(page)).tUs, t, 'frozen');
    await page.click('#btn-resume');
    s = await readSim(page);
    assert.ok(['running', 'paused', 'resuming'].includes(s.state));
    await page.click('#btn-restart-paused').catch(async () => { await page.keyboard.press('Escape'); await page.click('#btn-restart-paused'); });
    assert.equal((await readSim(page)).state, 'intro');
    await flyStart(page);
    const w = await playFake(page);
    assert.equal(w.state, 'won'); assert.equal(w.cleared, 7);
    assert.equal(await page.textContent('#result-heading'), 'You escaped the simulation.');
    await page.click('#btn-again');
    assert.equal((await readSim(page)).state, 'intro');
  });
});

// ---- sharing: only the stable DATED production URL ------------------------------------------------------------
async function boxingResult(page, outcome) {
  await startFight(page);
  if (outcome === 'win') await playToWin(page); else await page.clock.runFor(9600);
  assert.equal(await state(page), 'result');
}
const BOX_WIN = (t) => `I scored a KO in ${t}s in 30-Second KO. Can you beat my time? ${ORIGIN}${BOX}`;
const BOX_LOSS = `Can you land a KO in 30 seconds? Try 30-Second KO: ${ORIGIN}${BOX}`;

test('boxing share (public): Web Share gets the exact text with the dated production URL; a loss uses the loss text', async () => {
  for (const outcome of ['win', 'loss']) {
    const g = await openGame(env, { route: BOX, viewport: { width: 390, height: 844 }, freeze: true, init: () => { window.__shared = []; navigator.share = async (d) => { window.__shared.push(d); }; } });
    const { page } = g;
    await boxingResult(page, outcome);
    const time = outcome === 'win' ? (await text(page, '#result-time')).match(/(\d+\.\d\d)s/)[1] : '';
    assert.equal(await text(page, '#btn-share'), 'Share result');
    assert.doesNotMatch(await text(page, '#share-note'), /Link sharing is off/);
    await page.click('#btn-share');
    assert.deepEqual(await page.evaluate(() => window.__shared), [{ text: outcome === 'win' ? BOX_WIN(time) : BOX_LOSS }]);
    assert.ok(!(await page.evaluate(() => window.__shared[0].text)).includes('127.0.0.1'), 'never the draft/test origin');
    await g.context.close();
  }
});

test('boxing share (public): canceled share is not an error or dialog; unsupported Web Share falls back to the clipboard; denied clipboard shows selectable text', async () => {
  let g = await openGame(env, { route: BOX, viewport: { width: 390, height: 844 }, freeze: true, init: () => { navigator.share = async () => { throw new DOMException('cancel', 'AbortError'); }; } });
  await boxingResult(g.page, 'loss');
  const before = await g.page.textContent('#panel-result');
  await g.page.click('#btn-share'); await g.page.waitForTimeout(150);
  assert.equal(await g.page.isVisible('#dlg-share'), false);
  assert.equal(await g.page.textContent('#panel-result'), before);
  assert.deepEqual(g.problems, []);
  await g.context.close();

  g = await openGame(env, { route: BOX, viewport: { width: 390, height: 844 }, freeze: true, init: () => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); window.__copied = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t); } }, configurable: true }); } });
  await boxingResult(g.page, 'loss');
  await g.page.click('#btn-share');
  assert.deepEqual(await g.page.evaluate(() => window.__copied), [BOX_LOSS]);
  await g.context.close();

  g = await openGame(env, { route: BOX, viewport: { width: 390, height: 844 }, freeze: true, init: () => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new DOMException('no', 'NotAllowedError'); } }, configurable: true }); } });
  await boxingResult(g.page, 'loss');
  await g.page.click('#btn-share');
  assert.equal(await g.page.isVisible('#dlg-share'), true);
  assert.equal(await g.page.inputValue('#share-text'), BOX_LOSS);
  assert.equal(await g.page.getAttribute('#share-text', 'readonly'), '');
  await g.context.close();
});

test('Fly share (public): Copy result writes the exact text with the dated production URL (also from the root page); denied clipboard shows selectable text', async () => {
  const SHARE = `I escaped the simulation. The banana was a desktop icon. — Fly the Simulation, 2026-10-18 ${ORIGIN}${FLY}`;
  for (const [route, denied] of [[FLY, false], ['/', false], [FLY, true]]) {
    const g = await openFly(env, { route, init: denied
      ? () => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new DOMException('no', 'NotAllowedError'); } }, configurable: true }); }
      : () => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t); } }, configurable: true }); } });
    const { page } = g;
    await flyStart(page);
    const w = await playFake(page);
    assert.equal(w.state, 'won');
    await page.click('#btn-copy');
    if (denied) { assert.equal(await page.isVisible('#copy-text'), true); assert.equal(await page.inputValue('#copy-text'), SHARE); }
    else assert.deepEqual(await page.evaluate(() => window.__copied), [SHARE]);
    assert.ok(!SHARE.includes('127.0.0.1'));
    assert.deepEqual(g.problems, []);
    await g.context.close();
  }
});

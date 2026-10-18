// r5 automatic source-post embed. The provider here is a MOCK served through request interception: these tests prove our
// integration, fallback, retry and race handling only. Real provider rendering is checked separately by
// scripts/real-embed-check.mjs (npm run check:embed-real).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, openGame, state, text, hp, startFight, until } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const TWEET = '2111278238253342868';
const SUMMARY = 'Source summary: FearedBuck reported a Jack Doherty knockout within the first 30 seconds at Brand Risk 16. Posted 17 October 2026, 02:08:52 UTC. This summary is not the embedded post.';
const NOTICE = 'This embedded post connects to X automatically. X may use cookies or other identifiers and download media.';
const FAIL_MSG = 'Post unavailable or blocked. You can still open the source on X.';
const embedState = (page) => page.getAttribute('#embed-area', 'data-embed-state');
const calls = (page) => page.evaluate(() => window.__tw?.calls ?? []);
const retryVisible = (page) => page.isVisible('#btn-retry-embed');
const iframes = (page) => page.evaluate(() => [...document.querySelectorAll('#embed-mount iframe')].map((f) => f.title));
const settle = (page, n, kind) => page.evaluate(([i, k]) => window.__settle[i](k), [n, kind]);
const rects = (page, sels) => page.evaluate((list) => Object.fromEntries(list.map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [s, [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10)]; })), sels);
const PLAY_SELS = ['.panel-head', '#hud', '#arena', '#cuebar', '#instr-play', '#btn-guard', '#btn-punch', '#btn-pause'];

test('automatic: one attempt at mount with no click or scroll; exact id/options; notice, summary and link visible; no Load button', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 568 }, provider: 'deferred' });
  const { page } = g;
  assert.ok(await until(async () => (await calls(page)).length === 1), 'attempt started on its own');
  assert.equal(g.provider.scriptRequests, 1);
  assert.equal(await embedState(page), 'loading');
  assert.equal(await text(page, '.privacy'), NOTICE);
  assert.equal(await text(page, '#embed-summary'), SUMMARY);
  assert.equal(await text(page, '#embed-status'), 'Loading source post from X…');
  assert.equal(await page.getAttribute('#link-open-x', 'href'), `https://twitter.com/FearedBuck/status/${TWEET}`);
  assert.equal(await page.locator('#btn-load-embed').count(), 0);
  assert.equal(await page.getByText('Load source post').count(), 0);
  assert.equal(await retryVisible(page), false);
  const [c] = await calls(page);
  assert.equal(c.id, TWEET);
  assert.equal(c.opts.conversation, 'none');
  assert.ok(c.opts.width >= 250 && c.opts.width <= 550);
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'no scroll to the widget');
  await settle(page, 0, 'ok');
  assert.equal(await embedState(page), 'loaded');
  assert.equal(await text(page, '#embed-status'), 'Source post loaded from X.');
  assert.equal(await page.isVisible('#embed-summary'), false);
  assert.equal(await page.isVisible('#link-open-x'), true, 'ordinary link persists');
  assert.equal(await page.isVisible('.privacy'), true, 'notice stays in every state');
  assert.deepEqual(await iframes(page), ['mock post 1']);
  assert.equal((await calls(page)).length, 1, 'exactly one widget attempt');
  assert.deepEqual(g.problems, []);
  await g.context.close();
});

test('a slow provider never blocks play; its 10 s fallback arrives mid-fight without touching state, input, time or geometry', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 568 }, provider: 'never' });
  const { page } = g;
  assert.ok(await until(async () => (await calls(page)).length === 1));
  await startFight(page); // the countdown and Play never wait for X
  await page.keyboard.down('k');
  await page.clock.runFor(1500);
  assert.deepEqual(await hp(page), [96, 100]);
  const before = await rects(page, PLAY_SELS);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.clock.runFor(8700); // crosses the provider's 10 s mark while the fight is still on
  assert.equal(await embedState(page), 'failed');
  assert.equal(await text(page, '#embed-status'), FAIL_MSG);
  assert.equal(await state(page), 'playing');
  assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'true', 'held Guard survives the provider failing');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'arena', 'no focus theft');
  assert.deepEqual(await rects(page, PLAY_SELS), before, 'active controls did not move or resize');
  assert.equal(await page.evaluate(() => window.scrollY), scrollBefore);
  assert.ok(Number(await text(page, '#time-left')) <= 21, 'the clock kept running');
  await g.context.close();
});

test('provider completion or error during held Guard, play and Pause never resets input, state or time, or moves the controls', async () => {
  for (const kind of ['ok', 'reject']) {
    const g = await openGame(env, { viewport: { width: 320, height: 568 }, provider: 'deferred' });
    const { page } = g;
    assert.ok(await until(async () => (await calls(page)).length === 1));
    await startFight(page);
    await page.keyboard.down('k');
    await page.clock.runFor(1500);
    const before = await rects(page, PLAY_SELS);
    const time = await text(page, '#time-left');
    await settle(page, 0, kind);
    assert.equal(await state(page), 'playing');
    assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'true', `${kind}: Guard still held`);
    assert.deepEqual(await hp(page), [96, 100]);
    assert.equal(await text(page, '#time-left'), time);
    assert.deepEqual(await rects(page, PLAY_SELS), before, `${kind}: no layout shift in the active panel`);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'arena');
    await page.clock.runFor(500);
    assert.equal(await state(page), 'playing');
    await g.context.close();
  }
  // while paused: completion changes nothing about the paused round
  const g = await openGame(env, { viewport: { width: 390, height: 844 }, provider: 'deferred' });
  const { page } = g;
  assert.ok(await until(async () => (await calls(page)).length === 1));
  await startFight(page);
  await page.keyboard.down('k');
  await page.clock.runFor(1500);
  await page.keyboard.press('Escape');
  assert.equal(await state(page), 'paused');
  const t = await text(page, '#time-left');
  await settle(page, 0, 'ok');
  await page.clock.runFor(5000);
  assert.equal(await state(page), 'paused');
  assert.equal(await text(page, '#time-left'), t);
  assert.deepEqual(await hp(page), [96, 100]);
  assert.equal(await page.isVisible('#dlg-pause'), true);
  await g.context.close();
});

for (const [name, mode] of [['post unavailable/deleted (createTweet resolves undefined)', 'undefined'], ['createTweet rejects', 'reject'], ['script blocked (CSP/network/adblock)', 'blocked'], ['offline', 'offline']]) {
  test(`fallback: ${name}; retry button only after failure; no automatic retry; explicit retry reuses the script and succeeds once`, async () => {
    const g = await openGame(env, { viewport: { width: 320, height: 568 }, provider: mode });
    const { page } = g;
    assert.ok(await until(async () => (await embedState(page)) === 'failed'), `state ${await embedState(page)}`);
    assert.equal(await text(page, '#embed-status'), FAIL_MSG);
    assert.equal(await text(page, '#btn-retry-embed'), 'Try loading again');
    assert.equal(await text(page, '#embed-summary'), SUMMARY, 'dated fallback summary remains');
    assert.equal(await page.isVisible('#link-open-x'), true);
    assert.equal(await page.isVisible('.privacy'), true);
    const before = [g.provider.scriptRequests, (await calls(page)).length];
    await page.clock.runFor(60000); // nothing polls or retries on its own
    assert.deepEqual([g.provider.scriptRequests, (await calls(page)).length], before);
    assert.equal(await embedState(page), 'failed', 'an error is never marked as a loaded tweet');
    g.provider.mode = 'success';
    // a reused (already loaded) script keeps its old behavior in the mock, so make the live API succeed for the retry
    if (mode === 'undefined' || mode === 'reject') await page.evaluate(() => { window.twttr.widgets.createTweet = (id, el) => { const f = document.createElement('iframe'); f.title = 'mock official post'; f.width = '300'; f.height = '200'; el.appendChild(f); return Promise.resolve(f); }; });
    await page.click('#btn-retry-embed');
    assert.ok(await until(async () => (await embedState(page)) === 'loaded'), `retry state ${await embedState(page)}`);
    assert.equal(await retryVisible(page), false);
    assert.deepEqual(await iframes(page), ['mock official post']);
    const scripts = await page.evaluate(() => document.querySelectorAll('script[src*="platform.twitter.com"]').length);
    assert.equal(scripts, 1, 'one provider script element');
    if (mode === 'undefined' || mode === 'reject') assert.equal(g.provider.scriptRequests, 1, 'loaded script reused, not downloaded again');
    await g.context.close();
  });
}

test('10-second timeout: loading at 9 s, fallback + retry at 10 s, and the retry works', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 568 }, provider: 'never' });
  const { page } = g;
  assert.ok(await until(async () => (await calls(page)).length === 1));
  await page.clock.runFor(9000);
  assert.equal(await embedState(page), 'loading');
  assert.equal(await retryVisible(page), false);
  await page.clock.runFor(1100);
  assert.equal(await embedState(page), 'failed');
  assert.equal(await text(page, '#embed-status'), FAIL_MSG);
  assert.equal(await retryVisible(page), true);
  await page.evaluate(() => { window.twttr.widgets.createTweet = (id, el) => { const f = document.createElement('iframe'); f.title = 'second'; f.width = '300'; f.height = '200'; el.appendChild(f); return Promise.resolve(f); }; });
  await page.click('#btn-retry-embed');
  assert.ok(await until(async () => (await embedState(page)) === 'loaded'));
  assert.deepEqual(await iframes(page), ['second']);
  assert.equal(g.provider.scriptRequests, 1, 'provider script is not fetched again');
  await g.context.close();
});

// ---- retry races: a superseded attempt must not duplicate content or mark the new attempt as loaded ----
async function timeoutThenRetry(page) {
  assert.ok(await until(async () => (await calls(page)).length === 1));
  await page.clock.runFor(10100);
  assert.equal(await embedState(page), 'failed');
  await page.click('#btn-retry-embed');
  assert.ok(await until(async () => (await calls(page)).length === 2));
  assert.equal(await embedState(page), 'loading');
}

test('race: attempt 1 resolves late after the retry started -> ignored (no duplicate, new attempt still loading), then attempt 2 completes once', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 568 }, provider: 'deferred' });
  const { page } = g;
  await timeoutThenRetry(page);
  await settle(page, 0, 'ok');
  assert.equal(await embedState(page), 'loading', 'old attempt cannot mark the new one successful');
  assert.deepEqual(await iframes(page), [], 'old content is not displayed');
  await settle(page, 1, 'ok');
  assert.equal(await embedState(page), 'loaded');
  assert.deepEqual(await iframes(page), ['mock post 2'], 'exactly the current attempt\'s post');
  await g.context.close();
});

test('race: attempt 2 completes first; attempt 1 late success, rejection or missing post changes nothing', async () => {
  for (const late of ['ok', 'reject', 'undefined']) {
    const g = await openGame(env, { viewport: { width: 320, height: 568 }, provider: 'deferred' });
    const { page } = g;
    await timeoutThenRetry(page);
    await settle(page, 1, 'ok');
    assert.equal(await embedState(page), 'loaded');
    await settle(page, 0, late);
    assert.equal(await embedState(page), 'loaded', `late ${late}`);
    assert.deepEqual(await iframes(page), ['mock post 2'], `late ${late}`);
    await g.context.close();
  }
});

test('race: a late failure from attempt 1 cannot fail attempt 2 while it is loading; attempt 2\'s own failure still counts', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 568 }, provider: 'deferred' });
  const { page } = g;
  await timeoutThenRetry(page);
  await settle(page, 0, 'reject');
  assert.equal(await embedState(page), 'loading');
  assert.equal(await text(page, '#embed-status'), 'Loading source post from X…');
  await settle(page, 1, 'undefined');
  assert.equal(await embedState(page), 'failed');
  await g.context.close();
});

test('same attempt: a late success after the 10 s fallback replaces it once, without stealing focus', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 568 }, provider: 'deferred' });
  const { page } = g;
  assert.ok(await until(async () => (await calls(page)).length === 1));
  await page.focus('#link-open-x');
  await page.clock.runFor(10100);
  assert.equal(await embedState(page), 'failed');
  await settle(page, 0, 'ok');
  assert.equal(await embedState(page), 'loaded');
  assert.deepEqual(await iframes(page), ['mock post 1']);
  assert.equal(await retryVisible(page), false);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'link-open-x');
  await g.context.close();
});

test('navigation: leaving and returning starts at most one new attempt, ignores stale callbacks, and shows a single post', async () => {
  const g = await openGame(env, { viewport: { width: 390, height: 844 }, provider: 'deferred' });
  const { page } = g;
  assert.ok(await until(async () => (await calls(page)).length === 1));
  await Promise.all([page.waitForURL(`${env.host.origin}/`), page.click('nav a.brand')]); // preview root = the same candidate page
  await page.goBack();
  await page.waitForURL(`${env.host.origin}/games/2026-10-17/`);
  assert.equal(await state(page), 'intro');
  assert.ok(await until(async () => (await calls(page)).length >= 1), 'the returned page made its own attempt');
  const n = (await calls(page)).length;
  assert.equal(n, 1, 'exactly one attempt on the returned page');
  await settle(page, 0, 'ok');
  assert.equal(await embedState(page), 'loaded');
  assert.deepEqual(await iframes(page), ['mock post 1']);
  assert.ok(g.provider.scriptRequests <= 3, `script requests ${g.provider.scriptRequests}`);
  await g.context.close();
});

test('unknown routes never contact the provider', async () => {
  const g = await openGame(env, { route: '/games/2026-10-18/', provider: 'success' });
  await g.page.waitForTimeout(500);
  assert.equal(g.provider.scriptRequests, 0);
  assert.equal(await g.page.locator('script').count(), 0);
  await g.context.close();
});

test('320px layout, fallback and loaded: no horizontal overflow, embed within its card, play panel unchanged, no focus theft', async () => {
  for (const mode of ['blocked', 'success']) {
    const g = await openGame(env, { viewport: { width: 320, height: 568 }, provider: mode });
    const { page } = g;
    assert.ok(await until(async () => ['failed', 'loaded'].includes(await embedState(page))));
    assert.equal(await embedState(page), mode === 'success' ? 'loaded' : 'failed');
    await page.evaluate(() => document.getElementById('news').scrollIntoView());
    const m = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const card = r('#source-post'); const mount = r('#embed-mount'); const iframe = document.querySelector('#embed-mount iframe')?.getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, cardL: card.left, cardR: card.right, mountR: mount.right, iframeR: iframe?.right ?? 0, gameBottom: r('#game').bottom + window.scrollY, newsTop: r('#news').top + window.scrollY };
    });
    assert.ok(m.sw <= m.iw && m.cardL >= 0 && m.cardR <= m.iw, JSON.stringify(m));
    assert.ok(m.mountR <= m.cardR + 0.5 && (!m.iframeR || m.iframeR <= m.cardR + 0.5), `embed within card ${JSON.stringify(m)}`);
    assert.ok(m.gameBottom <= m.newsTop, 'embed lives below the play panel');
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'nothing stole focus');
    assert.deepEqual(g.problems.filter((p) => !(mode === 'blocked' && /widgets\.js|ERR_BLOCKED_BY_CLIENT/.test(p))), []);
    await g.context.close();
  }
});

test('the reserved loading slot keeps the page height stable when the post appears, and the play panel does not move', async () => {
  const g = await openGame(env, { viewport: { width: 390, height: 844 }, provider: 'deferred' });
  const { page } = g;
  assert.ok(await until(async () => (await calls(page)).length === 1));
  const before = await rects(page, ['#game', '#arena', '#hud']);
  const slot = await page.evaluate(() => document.getElementById('embed-area').getBoundingClientRect().height);
  assert.ok(slot >= 200, `reserved slot ${slot}`);
  await settle(page, 0, 'ok');
  assert.deepEqual(await rects(page, ['#game', '#arena', '#hud']), before);
  await g.context.close();
});

test('interacting with Retry during a fight pauses (normal focus-leave rule) but never resets or advances it', async () => {
  const g = await openGame(env, { viewport: { width: 390, height: 844 }, provider: 'blocked' });
  const { page } = g;
  assert.ok(await until(async () => (await embedState(page)) === 'failed'));
  g.provider.mode = 'success';
  await startFight(page);
  await page.keyboard.down('k');
  await page.clock.runFor(1500);
  assert.deepEqual(await hp(page), [96, 100]);
  const timeBefore = await text(page, '#time-left');
  await page.evaluate(() => document.getElementById('btn-retry-embed').scrollIntoView());
  await page.click('#btn-retry-embed');
  await page.clock.runFor(200);
  assert.equal(await state(page), 'paused');
  assert.ok(await until(async () => (await embedState(page)) === 'loaded'), 'the click still performed its action');
  await page.clock.runFor(8000);
  assert.deepEqual(await hp(page), [96, 100]);
  assert.equal(await text(page, '#time-left'), timeBefore);
  assert.equal(await state(page), 'paused');
  await g.context.close();
});

test('keyboard: Retry and Open-on-X are reachable and activate with Space/Enter; combat keys outside play do nothing', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 568 }, provider: 'blocked' });
  const { page } = g;
  assert.ok(await until(async () => (await embedState(page)) === 'failed'));
  g.provider.mode = 'success';
  const seen = [];
  for (let i = 0; i < 30; i++) { await page.keyboard.press('Tab'); seen.push(await page.evaluate(() => document.activeElement?.id || '')); }
  assert.ok(seen.includes('btn-retry-embed') && seen.includes('link-open-x'), seen.join(','));
  await page.focus('#btn-retry-embed');
  for (const k of ['j', 'k', 'Shift']) await page.keyboard.press(k);
  assert.equal(await page.getAttribute('#app', 'data-punch-requests'), '0');
  await page.keyboard.press('Space');
  assert.equal(await page.getAttribute('#app', 'data-punch-requests'), '0');
  assert.ok(await until(async () => (await embedState(page)) === 'loaded'));
  await g.context.close();
});

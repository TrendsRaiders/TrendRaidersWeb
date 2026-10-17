// r4 source-post embed. The provider here is a MOCK served through request interception; these tests prove our
// integration/fallback behavior only. Real provider rendering is checked separately by scripts/real-embed-check.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, openGame, state, text, hp, startFight, until } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const TWEET = '2111278238253342868';
const SUMMARY = 'Source summary: FearedBuck reported a Jack Doherty knockout within the first 30 seconds at Brand Risk 16. Posted 17 October 2026, 02:08:52 UTC. This summary is not the embedded post.';
const embedState = (page) => page.getAttribute('#embed-area', 'data-embed-state');
const FAIL_MSG = 'Post unavailable or blocked. You can still open the source on X.';

/** Mock widgets.js. mode is read per request so a test can switch it before an explicit retry. */
async function mockProvider(context, initial) {
  const ctl = { mode: initial, scriptRequests: 0 };
  await context.route('https://platform.twitter.com/**', async (route) => {
    ctl.scriptRequests += 1;
    if (ctl.mode === 'blocked') return route.abort('blockedbyclient');
    const body = `window.__tw = { calls: [] };
      window.twttr = { ready: (cb) => cb(), widgets: { createTweet: (id, el, opts) => {
        window.__tw.calls.push({ id, opts });
        const mode = ${JSON.stringify(ctl.mode)};
        if (mode === 'undefined') return Promise.resolve(undefined);
        if (mode === 'reject') return Promise.reject(new Error('mock'));
        if (mode === 'never') return new Promise(() => {});
        if (mode === 'deferred') { // settled by the test, one call at a time, so retries can race
          window.__settle = window.__settle || [];
          return new Promise((res, rej) => { window.__settle[window.__tw.calls.length - 1] = (kind) => {
            if (kind === 'ok') { const f = document.createElement('iframe'); f.title = 'mock post ' + window.__tw.calls.length; f.width = '300'; f.height = '200'; el.appendChild(f); res(f); }
            else if (kind === 'undefined') res(undefined); else rej(new Error('mock late failure'));
          }; });
        }
        const f = document.createElement('iframe'); f.title = 'mock official post'; f.width = '900'; f.height = '240';
        el.appendChild(f); return Promise.resolve(f);
      } } };`;
    return route.fulfill({ contentType: 'text/javascript', body });
  });
  return ctl;
}
const calls = (page) => page.evaluate(() => window.__tw?.calls ?? []);

test('before Load: no provider request, script, iframe or preconnect; privacy text, dated summary and ordinary links present; game fully usable', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 640 } });
  const { page, context } = g;
  const external = [];
  context.on('request', (r) => { if (!r.url().startsWith(env.host.origin) && !r.url().startsWith('data:')) external.push(r.url()); });
  await page.reload();
  await page.clock.install();
  assert.equal(await text(page, '#source-post-heading'), 'Source post — FearedBuck');
  assert.equal(await text(page, '#source-post .privacy'), 'Loading this post connects to X, which may use cookies or other identifiers. You can read the source without loading the embed.');
  assert.equal(await text(page, '#embed-summary'), SUMMARY);
  assert.equal(await text(page, '#btn-load-embed'), 'Load source post from X');
  assert.equal(await page.getAttribute('#link-open-x', 'href'), `https://twitter.com/FearedBuck/status/${TWEET}`);
  assert.equal(await page.getAttribute('#news a', 'href'), `https://twitter.com/FearedBuck/status/${TWEET}`);
  assert.equal(await embedState(page), 'idle');
  const dom = await page.evaluate(() => ({
    scripts: [...document.scripts].map((s) => s.src).filter(Boolean),
    iframes: document.querySelectorAll('iframe').length,
    hints: document.querySelectorAll('link[rel=preconnect],link[rel=dns-prefetch],link[rel=preload],link[rel=prefetch]').length,
    twttr: typeof window.twttr,
  }));
  assert.deepEqual(dom.scripts.every((s) => s.startsWith(env.host.origin)), true);
  assert.deepEqual([dom.iframes, dom.hints, dom.twttr], [0, 0, 'undefined']);
  // full game round without ever loading the embed
  await startFight(page);
  await page.keyboard.down('k');
  await page.clock.runFor(1500);
  assert.deepEqual(await hp(page), [96, 100]);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.clock.runFor(200);
  assert.deepEqual(external, [], 'no request leaves the origin before Load');
  assert.deepEqual(g.problems, []);
  await context.close();
});

test('Load via keyboard (mock success): exact tweet id, conversation hidden, one script request, focus not stolen, no combat key leak', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 640 } });
  const { page, context } = g;
  const ctl = await mockProvider(context, 'success');
  await page.focus('#btn-load-embed');
  await page.keyboard.press('Space'); // Space activates the button and must not punch
  assert.equal(await page.getAttribute('#app', 'data-punch-requests'), '0');
  assert.ok(await until(async () => (await embedState(page)) === 'loaded'), `state ${await embedState(page)}`);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-load-embed', 'focus stays on the control');
  const [c] = await calls(page);
  assert.equal(c.id, TWEET);
  assert.equal(c.opts.conversation, 'none');
  assert.ok(c.opts.width >= 250 && c.opts.width <= 550);
  assert.equal((await calls(page)).length, 1);
  assert.equal(ctl.scriptRequests, 1);
  assert.equal(await text(page, '#embed-status'), 'Source post loaded from X.');
  assert.equal(await page.getAttribute('#btn-load-embed', 'aria-disabled'), 'true');
  assert.equal(await page.isVisible('#embed-summary'), false);
  assert.equal(await page.isVisible('#link-open-x'), true, 'ordinary link persists');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#embed-mount iframe').length), 1);
  assert.deepEqual(g.problems, []);
  await context.close();
});

for (const [name, mode] of [['post unavailable/deleted (createTweet resolves undefined)', 'undefined'], ['createTweet rejects', 'reject'], ['script blocked by client/CSP-like abort', 'blocked']]) {
  test(`fallback: ${name}; no automatic retry; explicit retry succeeds`, async () => {
    const g = await openGame(env, { viewport: { width: 320, height: 640 } });
    const { page, context } = g;
    const ctl = await mockProvider(context, mode);
    await page.click('#btn-load-embed');
    assert.ok(await until(async () => (await embedState(page)) === 'failed'), `state ${await embedState(page)}`);
    assert.equal(await text(page, '#embed-status'), FAIL_MSG);
    assert.equal(await text(page, '#btn-load-embed'), 'Try loading again');
    assert.equal(await page.getAttribute('#btn-load-embed', 'aria-disabled'), 'false');
    assert.equal(await text(page, '#embed-summary'), SUMMARY, 'dated fallback summary remains');
    assert.equal(await page.isVisible('#link-open-x'), true);
    const before = [ctl.scriptRequests, (await calls(page)).length];
    await page.clock.runFor(30000); // nothing polls or retries on its own
    assert.deepEqual([ctl.scriptRequests, (await calls(page)).length], before);
    assert.equal(await embedState(page), 'failed', 'an error is never marked as a loaded tweet');
    ctl.mode = 'success';
    if (mode !== 'blocked') await page.evaluate(() => { delete window.twttr; });
    await page.click('#btn-load-embed');
    assert.ok(await until(async () => (await embedState(page)) === 'loaded'), `retry state ${await embedState(page)}`);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#embed-mount iframe').length), 1);
    await context.close();
  });
}

test('10-second timeout: still loading at 9s, fallback at 10s with explicit Try loading again; retry works', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 640 } });
  const { page, context } = g;
  const ctl = await mockProvider(context, 'never');
  await page.click('#btn-load-embed');
  assert.ok(await until(async () => (await calls(page)).length === 1));
  await page.clock.runFor(9000);
  assert.equal(await embedState(page), 'loading');
  assert.equal(await text(page, '#embed-status'), 'Loading source post from X…');
  await page.clock.runFor(1100);
  assert.equal(await embedState(page), 'failed');
  assert.equal(await text(page, '#embed-status'), FAIL_MSG);
  assert.equal(await text(page, '#btn-load-embed'), 'Try loading again');
  ctl.mode = 'success';
  // widgets.js stays loaded after a timeout; flip the live mock to success, then retry
  await page.evaluate(() => { window.twttr.widgets.createTweet = (id, el) => { const f = document.createElement('iframe'); f.width = '300'; f.height = '200'; el.appendChild(f); return Promise.resolve(f); }; });
  await page.click('#btn-load-embed');
  assert.ok(await until(async () => (await embedState(page)) === 'loaded'));
  assert.equal(ctl.scriptRequests, 1, 'provider script is not fetched again');
  await context.close();
});

test('offline: Load fails to the fallback; source link and game stay usable', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 640 } });
  const { page, context } = g;
  await context.setOffline(true);
  await page.click('#btn-load-embed');
  assert.ok(await until(async () => (await embedState(page)) === 'failed'), `state ${await embedState(page)}`);
  assert.equal(await text(page, '#embed-status'), FAIL_MSG);
  await context.setOffline(false);
  await startFight(page);
  assert.equal(await state(page), 'playing');
  await context.close();
});

test('320px layout, fallback and loaded: no horizontal overflow, embed within card, controls not overlapped, no focus steal', async () => {
  for (const mode of ['blocked', 'success']) {
    const g = await openGame(env, { viewport: { width: 320, height: 640 } });
    const { page, context } = g;
    await mockProvider(context, mode);
    const measure = () => page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const card = r('#source-post'); const mount = r('#embed-mount'); const iframe = document.querySelector('#embed-mount iframe')?.getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, cardR: card.right, cardL: card.left, mountR: mount.right, iframeR: iframe?.right ?? 0, gameBottom: r('#game').bottom, newsTop: r('#news').top };
    });
    let m = await measure();
    assert.ok(m.sw <= m.iw && m.cardR <= m.iw && m.cardL >= 0, `fallback-state layout ${JSON.stringify(m)}`);
    await page.focus('#btn-load-embed');
    await page.keyboard.press('Enter');
    assert.ok(await until(async () => ['failed', 'loaded'].includes(await embedState(page))));
    assert.equal(await embedState(page), mode === 'success' ? 'loaded' : 'failed');
    m = await measure();
    assert.ok(m.sw <= m.iw, `no horizontal overflow (${m.sw} > ${m.iw})`);
    assert.ok(m.mountR <= m.cardR + 0.5 && (!m.iframeR || m.iframeR <= m.cardR + 0.5), `embed within card ${JSON.stringify(m)}`);
    assert.ok(m.gameBottom <= m.newsTop, 'play area is above the news/embed area and not overlapped');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-load-embed');
    // Only the intentionally blocked script may produce errors (and nothing else, e.g. no CSP violation).
    assert.deepEqual(g.problems.filter((p) => !(mode === 'blocked' && /widgets\.js|ERR_BLOCKED_BY_CLIENT/.test(p))), []);
    await context.close();
  }
});

test('interacting with Load during a fight pauses (normal focus-leave rule) but never resets or advances it', async () => {
  const g = await openGame(env, { viewport: { width: 390, height: 800 } });
  const { page, context } = g;
  await mockProvider(context, 'success');
  await startFight(page);
  await page.keyboard.down('k');
  await page.clock.runFor(1500);
  assert.deepEqual(await hp(page), [96, 100]);
  const timeBefore = await text(page, '#time-left');
  await page.evaluate(() => document.getElementById('news').scrollIntoView());
  await page.click('#btn-load-embed');
  await page.clock.runFor(200);
  assert.equal(await state(page), 'paused');
  assert.ok(await until(async () => (await embedState(page)) === 'loaded'), 'the click still performed its action');
  await page.clock.runFor(8000);
  assert.deepEqual(await hp(page), [96, 100]);
  assert.equal(await text(page, '#time-left'), timeBefore);
  assert.equal(await state(page), 'paused', 'load never resumes or restarts play');
  await context.close();
});

test('keyboard traversal reaches Load and Open-on-X links; Space/J/K/Enter outside play never fire combat', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 640 } });
  const { page, context } = g;
  const seen = [];
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    seen.push(await page.evaluate(() => document.activeElement?.id || ''));
  }
  assert.ok(seen.includes('btn-load-embed') && seen.includes('link-open-x'), seen.join(','));
  await page.focus('#link-open-x');
  for (const k of ['j', 'k', 'Shift']) await page.keyboard.press(k);
  assert.equal(await page.getAttribute('#app', 'data-punch-requests'), '0');
  await context.close();
});

// ---- retry races: a superseded attempt must not duplicate content or mark the new attempt as loaded ----
const iframes = (page) => page.evaluate(() => [...document.querySelectorAll('#embed-mount iframe')].map((f) => f.title));
const settle = (page, n, kind) => page.evaluate(([i, k]) => window.__settle[i](k), [n, kind]);
async function timeoutThenRetry(page) {
  await page.click('#btn-load-embed');
  assert.ok(await until(async () => (await calls(page)).length === 1));
  await page.clock.runFor(10100);
  assert.equal(await embedState(page), 'failed');
  await page.click('#btn-load-embed'); // explicit retry => call #2 while call #1 never settled
  assert.ok(await until(async () => (await calls(page)).length === 2));
  assert.equal(await embedState(page), 'loading');
}

test('race: attempt 1 resolves late after retry started -> ignored (no duplicate, new attempt still loading), then attempt 2 completes once', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 640 } });
  const { page, context } = g;
  await mockProvider(context, 'deferred');
  await timeoutThenRetry(page);
  await settle(page, 0, 'ok'); // superseded attempt shows up late
  assert.equal(await embedState(page), 'loading', 'old attempt cannot mark the new one successful');
  assert.deepEqual(await iframes(page), [], 'old content is not displayed');
  await settle(page, 1, 'ok');
  assert.equal(await embedState(page), 'loaded');
  assert.deepEqual(await iframes(page), ['mock post 2'], 'exactly the current attempt\'s post, no duplicate');
  await context.close();
});

test('race: attempt 2 completes first, attempt 1 late success or failure changes nothing', async () => {
  for (const late of ['ok', 'reject', 'undefined']) {
    const g = await openGame(env, { viewport: { width: 320, height: 640 } });
    const { page, context } = g;
    await mockProvider(context, 'deferred');
    await timeoutThenRetry(page);
    await settle(page, 1, 'ok');
    assert.equal(await embedState(page), 'loaded');
    await settle(page, 0, late);
    assert.equal(await embedState(page), 'loaded', `late ${late}`);
    assert.deepEqual(await iframes(page), ['mock post 2'], `late ${late}`);
    await context.close();
  }
});

test('race: a late failure from attempt 1 cannot fail attempt 2 while it is loading', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 640 } });
  const { page, context } = g;
  await mockProvider(context, 'deferred');
  await timeoutThenRetry(page);
  await settle(page, 0, 'reject');
  assert.equal(await embedState(page), 'loading');
  assert.equal(await text(page, '#embed-status'), 'Loading source post from X…');
  await settle(page, 1, 'undefined');
  assert.equal(await embedState(page), 'failed', 'the current attempt\'s own result still counts');
  await context.close();
});

test('same attempt: a late success after the 10 s fallback replaces it once, without stealing focus', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 640 } });
  const { page, context } = g;
  await mockProvider(context, 'deferred');
  await page.focus('#btn-load-embed');
  await page.keyboard.press('Enter');
  assert.ok(await until(async () => (await calls(page)).length === 1));
  await page.clock.runFor(10100);
  assert.equal(await embedState(page), 'failed');
  await settle(page, 0, 'ok');
  assert.equal(await embedState(page), 'loaded');
  assert.deepEqual(await iframes(page), ['mock post 1']);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-load-embed');
  await context.close();
});

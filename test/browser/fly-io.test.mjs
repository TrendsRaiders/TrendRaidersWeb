// Fly the Simulation: touch/pointer/mouse/keyboard-button steering, sharing, reduced motion, routes/history, network-blocked play
// and the one-attempt official embed. Synthetic touch (CDP) and a fake clock: automation, not real-device or human evidence.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, FLY, withGame, open, start, readSim, playFake, focusedId, rect, canvasHash, runTo } from './fly-helpers.mjs';
import { mockProvider } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const center = async (page, sel) => { const r = await rect(page, sel); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };
const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} !~ ${b}`);

/** A page with our own routing (no provider mock) on a fake clock. */
async function openRaw(env, { viewport = { width: 1280, height: 800 }, route = FLY, handler = null, touch = false } = {}) {
  const context = await env.browser.newContext({ viewport, hasTouch: touch });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  if (handler) await context.route((u) => !u.href.startsWith(env.host.origin), handler);
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000); // paused: page time only moves when the test says so (exact 8 s boundaries)
  await page.goto(env.host.origin + route, { waitUntil: 'domcontentloaded' });
  return { page, context, problems };
}

test('touch: separate Fly up / Fly down hold buttons with pointer capture; opposite fingers cancel; cancel/end never leave steering latched', async () => {
  await withGame(env, { viewport: { width: 390, height: 844 }, touch: true }, async ({ page, context }) => {
    await start(page);
    const up = await center(page, '#btn-up'); const down = await center(page, '#btn-down');
    const cdp = await context.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const y0 = (await readSim(page)).y;
    await touch('touchStart', [{ ...down, id: 1 }]);
    await page.clock.runFor(160);
    let s = await readSim(page);
    assert.equal(s.held, 'down'); assert.ok(s.y > y0);
    assert.equal(await page.getAttribute('#btn-down', 'data-held'), 'true');
    await touch('touchStart', [{ ...down, id: 1 }, { ...up, id: 2 }]); // second finger on the opposite button
    await page.clock.runFor(160);
    const a = await readSim(page);
    assert.equal(a.held, 'cancel');
    await page.clock.runFor(160);
    assert.equal((await readSim(page)).y, a.y, 'opposite fingers cancel');
    await touch('touchEnd', [{ ...down, id: 1 }]); // down finger lifts: up remains
    await page.clock.runFor(160);
    s = await readSim(page);
    assert.equal(s.held, 'up'); assert.ok(s.y < a.y);
    await touch('touchCancel', []); // system cancels everything
    const c = await readSim(page);
    assert.equal(c.held, 'none');
    await page.clock.runFor(200);
    assert.equal((await readSim(page)).y, c.y, 'no latched steering after cancel');
    // a finger that slides off the button and lifts elsewhere still releases (pointer capture / document backstop)
    await touch('touchStart', [{ ...up, id: 3 }]);
    await touch('touchMove', [{ x: 5, y: 5, id: 3 }]);
    await touch('touchEnd', []);
    await page.clock.runFor(200);
    const d = await readSim(page);
    await page.clock.runFor(200);
    assert.equal((await readSim(page)).y, d.y);
    assert.equal((await readSim(page)).held, 'none');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('btn-up')).touchAction), 'none', 'touch-action:none on steering');
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).touchAction), 'none', 'the page itself still scrolls');
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.getElementById('arena')).touchAction), 'none');
  });
});

test('utility taps never steer: a held finger + Pause tap pauses with inputs cleared; Restart/Pause are not steering', async () => {
  await withGame(env, { viewport: { width: 390, height: 844 }, touch: true }, async ({ page, context }) => {
    await start(page);
    const up = await center(page, '#btn-up');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...up, id: 1 }] });
    await page.clock.runFor(100);
    await page.tap('#btn-pause');
    const s = await readSim(page);
    assert.equal(s.state, 'paused'); assert.equal(s.held, 'none');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.clock.runFor(500);
    assert.equal((await readSim(page)).y, s.y);
    await page.tap('#btn-resume');
    await page.clock.runFor(200);
    const r = await readSim(page);
    assert.equal(r.state, 'running'); assert.equal(r.y, s.y, 'the Resume tap did not steer');
  });
});

test('mouse-held steering, capture on drag-out, and keyboard activation (Enter/Space hold) of the steering buttons', async () => {
  await withGame(env, { viewport: { width: 1280, height: 800 } }, async ({ page }) => {
    await start(page);
    const down = await center(page, '#btn-down');
    let a = await readSim(page);
    await page.mouse.move(down.x, down.y); await page.mouse.down();
    await page.clock.runFor(160);
    let b = await readSim(page);
    assert.equal(b.held, 'down'); assert.ok(b.y > a.y);
    await page.mouse.move(down.x + 400, down.y - 300); // dragged away while held: capture keeps it
    await page.clock.runFor(100);
    assert.equal((await readSim(page)).held, 'down');
    await page.mouse.up(); // released elsewhere
    a = await readSim(page);
    await page.clock.runFor(200);
    b = await readSim(page);
    assert.equal(b.held, 'none'); assert.equal(b.y, a.y);
    // keyboard: focus Fly up, hold Enter then Space
    await page.focus('#btn-up');
    for (const key of ['Enter', 'Space']) {
      a = await readSim(page);
      await page.keyboard.down(key);
      await page.clock.runFor(160);
      b = await readSim(page);
      assert.equal(b.held, 'up', key); assert.ok(b.y < a.y, key);
      await page.keyboard.up(key);
      a = await readSim(page);
      await page.clock.runFor(160);
      assert.equal((await readSim(page)).y, a.y, `${key} release stops`);
    }
    assert.equal((await readSim(page)).state, 'running');
  });
});

test('Copy result: exact plain text without a candidate URL; clipboard success, denied and missing all behave honestly', async () => {
  const text = 'I escaped the simulation. The banana was a desktop icon. — Fly the Simulation, 2026-10-18';
  const modes = {
    ok: () => { /** @type {any} */ (window).__copied = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { /** @type {any} */ (window).__copied.push(t); } }, configurable: true }); },
    denied: () => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new DOMException('denied', 'NotAllowedError'); } }, configurable: true }); },
    missing: () => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); },
  };
  for (const [mode, init] of Object.entries(modes)) {
    await withGame(env, { init }, async ({ page }) => {
      await start(page);
      await playFake(page);
      assert.equal(await page.getAttribute('#game', 'data-outcome'), 'won');
      await page.click('#btn-copy');
      if (mode === 'ok') {
        assert.deepEqual(await page.evaluate(() => /** @type {any} */ (window).__copied), [text]);
        assert.equal(await page.textContent('#copy-note'), 'Copied to clipboard.');
        assert.equal(await page.isVisible('#copy-text'), false);
      } else {
        assert.equal(await page.isVisible('#copy-text'), true, 'selectable fallback text');
        assert.equal(await page.inputValue('#copy-text'), text);
        assert.match(await page.textContent('#copy-note'), /^Copy failed\./, 'no false success');
        assert.equal(await page.evaluate(() => { const t = /** @type {HTMLTextAreaElement} */ (document.getElementById('copy-text')); return t.value.slice(t.selectionStart, t.selectionEnd); }), text, 'text is selected');
        assert.equal(await page.getAttribute('#copy-text', 'readonly'), '');
      }
      assert.doesNotMatch(text, /https?:/, 'preview copy carries no candidate/live URL');
    });
  }
});

test('reduced motion: scenery drift is off (static background) while the course keeps moving; normal motion drifts', async () => {
  const frames = async (reducedMotion) => {
    let hashes = [];
    await withGame(env, { reducedMotion }, async ({ page }) => {
      await start(page);
      await page.clock.runFor(150); hashes.push(await canvasHash(page));
      await page.clock.runFor(400); hashes.push(await canvasHash(page));
      assert.ok((await readSim(page)).tUs > 500_000, 'course still advances');
    });
    return hashes;
  };
  const [r1, r2] = await frames('reduce');
  assert.equal(r1, r2, 'reduced motion: nothing but the (not yet visible) walls move before seam 1; background and fly frame are static');
  const [n1, n2] = await frames('no-preference');
  assert.notEqual(n1, n2, 'normal motion: scenery drifts');
  // seams (the essential motion) still move under reduced motion
  await withGame(env, { reducedMotion: 'reduce' }, async ({ page }) => {
    await start(page);
    await runTo(page, 2_000_000);
    const h1 = await canvasHash(page);
    await page.clock.runFor(200);
    assert.notEqual(await canvasHash(page), h1, 'seam 1 keeps travelling');
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  });
});

test('routes: preview root and direct route are the candidate, refresh/back/forward give a fresh focused Intro, boxing preview unaffected, honest 404', async () => {
  const g = await open(env, { route: '/' });
  const { page } = g;
  try {
    assert.equal(await page.title(), 'Fly the Simulation — Preview (not released)');
    assert.equal((await readSim(page)).state, 'intro');
    await start(page);
    await page.reload();
    let s = await readSim(page);
    assert.deepEqual([s.state, s.tUs, s.y], ['intro', 0, 0.5], 'refresh = fresh Intro');
    // navigate to the other preview via the date chooser, then Back/Forward
    await page.goto(env.host.origin + FLY);
    await page.click('details.others > summary');
    await Promise.all([page.waitForURL(`${env.host.origin}/games/2026-10-17/`), page.click('details.others a')]);
    assert.equal(await page.getAttribute('#app', 'data-state'), 'intro', 'boxing preview still loads and starts at its Intro');
    assert.match(await page.textContent('#game-title'), /30-Second KO/);
    await page.goBack();
    await page.waitForURL(env.host.origin + FLY);
    s = await readSim(page);
    assert.equal(s.state, 'intro');
    assert.equal(await page.getAttribute('nav a[aria-current="page"]', 'href'), FLY);
    await page.goForward();
    await page.waitForURL(`${env.host.origin}/games/2026-10-17/`);
    // honest 404s and trailing-slash redirect
    const r404 = await page.goto(`${env.host.origin}/games/2026-10-19/`);
    assert.equal(r404?.status(), 404);
    assert.match(await page.textContent('main'), /Page not found/);
    assert.equal(await page.locator('#game').count(), 0);
    const redirect = await fetch(`${env.host.origin}/games/2026-10-18`, { redirect: 'manual' });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('location'), '/games/2026-10-18/');
  } finally { await g.context.close(); }
});

test('header: the other preview is never a Previous/Next neighbor; both are disabled with accessible names; selected date is current', async () => {
  await withGame(env, { viewport: { width: 390, height: 844 } }, async ({ page }) => {
    const nav = await page.evaluate(() => [...document.querySelectorAll('.site-nav button[data-gn]')].map((b) => ({ dis: /** @type {HTMLButtonElement} */ (b).disabled, name: b.textContent.replace(/\s+/g, ' ').trim() })));
    assert.equal(nav.length, 2);
    assert.deepEqual(nav.map((n) => n.dis), [true, true]);
    assert.match(nav[0].name, /Previous game.*No earlier released game/);
    assert.match(nav[1].name, /Next game.*No later released game/);
    assert.equal(await page.locator('.site-nav a[data-gn]').count(), 0);
    assert.match(await page.textContent('nav a[aria-current="page"]'), /^18 Oct 2026/);
    assert.match(await page.textContent('.preview-badge'), /Preview — not released/);
    assert.equal(await page.locator('.site-header a[href="/games/2026-10-17/"]').getAttribute('href'), '/games/2026-10-17/');
    assert.equal(await page.isVisible('.site-header >> text=About'), false, 'About is a footer link only');
  });
});

test('network fully blocked (X and everything external): Intro, play, loss/win, sources, About and Copy all work; embed shows the stable fallback after 8 s', async () => {
  const g = await openRaw(env, { handler: (r) => r.abort('blockedbyclient'), viewport: { width: 1280, height: 800 } });
  const { page } = g;
  try {
    await page.waitForFunction(() => document.getElementById('embed-area').dataset.embedState === 'failed');
    assert.equal(await page.textContent('#embed-status'), 'Embed unavailable — read the source on X');
    assert.equal(await page.isVisible('#link-open-x'), true);
    assert.equal(await page.getAttribute('#link-open-x', 'href'), 'https://twitter.com/odysseyml/status/2111589148146749616');
    assert.equal(await page.isVisible('#embed-summary'), true, 'recap/summary stay visible');
    assert.equal(await page.locator('#news a[href="https://twitter.com/olivercameron/status/2111589310571147464"]').count(), 1);
    await start(page);
    const s = await playFake(page);
    assert.equal(s.state, 'won');
    await page.click('#btn-again');
    await start(page);
    assert.equal((await readSim(page)).state, 'running');
    await page.click('#link-about');
    assert.equal(await page.isVisible('#about'), true);
    assert.deepEqual(g.problems, []);
  } finally { await g.context.close(); }
});

test('embed: one automatic attempt at mount, 8 s timeout (boxing keeps 10 s), no retry control or loop, late success replaces the fallback quietly', async () => {
  // a script request that never answers: loading until exactly 8 s, then the stable fallback
  let requests = 0;
  const g = await openRaw(env, { handler: () => { requests += 1; /* never fulfilled */ } });
  const { page } = g;
  try {
    assert.equal(await page.getAttribute('#embed-area', 'data-embed-state'), 'loading', 'one attempt starts without any interaction');
    assert.equal(await page.textContent('#embed-status'), 'Loading the official post from X…');
    assert.match(await page.textContent('.privacy'), /^Official X post — loading may contact X and its media services and share network\/device identifiers\.$/);
    await page.clock.runFor(7900);
    assert.equal(await page.getAttribute('#embed-area', 'data-embed-state'), 'loading', 'not before 8 s');
    await page.clock.runFor(150);
    assert.equal(await page.getAttribute('#embed-area', 'data-embed-state'), 'failed');
    assert.equal(await page.textContent('#embed-status'), 'Embed unavailable — read the source on X');
    await page.clock.runFor(120_000);
    assert.equal(requests, 1, 'no automatic retry loop');
    assert.equal(await page.locator('#btn-retry-embed, #btn-load-embed').count(), 0, 'no Load/Retry control');
  } finally { await g.context.close(); }
  // mocked provider: success, deferred late success, rejection
  await withGame(env, { provider: 'success' }, async ({ page, provider }) => {
    await page.waitForFunction(() => document.getElementById('embed-area').dataset.embedState === 'loaded');
    assert.equal(provider.scriptRequests, 1);
    assert.equal(await page.evaluate(() => document.querySelector('#news #embed-mount iframe') !== null && document.querySelector('#arena iframe, #panel-intro iframe') === null), true, 'only in News');
    assert.equal(await page.evaluate(() => /** @type {any} */ (window).__tw.calls[0].id), '2111589148146749616');
    assert.equal(await page.isVisible('#link-open-x'), true, 'ordinary link stays visible');
  });
  await withGame(env, { provider: 'deferred' }, async ({ page }) => {
    await page.waitForFunction(() => /** @type {any} */ (window).__tw?.calls.length === 1);
    await page.clock.runFor(8100);
    assert.equal(await page.getAttribute('#embed-area', 'data-embed-state'), 'failed');
    await page.focus('#btn-start');
    await page.evaluate(() => /** @type {any} */ (window).__settle[0]('ok'));
    await page.waitForFunction(() => document.getElementById('embed-area').dataset.embedState === 'loaded');
    assert.equal(await focusedId(page), 'btn-start', 'a late success never steals focus');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#embed-mount iframe').length), 1);
  });
  await withGame(env, { provider: 'reject' }, async ({ page }) => {
    await page.waitForFunction(() => document.getElementById('embed-area').dataset.embedState === 'failed');
    assert.equal(await page.textContent('#embed-status'), 'Embed unavailable — read the source on X');
  });
});

test('provider completion/failure while Fly up is held does not change inputs, round, focus or geometry', async () => {
  await withGame(env, { provider: 'deferred', viewport: { width: 390, height: 844 }, touch: true }, async ({ page, context }) => {
    await page.waitForFunction(() => /** @type {any} */ (window).__tw?.calls.length === 1);
    await start(page);
    const up = await center(page, '#btn-up');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...up, id: 1 }] });
    await page.clock.runFor(200);
    const before = { sim: await readSim(page), arena: await rect(page, '#arena'), up: await rect(page, '#btn-up'), focus: await focusedId(page) };
    await page.evaluate(() => /** @type {any} */ (window).__settle[0]('ok')); // the post renders mid-play
    await page.waitForFunction(() => document.getElementById('embed-area').dataset.embedState === 'loaded');
    await page.clock.runFor(100);
    const after = { sim: await readSim(page), arena: await rect(page, '#arena'), up: await rect(page, '#btn-up'), focus: await focusedId(page) };
    assert.equal(after.sim.state, 'running'); assert.equal(after.sim.held, 'up'); assert.ok(after.sim.tUs > before.sim.tUs);
    assert.deepEqual(after.arena, before.arena); assert.deepEqual(after.up, before.up);
    assert.equal(after.focus, before.focus);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  });
});

test('nonessential: the page loads no external resources besides the one provider script (no fonts, images, analytics)', async () => {
  const seen = [];
  const context = await env.browser.newContext();
  const page = await context.newPage();
  page.on('request', (r) => { if (!r.url().startsWith(env.host.origin) && !r.url().startsWith('data:')) seen.push(new URL(r.url()).host); });
  await mockProvider(context, 'success');
  await page.goto(env.host.origin + FLY);
  await page.waitForTimeout(500);
  assert.deepEqual([...new Set(seen)], ['platform.twitter.com']);
  await context.close();
});

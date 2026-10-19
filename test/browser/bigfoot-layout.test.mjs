// Bigfoot: Take Two: rendered geometry at 320x568, 390x844, 844x390 and desktop; control sizes, no overflow, target/feet pixels
// actually painted, Start reachable, rotation/resize preservation, reduced motion, nav/News and embed fallback behaviour.
// Touch is synthetic emulation, not a physical device; physical-device checks are separate human work.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, withGame, open, read, start, runToWalk, winFourOfFive, focusedId, canvasHash, pixel, rect, SHOT_MS, ROLL_MS } from './bigfoot-helpers.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const VIEWPORTS = { 'phone 320x568': [320, 568, true], 'phone 390x844': [390, 844, true], 'landscape 844x390': [844, 390, true], 'desktop 1280x800': [1280, 800, false] };

test('every viewport: no horizontal overflow, controls >= 44px, POSE reachable, Start visible in the first screen, controls never over the arena', async () => {
  for (const [name, [width, height, touch]] of Object.entries(VIEWPORTS)) {
    await withGame(env, { viewport: { width, height }, touch }, async ({ page }) => {
      const d = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(d.sw <= d.iw, `${name}: no horizontal overflow`);
      const arena = await rect(page, '#arena');
      const startBtn = await rect(page, '#btn-start');
      assert.ok(startBtn.y >= 0 && startBtn.bottom <= height, `${name}: Start fully inside the first screen`);
      assert.ok(startBtn.h >= 44, `${name}: Start >= 44px`);
      assert.ok(startBtn.y >= arena.y && startBtn.bottom <= arena.bottom, `${name}: Start inside the arena`);
      for (const id of ['#btn-pose', '#btn-pause', '#btn-restart', '#btn-sound']) {
        const r = await rect(page, id);
        assert.ok(r.h >= 44 && r.w >= 44, `${name} ${id} is ${r.w}x${r.h}`);
        const overlap = !(r.right <= arena.x || r.x >= arena.right || r.bottom <= arena.y || r.y >= arena.bottom);
        assert.equal(overlap, false, `${name} ${id} does not overlap the arena tap surface`);
      }
      const pose = await rect(page, '#btn-pose');
      assert.ok(pose.h >= 56, `${name}: POSE >= 56px tall (${pose.h})`);
      assert.ok(pose.bottom <= height, `${name}: POSE inside the viewport (${pose.bottom} <= ${height})`);
      const util = await rect(page, '#btn-pause');
      if (name.startsWith('phone')) assert.ok(pose.w >= width - 32, `${name}: POSE spans the width (${pose.w})`);
      if (name.startsWith('phone')) assert.ok(arena.h / height >= 0.45 && arena.h / height <= 0.7, `${name}: stage ${Math.round((arena.h / height) * 100)}% of the viewport`);
      if (name.startsWith('desktop')) {
        assert.ok(Math.abs(pose.w - 240) <= 2 && pose.h >= 56 && pose.h <= 60, `desktop POSE ${pose.w}x${pose.h} ~ 240x56`);
        assert.ok(arena.w <= 1100 + 1);
        assert.ok(arena.h / height >= 0.55 && arena.h / height <= 0.65, `desktop stage ${Math.round((arena.h / height) * 100)}% of the viewport`);
        assert.ok(util.y > pose.bottom, 'desktop utilities sit in a separate row');
      }
      if (name.startsWith('landscape')) {
        assert.ok(arena.w / width >= 0.68 && arena.w / width <= 0.78, `landscape stage ~75% (${arena.w / width})`);
        assert.ok(arena.h >= 200, `landscape stage height ${arena.h}`);
        assert.ok(pose.x >= arena.right, 'POSE is in the right rail');
        assert.ok(util.x >= arena.right, 'utilities are in the right rail');
        const hdr = await rect(page, '.site-header');
        assert.ok(hdr.h <= 44, `landscape header ${hdr.h}px`);
      }
      // footer reachable by scrolling
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      assert.equal(await page.isVisible('#link-about'), true);
      const f = await rect(page, '.footer-nav');
      assert.ok(f.bottom <= (await page.evaluate(() => window.innerHeight)) + 1, `${name}: footer reachable`);
    });
  }
});

test('rendered stage: the tape strip, center tape and a high-contrast footpoint marker are really painted (pixel sampling), at every viewport', async () => {
  for (const [name, [width, height, touch]] of Object.entries(VIEWPORTS)) {
    await withGame(env, { viewport: { width, height }, touch }, async ({ page }) => {
      await page.click('#btn-start'); // not required: the target must also be visible before walking starts (rolling)
      await page.clock.runFor(100);
      const s0 = await read(page);
      const geo = await page.evaluate(() => { const a = document.getElementById('arena'); const c = document.getElementById('scene'); return { band: Number(a.dataset.bandTop), bandH: Number(a.dataset.bandH), floor: Number(a.dataset.floorY), w: c.width, h: c.height }; });
      const [l, c, r] = s0.target;
      const my = geo.band + geo.bandH / 2;
      // strip width in CSS px (4 px minimum, and the table windows give more at 320 px)
      assert.ok((r - l) * geo.w >= 4, `${name}: strip ${(r - l) * geo.w}px`);
      // centre tape: near-black at the centre x, tape yellow inside the strip near its left edge
      const centre = await pixel(page, c * geo.w, my);
      assert.ok(centre[0] < 60 && centre[1] < 60 && centre[2] < 70, `${name}: centre tape is dark ${centre}`);
      const inside = await pixel(page, l * geo.w + (c - l) * geo.w * 0.5, my);
      assert.ok(inside[0] > 200 && inside[1] > 170 && inside[2] < 90, `${name}: strip is tape yellow ${inside}`);
      // brackets (white posts) just outside the strip edges
      const post = await pixel(page, l * geo.w - 1.5, my);
      assert.ok(post[0] > 240 && post[1] > 240 && post[2] > 240, `${name}: left bracket post is white ${post}`);
      // footpoint marker: magenta centre below the feet line at foot x (walking onset: x = 0.08)
      const mx = s0.footX * geo.w;
      let found = false;
      for (let dy = 0; dy < geo.band - geo.floor; dy++) { const p = await pixel(page, mx, geo.floor + dy); if (p[0] > 240 && p[1] < 70 && p[2] > 120 && p[2] < 170) found = true; }
      assert.ok(found, `${name}: magenta footpoint marker painted under the feet line`);
      // the marker sits above the band, so it can never hide a strip edge
      assert.ok(geo.band > geo.floor + 4);
    });
  }
});

test('the footpoint marker tracks x(t) = 0.08 + 0.84 t/3.2 and reaches the center tape at c', async () => {
  await withGame(env, { viewport: { width: 390, height: 844 }, touch: true }, async ({ page }) => {
    await start(page);
    const w = await page.evaluate(() => document.getElementById('scene').width);
    void w;
    for (const ms of [800, 1800]) {
      const s = await runToWalk(page, ms);
      assert.ok(Math.abs(s.footX - (0.08 + 0.84 * (s.phase / 3_200_000))) < 1e-4, `footX ${s.footX} at phase ${s.phase}`);
      assert.ok(Math.abs(s.phase - ms * 1000) <= 17_000, 'the sampled frame is within one frame of the requested time');
      if (ms === 1800) assert.ok(Math.abs(s.footX - s.target[1]) < 0.006, 'the marker is on the center tape at c (within one frame)');
    }
  });
});

test('resize preserves progress and counters; a rotation pauses without scoring; Resume continues in the new composition', async () => {
  await withGame(env, { viewport: { width: 390, height: 844 }, touch: true }, async ({ page }) => {
    await start(page);
    await runToWalk(page, 700);
    const before = await read(page);
    await page.setViewportSize({ width: 420, height: 800 }); // same orientation, new size: progress is preserved, play continues
    await page.clock.runFor(48);
    let s = await read(page);
    assert.equal(s.state, 'walking', 'a plain resize does not restart, score or pause');
    assert.ok(s.phase > before.phase); assert.equal(s.misses, 0);
    assert.deepEqual(s.target, before.target, 'normalized target geometry is unchanged');
    const mid = await read(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction(() => document.getElementById('game').dataset.state === 'paused', null, { timeout: 5000 });
    s = await read(page);
    assert.equal(s.state, 'paused', 'rotation pauses');
    assert.ok(s.phase - mid.phase < 100_000, 'the pause landed within a few frames of the rotation');
    assert.equal(s.misses, 0); assert.equal(s.usable, 0);
    assert.deepEqual(s.target, before.target);
    await page.clock.runFor(3000);
    assert.equal((await read(page)).phase, s.phase, 'paused time never advances the shot');
    await page.click('#btn-resume');
    await page.clock.runFor(32);
    s = await read(page);
    assert.equal(s.state, 'walking');
    assert.ok(s.phase > mid.phase);
  });
});

test('intro and result panels stay inside the arena and clear of the controls at short landscape (568x320 included)', async () => {
  for (const [w, h] of [[844, 390], [568, 320]]) {
    await withGame(env, { viewport: { width: w, height: h }, touch: true }, async ({ page }) => {
      const a = await rect(page, '#arena');
      const i = await rect(page, '#panel-intro');
      assert.ok(i.x >= a.x - 1 && i.right <= a.right + 1 && i.y >= a.y - 1 && i.bottom <= a.bottom + 1, `${w}x${h}: intro inside the arena`);
      const sb = await rect(page, '#btn-start');
      assert.ok(sb.bottom <= h && sb.h >= 44, `${w}x${h}: Start above the fold`);
      assert.ok(a.h >= 150, `${w}x${h}: stage height ${a.h}`);
      const d = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(d.sw <= d.iw);
    });
  }
});

test('reduced motion: the win shows the full static reveal immediately, with no Skip; the crossing stays linear', async () => {
  await withGame(env, { reducedMotion: 'reduce' }, async ({ page }) => {
    await winFourOfFive(page);
    assert.equal((await read(page)).state, 'won');
    assert.equal(await page.isVisible('#btn-skip'), false);
    const h1 = await canvasHash(page);
    await page.clock.runFor(2500);
    assert.equal(await canvasHash(page), h1, 'static: nothing moves');
    await page.click('#btn-replay');
    assert.equal(await page.isVisible('#btn-skip'), false);
    assert.equal(await canvasHash(page), h1);
  });
  await withGame(env, { reducedMotion: 'reduce' }, async ({ page }) => {
    await start(page);
    const a = await runToWalk(page, 500);
    const b = await runToWalk(page, 1500);
    assert.ok(Math.abs((b.footX - a.footX) - (0.84 * (b.phase - a.phase)) / 3_200_000) < 1e-4, 'same speed under reduced motion');
    assert.ok(b.phase - a.phase >= 950_000, 'one second of walking elapsed');
  });
});

test('the reveal animation runs ~2 s in normal motion and ends on the static final frame; Skip jumps to it', async () => {
  await withGame(env, {}, async ({ page }) => {
    await winFourOfFive(page);
    const h0 = await canvasHash(page);
    await page.clock.runFor(800);
    const h1 = await canvasHash(page);
    assert.notEqual(h1, h0, 'the reveal moves');
    await page.click('#btn-skip');
    const hs = await canvasHash(page);
    await page.clock.runFor(2500);
    assert.equal(await canvasHash(page), hs, 'Skip lands on the final frame');
  });
});

test('nav and News: usable during the intro, never start play, preview badge and honest disabled neighbors', async () => {
  await withGame(env, {}, async ({ page }) => {
    assert.equal(await page.title(), 'Bigfoot: Take Two — Preview (not released)');
    assert.equal(await page.locator('.preview-badge').count(), 1);
    for (const k of ['prev', 'next']) {
      const e = await page.evaluate((kind) => { const el = document.querySelector(`.site-nav [data-gn="${kind}"]`); return { tag: el.tagName, disabled: el.disabled, href: el.getAttribute('href') }; }, k);
      assert.deepEqual(e, { tag: 'BUTTON', disabled: true, href: null }, `${k}: disabled, no link (no verified released neighbor)`);
    }
    assert.match(await page.locator('.site-nav .date-link[aria-current="page"]').innerText(), /19 Oct 2026/);
    await page.focus('#link-news');
    await page.keyboard.press('Enter');
    assert.equal((await read(page)).state, 'intro', 'News link never starts play');
    await page.keyboard.press('Space');
    assert.equal((await read(page)).t, 0);
    assert.equal(await page.locator('#news').isVisible(), true);
    const doc = await page.locator('#news').innerText();
    assert.match(doc, /On October 18, 2026, Variety posted a review of Marq Evans’s documentary Capturing Bigfoot\. Film accounts also circulated claims of rehearsal footage; those claims are not an independently established verdict on the historical film\. Our cardboard forest and homemade monster are fictional: your job is simply to get a usable take\./);
    assert.match(doc, /Official X embed loads automatically\. X may receive your IP address and browser\/device identifiers and request media\. The game works without it\./);
    const links = await page.locator('#news .sources a').evaluateAll((as) => as.map((a) => [a.href, a.rel]));
    assert.deepEqual(links.map((l) => l[0]), ['https://twitter.com/Variety/status/2111896526234505466', 'https://twitter.com/TheCinesthetic/status/2111938893193023829']);
    for (const l of links) assert.match(l[1], /noopener/);
    assert.match(doc, /October 18, 2026/);
  });
});

test('embed: success mounts the official widget once for the Variety post only; no retry, no gameplay impact', async () => {
  await withGame(env, { provider: 'success' }, async ({ page, provider }) => {
    await page.clock.runFor(100);
    assert.equal(await page.getAttribute('#embed-area', 'data-embed-state'), 'loaded');
    const calls = await page.evaluate(() => window.__tw.calls);
    assert.deepEqual(calls.map((c) => c.id), ['2111896526234505466']);
    assert.equal(provider.scriptRequests, 1);
    await start(page);
    await page.clock.runFor(2000);
    assert.equal(provider.scriptRequests, 1, 'no retry loop');
  });
});

test('embed: blocked, rejected or never-settling provider shows the exact fallback text after at most 6 s; gameplay unaffected; no late layout shift', async () => {
  for (const mode of ['blocked', 'reject', 'never']) {
    await withGame(env, { provider: mode, freeze: true }, async ({ page, provider }) => {
      const y0 = await page.evaluate(() => document.getElementById('about').getBoundingClientRect().top + window.scrollY);
      if (mode === 'never') {
        await page.clock.runFor(3000);
        assert.equal(await page.getAttribute('#embed-area', 'data-embed-state'), 'loading', 'still waiting well before 6 s');
        await page.clock.runFor(4000);
      } else await page.clock.runFor(300);
      assert.equal(await page.getAttribute('#embed-area', 'data-embed-state'), 'failed', mode);
      assert.equal((await page.textContent('#embed-status')).trim(), 'X embed unavailable — read the source on X');
      assert.equal(await page.getAttribute('#link-open-x', 'href'), 'https://twitter.com/Variety/status/2111896526234505466');
      const y1 = await page.evaluate(() => document.getElementById('about').getBoundingClientRect().top + window.scrollY);
      assert.equal(y1, y0, `${mode}: the fallback does not move the page below`);
      assert.equal(provider.scriptRequests, 1, `${mode}: one automatic attempt only`);
      await start(page);
      await runToWalk(page, 1800);
      await page.keyboard.press('Space');
      assert.equal((await read(page)).result, 'usable', 'gameplay works without the embed');
    });
  }
});

test('embed: a late success after the 6 s timeout never replaces the fallback or shifts the page', async () => {
  await withGame(env, { provider: 'deferred', freeze: true }, async ({ page }) => {
    await page.clock.runFor(100);
    assert.equal(await page.evaluate(() => window.__tw.calls.length), 1);
    const y0 = await page.evaluate(() => document.getElementById('about').getBoundingClientRect().top + window.scrollY);
    await page.clock.runFor(7000);
    assert.equal(await page.getAttribute('#embed-area', 'data-embed-state'), 'failed');
    await page.evaluate(() => window.__settle[0]('ok')); // the widget answers late
    await page.clock.runFor(200);
    assert.equal(await page.getAttribute('#embed-area', 'data-embed-state'), 'failed');
    assert.equal((await page.textContent('#embed-status')).trim(), 'X embed unavailable — read the source on X');
    assert.equal(await page.locator('#embed-mount iframe').count(), 0, 'the late widget rendered into a detached node');
    assert.equal(await page.evaluate(() => document.getElementById('about').getBoundingClientRect().top + window.scrollY), y0);
  });
});

test('routes: direct load/refresh give a fresh focused intro; navigating away stops the departing game; unknown dates are honest 404s', async () => {
  const g = await open(env, {});
  const { page } = g;
  try {
    await start(page);
    await runToWalk(page, 500);
    await page.reload();
    const s = await read(page);
    assert.deepEqual([s.state, s.t, s.usable], ['intro', 0, 0]);
    assert.equal(await focusedId(page), 'btn-start');
    await page.click('details.others > summary');
    await Promise.all([page.waitForURL(/\/games\/2026-10-1[78]\/$/), page.click('details.others a[href="/games/2026-10-18/"]')]);
    await page.goBack();
    await page.waitForURL(/\/games\/2026-10-19\/$/);
    assert.equal((await read(page)).state, 'intro', 'back gives a fresh intro');
    const r = await page.goto(`${env.host.origin}/games/2026-10-20/`);
    assert.equal(r?.status(), 404);
  } finally { await g.context.close(); }
});

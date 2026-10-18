import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, openGame, state, text, hp, startFight, playToWin, inside, GAME } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const clean = (g) => assert.deepEqual(g.problems, []);

test('intro: copy, preview framing, nav semantics, news readable before play without About', async () => {
  const g = await openGame(env);
  const { page } = g;
  assert.equal(await state(page), 'intro');
  assert.match(await text(page, '#panel-intro'), /Block the hit\. Punch on COUNTER\. KO Jack before time runs out\./);
  assert.match(await text(page, '#panel-intro'), /Unofficial creator-boxing parody\. Original fictionalized characters; not affiliated with or endorsed by any person or event\./);
  assert.match(await text(page, '.preview-banner'), /Preview — not released/);
  assert.equal(await page.getAttribute('nav[aria-label="Game editions"] a[aria-current="page"]', 'aria-current'), 'page');
  assert.match(await text(page, 'nav a[aria-current="page"]'), /17 Oct 2026 — Preview \(not released\)/);
  assert.match(await text(page, '.edition-date'), /17 October 2026 \(UTC\)/);
  assert.equal(await page.isVisible('#news'), true);
  assert.match(await text(page, '#news h2'), /^News behind the game$/);
  assert.equal(await page.getAttribute('#news a', 'href'), 'https://twitter.com/FearedBuck/status/2111278238253342868');
  assert.equal(await page.isVisible('#dlg-about'), false);
  clean(g);
  await g.context.close();
});

// Layout geometry at the spec sizes lives in r5-layout.test.mjs.

test('countdown: inputs ignored, no time or damage; then 100/100 and 30s', async () => {
  const g = await openGame(env);
  const { page } = g;
  await page.click('#btn-play');
  assert.equal(await state(page), 'countdown');
  assert.equal(await text(page, '#countdown'), '3');
  await page.keyboard.down('k');
  await page.keyboard.press('Space');
  await page.keyboard.up('k');
  await page.clock.runFor(2000);
  assert.equal(await state(page), 'countdown');
  assert.equal(await text(page, '#countdown'), '1');
  assert.deepEqual(await hp(page), [100, 100]);
  assert.equal(await text(page, '#time-left'), '30');
  await page.clock.runFor(1100);
  assert.equal(await state(page), 'playing');
  assert.equal(await inside(page, '#arena'), true, 'focus moves to the play region after countdown');
  assert.equal(await text(page, '#time-left'), '30');
  assert.deepEqual(await hp(page), [100, 100]);
  await g.context.close();
});

test('keyboard: guard K, block at 1,400, counter with Space = 20 damage; second punch in window = 3', async () => {
  const g = await openGame(env);
  const { page } = g;
  await startFight(page);
  await page.keyboard.down('k');
  assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'true');
  await page.clock.runFor(1500);
  assert.deepEqual(await hp(page), [96, 100]);
  assert.match(await text(page, '#cue'), /BLOCK/);
  await page.keyboard.press('Space');
  await page.clock.runFor(150);
  assert.deepEqual(await hp(page), [96, 80]);
  assert.match(await text(page, '#cue'), /COUNTER/);
  await page.clock.runFor(450); // action over (500ms); window still open until 2050
  await page.keyboard.press('j');
  await page.clock.runFor(150);
  assert.deepEqual(await hp(page), [96, 77]);
  clean(g);
  await g.context.close();
});

test('no guard: unguarded strike costs 22 HP and stunned punches are ignored', async () => {
  const g = await openGame(env);
  const { page } = g;
  await startFight(page);
  await page.clock.runFor(1500);
  assert.deepEqual(await hp(page), [78, 100]);
  await page.keyboard.press('Space');
  await page.clock.runFor(200);
  assert.deepEqual(await hp(page), [78, 100], 'stunned punch ignored');
  assert.equal(await page.getAttribute('#art', 'data-player-pose'), 'stun');
  clean(g);
  await g.context.close();
});

test('loss, timeout draw and Retry reset', async () => {
  const g = await openGame(env);
  const { page } = g;
  await startFight(page);
  await page.clock.runFor(9500);
  assert.equal(await state(page), 'result');
  assert.equal(await text(page, '#result-headline'), 'KO — caught swinging. Block, then counter.');
  assert.match(await text(page, '#result-time'), /Knocked out at 9\.0\d?s/);
  assert.equal(await inside(page, '#panel-result'), true, 'focus moves to the result');
  await page.click('#btn-retry');
  assert.equal(await state(page), 'countdown');
  assert.deepEqual(await hp(page), [100, 100]);
  await page.clock.runFor(3100);
  await page.keyboard.down('k');
  await page.clock.runFor(1500);
  assert.deepEqual(await hp(page), [96, 100], 'first strike again at 1,400 after retry');
  await page.clock.runFor(32000);
  assert.equal(await state(page), 'result');
  assert.equal(await text(page, '#result-headline'), '30 seconds. No KO — rematch?');
  assert.equal(await text(page, '#result-time'), '30 seconds — no KO');
  assert.match(await text(page, '#result-health'), /You: \d+ HP · Jack: 100 HP/);
  clean(g);
  await g.context.close();
});

test('win: five counters, stopwatch/stool payoff with actual KO time, Retry/Share usable at once', async () => {
  const g = await openGame(env);
  const { page } = g;
  await startFight(page);
  await playToWin(page);
  assert.equal(await state(page), 'result');
  assert.equal(await text(page, '#result-headline'), 'KO! You beat the 30-second headline.');
  const time = (await text(page, '#result-time')).match(/KO time: (\d+\.\d\d)s/);
  assert.ok(time, 'KO time shown');
  assert.ok(Number(time[1]) >= 9.1 && Number(time[1]) < 10, `KO time plausible: ${time[1]}`);
  assert.equal(await page.isVisible('#payoff'), true);
  assert.match(await text(page, '.stamp-line'), new RegExp(`BEAT THE BUZZER\\s+${time[1]}s`));
  assert.equal(await page.isEnabled('#btn-retry'), true);
  assert.equal(await page.isEnabled('#btn-share'), true);
  assert.equal(await page.evaluate(() => document.getElementById('payoff').classList.contains('anim')), true);
  await page.click('#btn-skip-anim');
  assert.equal(await page.evaluate(() => document.getElementById('payoff').classList.contains('anim')), false);
  assert.match(await text(page, '#result-health'), /You: 80 HP · Jack: 0 HP/);
  assert.match(await text(page, '#result-best'), /Best KO time on this device: /);
  clean(g);
  await g.context.close();
});

test('reduced motion: static payoff, same text, essential cues retained', async () => {
  const g = await openGame(env, { reducedMotion: 'reduce' });
  const { page } = g;
  await startFight(page);
  await page.keyboard.down('k');
  await page.clock.runFor(1000);
  assert.equal(await page.isVisible('#windup-wrap'), true, 'wind-up progress cue stays');
  await page.keyboard.up('k');
  await page.keyboard.down('k');
  await page.keyboard.up('k');
  await page.reload();
  await page.clock.install();
  await startFight(page);
  await playToWin(page);
  assert.equal(await page.evaluate(() => document.getElementById('payoff').classList.contains('anim')), false);
  assert.equal(await page.isVisible('#btn-skip-anim'), false);
  assert.match(await text(page, '.stamp-line'), /BEAT THE BUZZER/);
  assert.equal(await page.isVisible('#payoff canvas'), true);
  clean(g);
  await g.context.close();
});

test('pause: Escape freezes everything; wall time passes; Resume has a 3-2-1 lead-in that ignores combat', async () => {
  const g = await openGame(env);
  const { page } = g;
  await startFight(page);
  await page.keyboard.down('k');
  await page.clock.runFor(1000); // mid wind-up
  await page.keyboard.press('Escape');
  assert.equal(await state(page), 'paused');
  assert.equal(await page.isVisible('#dlg-pause'), true);
  assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'false', 'inputs cleared');
  assert.equal(await inside(page, '#dlg-pause'), true);
  const t0 = await text(page, '#time-left');
  await page.clock.runFor(10000);
  assert.deepEqual(await hp(page), [100, 100]);
  assert.equal(await text(page, '#time-left'), t0);
  await page.keyboard.up('k');
  await page.click('#btn-resume');
  assert.equal(await state(page), 'countdown');
  await page.keyboard.press('Space');
  await page.clock.runFor(2000);
  assert.deepEqual(await hp(page), [100, 100]);
  await page.clock.runFor(1100);
  assert.equal(await state(page), 'playing');
  // guard was cleared by pause: no guard now -> strike (at 1,400) is unguarded
  await page.clock.runFor(600);
  assert.deepEqual(await hp(page), [78, 100]);
  clean(g);
  await g.context.close();
});

test('blur and hidden page auto-pause and require explicit Resume', async () => {
  const g = await openGame(env);
  const { page } = g;
  await startFight(page);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await state(page), 'paused');
  await page.clock.runFor(5000);
  assert.deepEqual(await hp(page), [100, 100]);
  await page.click('#btn-restart');
  assert.equal(await state(page), 'countdown');
  await page.clock.runFor(3100);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await state(page), 'paused');
  await page.click('#btn-exit');
  assert.equal(await state(page), 'intro');
  clean(g);
  await g.context.close();
});

test('About during held Guard: freezes, clears input, contains focus, inert background, Escape returns to Pause', async () => {
  const g = await openGame(env);
  const { page } = g;
  await startFight(page);
  await page.keyboard.down('k');
  await page.clock.runFor(500);
  await page.click('#btn-about');
  assert.equal(await page.isVisible('#dlg-about'), true);
  assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => /** @type {any} */ (document.getElementById('page')).inert), true);
  assert.equal(await inside(page, '#dlg-about'), true);
  const requests = await page.getAttribute('#app', 'data-punch-requests');
  for (const key of ['j', 'Space', 'k', 'Shift', 'Enter']) await page.keyboard.press(key);
  assert.equal(await page.getAttribute('#app', 'data-punch-requests'), requests, 'no punch from modal');
  assert.equal(await page.isVisible('#dlg-about'), true, 'Space/Enter on heading does not close it');
  await page.clock.runFor(5000);
  assert.deepEqual(await hp(page), [100, 100]);
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); assert.equal(await inside(page, '#dlg-about'), true, `Tab ${i}`); }
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Shift+Tab'); assert.equal(await inside(page, '#dlg-about'), true); }
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('#dlg-about'), false);
  assert.equal(await state(page), 'paused', 'closing About never resumes');
  assert.equal(await page.isVisible('#dlg-pause'), true);
  assert.equal(await inside(page, '#dlg-pause'), true, 'focus returns to the Pause dialog');
  await page.keyboard.up('k');
  await page.clock.runFor(3000);
  assert.deepEqual(await hp(page), [100, 100]);
  await page.click('#btn-resume');
  await page.clock.runFor(3100);
  assert.equal(await state(page), 'playing');
  assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'false', 'no leaked key');
  assert.equal(await inside(page, '#play-region'), true);
  clean(g);
  await g.context.close();
});

test('About from Intro and Result: focus restored to opener, state unchanged, Escape and Close both work', async () => {
  const g = await openGame(env);
  const { page } = g;
  await page.focus('#panel-intro [data-open-about]');
  await page.keyboard.press('Space'); // Space still activates focused UI
  assert.equal(await page.isVisible('#dlg-about'), true);
  await page.keyboard.press('Escape');
  assert.equal(await state(page), 'intro');
  assert.equal(await page.evaluate(() => document.activeElement.closest('#panel-intro') !== null && document.activeElement.hasAttribute('data-open-about')), true);
  await page.click('#btn-play');
  await page.clock.runFor(3100);
  await page.clock.runFor(10000); // loss
  assert.equal(await state(page), 'result');
  await page.focus('#panel-result [data-open-about]');
  await page.keyboard.press('Enter');
  assert.equal(await page.isVisible('#dlg-about'), true);
  await page.click('#btn-about-close');
  assert.equal(await state(page), 'result');
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-open-about')), true);
  clean(g);
  await g.context.close();
});

test('combat keys never fire from navigation/UI focus; focused Punch button yields exactly one action', async () => {
  const g = await openGame(env);
  const { page } = g;
  // Not playing: J/K/Space on UI do nothing but ordinary activation.
  await page.focus('nav a');
  for (const k of ['j', 'k', 'Shift', 'Space']) await page.keyboard.press(k);
  assert.equal(await page.getAttribute('#app', 'data-punch-requests'), '0');
  await startFight(page);
  // Native handler + shortcut handler must not double fire on a focused Punch button.
  await page.focus('#btn-punch');
  await page.keyboard.press('Space');
  assert.equal(await page.getAttribute('#app', 'data-punch-requests'), '1');
  await page.clock.runFor(700);
  await page.keyboard.press('Enter');
  assert.equal(await page.getAttribute('#app', 'data-punch-requests'), '2');
  await page.clock.runFor(700);
  // Held / repeated Space is a single attempt.
  await page.focus('#arena');
  await page.keyboard.down('Space');
  await page.keyboard.down('Space');
  await page.keyboard.down('Space');
  await page.keyboard.up('Space');
  assert.equal(await page.getAttribute('#app', 'data-punch-requests'), '3');
  assert.equal(await state(page), 'playing');
  clean(g);
  await g.context.close();
});

test('focus leaving the play region pauses; Pause button works; nav link click still navigates', async () => {
  const g = await openGame(env);
  const { page } = g;
  await startFight(page);
  await page.keyboard.down('k');
  await page.focus('#btn-punch');
  await page.keyboard.press('Tab'); // leaves the region
  assert.equal(await state(page), 'paused');
  await page.clock.runFor(100);
  assert.equal(await page.isVisible('#dlg-pause'), true);
  assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'false');
  await page.click('#btn-exit');

  await startFight(page);
  await page.click('#btn-pause');
  await page.clock.runFor(100);
  assert.equal(await state(page), 'paused');
  assert.equal(await page.isVisible('#dlg-pause'), true);
  await page.click('#btn-exit');

  await startFight(page);
  await page.click('nav a.brand'); // initiating link still performs its action
  await page.waitForURL(`${env.host.origin}/`);
  assert.equal(await state(page), 'intro', 'arrival at Intro, not a resumed fight');
  clean(g);
  await g.context.close();
});

test('history: back/forward between routes shows the right content and Intro, never a resumed fight', async () => {
  const g = await openGame(env);
  const { page } = g;
  await startFight(page);
  await page.click('nav a.brand');
  await page.waitForURL(`${env.host.origin}/`);
  await page.goBack();
  await page.waitForURL(`${env.host.origin}${GAME}`);
  assert.equal(await state(page), 'intro');
  assert.deepEqual(await hp(page), [100, 100]);
  await page.goForward();
  await page.waitForURL(`${env.host.origin}/`);
  assert.match(await text(page, 'nav a[aria-current="page"]'), /17 Oct 2026 — Preview/);
  await page.reload();
  assert.equal(await state(page), 'intro');
  clean(g);
  await g.context.close();
});

test('unknown date: honest 404 with link to available editions, never aliased to the game', async () => {
  const g = await openGame(env, { route: '/games/2026-10-18/' });
  const { page } = g;
  assert.match(await text(page, 'main'), /Page not found/);
  assert.equal(await page.locator('#app').count(), 0);
  assert.equal(await page.getAttribute('main a[href="/games/2026-10-17/"]', 'href'), '/games/2026-10-17/');
  assert.equal(await page.locator('nav [aria-current="page"]').count(), 0);
  await g.context.close();
});

test('320px keyboard traversal: every stop visible, in viewport, no trap', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 640 } });
  const { page } = g;
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // The provider's iframe is third-party content: it must be reachable without a trap, its focus ring is the provider's.
      return { id: el.id || el.textContent.trim().slice(0, 20), left: r.left, right: r.right, visible: r.width > 0 && cs.visibility !== 'hidden', outline: cs.outlineStyle !== 'none' || el.tagName === 'IFRAME' };
    });
    if (!info) continue;
    seen.add(info.id);
    assert.ok(info.visible && info.left >= 0 && info.right <= 320, `${info.id} inside viewport`);
    assert.ok(info.outline, `${info.id} has visible focus`);
  }
  for (const needed of ['Skip to content', 'Trend Raiders', 'btn-about', 'btn-sound', 'btn-play', 'FearedBuck reporting']) {
    assert.ok([...seen].some((s) => s.startsWith(needed) || s === needed), `reached ${needed}; saw ${[...seen]}`);
  }
  await g.context.close();
});

test('multi-touch: Guard held with one finger and Punch with another; cancel releases guard', async () => {
  const g = await openGame(env, { viewport: { width: 390, height: 800 }, touch: true });
  const { page, context } = g;
  await startFight(page);
  const c = (sel) => page.locator(sel).boundingBox().then((b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }));
  const guard = await c('#btn-guard');
  const punch = await c('#btn-punch');
  const cdp = await context.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  await touch('touchStart', [{ ...guard, id: 1 }]);
  assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'true');
  await page.clock.runFor(1500);
  assert.deepEqual(await hp(page), [96, 100]);
  await touch('touchStart', [{ ...guard, id: 1 }, { ...punch, id: 2 }]);
  await touch('touchEnd', [{ ...punch, id: 2 }]);
  await page.clock.runFor(200);
  assert.deepEqual(await hp(page), [96, 80], 'counter from second finger');
  assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'true', 'guard finger still down');
  await touch('touchCancel', []);
  assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'false', 'cancellation releases guard');
  clean(g);
  await context.close();
});

test('sound off by default; storage denied and a missing clipboard do not prevent play', async () => {
  const g = await openGame(env, {
    init: () => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    },
  });
  const { page } = g;
  assert.equal(await page.getAttribute('#btn-sound', 'aria-pressed'), 'false');
  assert.equal(await text(page, '#btn-sound'), 'Sound: off');
  await startFight(page);
  await playToWin(page);
  assert.equal(await state(page), 'result');
  assert.equal(await page.isHidden('#result-best'), true);
  await page.click('#btn-share');
  assert.equal(await page.isVisible('#dlg-share'), true, 'selectable fallback appears');
  assert.equal(await inside(page, '#dlg-share'), true);
  const shared = await page.inputValue('#share-text');
  assert.match(shared, /^I scored a KO in \d+\.\d\ds in 30-Second KO\. Can you beat my time\?$/);
  assert.equal(await page.getAttribute('#share-text', 'readonly'), '');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-share');
  clean(g);
  await g.context.close();
});

test('share before release: link-free copy even though Web Share exists; never auto-sends; denied clipboard -> fallback', async () => {
  const g = await openGame(env, {
    init: () => {
      window.__shareCalls = 0;
      window.__copied = [];
      navigator.share = async () => { window.__shareCalls += 1; };
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t); } }, configurable: true });
    },
  });
  const { page } = g;
  assert.equal(await page.evaluate(() => window.__copied.length + window.__shareCalls), 0, 'nothing sent before the explicit action');
  await startFight(page);
  await page.clock.runFor(9500); // loss
  assert.equal(await text(page, '#btn-share'), 'Copy result');
  assert.match(await text(page, '#share-note'), /Link sharing is off/);
  await page.click('#btn-share');
  assert.deepEqual(await page.evaluate(() => [window.__shareCalls, window.__copied]), [0, ['Can you land a KO in 30 seconds? Try 30-Second KO.']]);
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new DOMException('no', 'NotAllowedError'); } }, configurable: true }); });
  await page.click('#btn-share');
  assert.equal(await page.isVisible('#dlg-share'), true);
  assert.equal(await page.inputValue('#share-text'), 'Can you land a KO in 30 seconds? Try 30-Second KO.');
  assert.equal(await page.evaluate(() => /netlify|127\.0\.0\.1|localhost/.test(document.getElementById('share-text').value)), false);
  clean(g);
  await g.context.close();
});

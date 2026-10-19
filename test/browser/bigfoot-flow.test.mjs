// Bigfoot: Take Two: intro/start, exact boundaries through the real page, input dedupe, pause/blur/stall, results, reveal,
// Retry/Restart. Real Chromium on a frozen Playwright fake clock; the X provider is mocked (hermetic). Touch is synthetic
// emulation, not a physical device.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, withGame, open, read, start, runToWalk, playShot, winFourOfFive, loseByTimeouts, focusedId, canvasHash, fakeNow, beginSchedule, ROLL_MS, SHOT_MS } from './bigfoot-helpers.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

test('first entry: Start is focused, the intro holds only goal/controls/Start, nothing moves, POSE is disabled', async () => {
  await withGame(env, {}, async ({ page }) => {
    let s = await read(page);
    assert.deepEqual([s.state, s.engine, s.shot, s.usable, s.t], ['intro', 'intro', 1, 0, 0]);
    assert.equal(await focusedId(page), 'btn-start');
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'focusing Start did not scroll the page');
    const intro = await page.locator('#panel-intro').innerText();
    assert.equal(intro.replace(/\s+/g, ' ').trim(), 'Get 4 of 5 usable shots. The monster walks. Tap POSE when its feet reach the tape. Space / Enter or the POSE button. Start');
    assert.equal(await page.locator('#panel-intro').getAttribute('role'), null, 'a plain section, not a dialog');
    assert.equal(await page.locator('#panel-intro [role=dialog], dialog, [aria-modal]').count(), 0);
    assert.equal(await page.isDisabled('#btn-pose'), true);
    assert.equal(await page.isDisabled('#btn-pause'), true);
    await page.clock.runFor(3000);
    s = await read(page);
    assert.equal(s.t, 0, 'the clock does not run under the intro');
    assert.equal(await page.evaluate(() => document.getElementById('page').inert === true || document.body.inert === true), false, 'no page inertness');
    assert.doesNotMatch(await page.locator('#game').innerText(), /News behind|Variety|trees are on hourly/);
  });
});

test('Start by click, Space and Enter each begin once, never pose shot 1, and move focus to POSE', async () => {
  for (const how of ['click', 'Space', 'Enter']) {
    await withGame(env, {}, async ({ page }) => {
      if (how === 'click') await page.click('#btn-start'); else await page.keyboard.press(how);
      await page.clock.runFor(16);
      let s = await read(page);
      assert.equal(s.engine, 'rolling', how);
      assert.equal(await focusedId(page), 'btn-pose', how);
      assert.deepEqual([s.usable, s.misses], [0, 0], how);
      assert.equal(s.cue, 'ROLLING');
      await page.clock.runFor(ROLL_MS + 1800 - 16);
      s = await read(page);
      assert.equal(s.engine, 'walking', `${how}: the opening activation was consumed, nothing posed`);
      assert.equal(s.usable + s.misses, 0, how);
    });
  }
});

test('an Enter held through Start (key still down, auto-repeating) never becomes a POSE', async () => {
  await withGame(env, {}, async ({ page }) => {
    beginSchedule(page, await fakeNow(page));
    await page.keyboard.down('Enter'); // activates Start on keydown
    await page.keyboard.down('Enter'); // auto-repeat, now landing on the POSE button
    await page.keyboard.down('Enter');
    await runToWalk(page, SHOT_MS[0].c);
    let s = await read(page);
    assert.equal(s.engine, 'walking');
    assert.equal(s.usable + s.misses, 0, 'held/repeating Enter cannot pose');
    await page.keyboard.up('Enter');
    await page.clock.runFor(2000);
    s = await read(page);
    assert.equal(s.result, 'missed', 'with no fresh activation the shot times out');
  });
});

test('rolling lead-in: input is ignored, not queued; a key pressed in rolling cannot pose in walking', async () => {
  await withGame(env, {}, async ({ page }) => {
    await start(page);
    await page.clock.runFor(300);
    assert.equal((await read(page)).engine, 'rolling');
    await page.keyboard.press('Space'); // ignored
    await page.keyboard.down('Space'); // held across the lead-in
    await page.clock.runFor(ROLL_MS - 300 - 16 + 20);
    assert.equal((await read(page)).engine, 'walking');
    await page.clock.runFor(SHOT_MS[0].c);
    const s = await read(page);
    assert.equal(s.usable + s.misses, 0, 'a held key from rolling is not a walking activation');
    await page.keyboard.up('Space');
  });
});

test('exact boundaries through the real page: c-w, c, c+w succeed; just outside misses (shot 1)', async () => {
  const { c, w } = SHOT_MS[0];
  for (const [ms, ok] of [[c - w, true], [c, true], [c + w, true], [c - w - 1, false], [c + w + 1, false]]) {
    await withGame(env, {}, async ({ page }) => {
      await start(page);
      await runToWalk(page, ms);
      await page.keyboard.press('Space');
      const s = await read(page);
      assert.equal(s.engine, 'shot_result', `walking t=${ms}`);
      assert.equal(s.result === 'usable', ok, `walking t=${ms} -> ${s.result}`);
      assert.deepEqual([s.usable, s.misses], ok ? [1, 0] : [0, 1]);
    });
  }
});

test('the timeout only fires for t > c+w, labels are Too early / Too late / Missed the mark, result window is 900 ms', async () => {
  await withGame(env, {}, async ({ page }) => {
    await start(page);
    await runToWalk(page, 100);
    await page.keyboard.press('Space');
    let s = await read(page);
    assert.equal(s.cue, '✗ Too early'); assert.equal(s.result, 'early');
    await page.clock.runFor(860);
    assert.equal((await read(page)).engine, 'shot_result', 'still in the 900 ms window');
    await page.clock.runFor(60);
    s = await read(page);
    assert.deepEqual([s.engine, s.shot, s.misses], ['rolling', 2, 1]);
    // shot 2: no input at all
    await page.clock.runFor(ROLL_MS + SHOT_MS[1].c + SHOT_MS[1].w - 16); // just before c+w
    assert.equal((await read(page)).engine, 'walking');
    await page.clock.runFor(60);
    s = await read(page);
    assert.equal(s.result, 'missed'); assert.equal(s.cue, '✗ Missed the mark');
  });
});

test('one activation path per device action: a held mouse press on POSE scores once and its late click never scores shot 2', async () => {
  await withGame(env, {}, async ({ page }) => {
    await start(page);
    await runToWalk(page, SHOT_MS[0].c);
    const b = await page.locator('#btn-pose').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    let s = await read(page);
    assert.equal(s.result, 'usable'); assert.equal(s.usable, 1);
    await page.clock.runFor(900 + ROLL_MS + 300); // shot 2 is walking while the button is still held
    s = await read(page);
    assert.equal(s.engine, 'walking'); assert.equal(s.shot, 2);
    await page.mouse.up(); // fires the synthesized click
    s = await read(page);
    assert.equal(s.engine, 'walking', 'the click that follows the pointerdown never scores a second time');
    assert.equal(s.usable, 1); assert.equal(s.misses, 0);
  });
});

test('POSE by keyboard on the button: keydown scores, repeats and the synthesized click do not; Space and Enter both work', async () => {
  for (const key of ['Space', 'Enter']) {
    await withGame(env, {}, async ({ page }) => {
      await start(page);
      assert.equal(await focusedId(page), 'btn-pose');
      await runToWalk(page, SHOT_MS[0].c);
      await page.keyboard.down(key);
      await page.keyboard.down(key); // repeat
      await page.keyboard.down(key); // repeat
      let s = await read(page);
      assert.deepEqual([s.result, s.usable, s.misses], ['usable', 1, 0], key);
      await page.keyboard.up(key);
      await page.clock.runFor(900 + ROLL_MS + 400);
      s = await read(page);
      assert.deepEqual([s.engine, s.usable, s.misses], ['walking', 1, 0], `${key}: no click/repeat scored shot 2`);
    });
  }
});

test('tapping the arena background poses (primary pointer only); panel buttons and non-primary pointers do not', async () => {
  await withGame(env, { touch: true, viewport: { width: 390, height: 844 } }, async ({ page }) => {
    await start(page);
    await runToWalk(page, SHOT_MS[0].c);
    // a second, non-primary finger is ignored
    await page.evaluate(() => document.getElementById('arena').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: false, pointerType: 'touch', pointerId: 7, button: 0 })));
    assert.equal((await read(page)).engine, 'walking');
    const box = await page.locator('#arena').boundingBox();
    await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.2);
    const s = await read(page);
    assert.deepEqual([s.engine, s.result, s.usable], ['shot_result', 'usable', 1]);
  });
});

test('Pause button freezes every clock; Resume cannot pose and continues from the same time; counters survive', async () => {
  await withGame(env, {}, async ({ page }) => {
    await start(page);
    await playShot(page, SHOT_MS[0].c);
    await runToWalk(page, 500);
    const before = await read(page);
    await page.click('#btn-pause');
    let s = await read(page);
    assert.equal(s.state, 'paused'); assert.equal(await focusedId(page), 'btn-resume');
    assert.equal(await page.isDisabled('#btn-pose'), true, 'no duplicate live game input behind the panel');
    const h1 = await canvasHash(page);
    await page.clock.runFor(5000);
    const after = await read(page);
    assert.deepEqual([after.t, after.phase, after.usable, after.shot], [before.t, before.phase, before.usable, before.shot]);
    assert.equal(await canvasHash(page), h1);
    await page.keyboard.press('Space'); // activates focused Resume: consumed, never a POSE
    s = await read(page);
    assert.equal(s.state, 'walking'); assert.equal(s.usable, 1); assert.equal(s.misses, 0);
    assert.equal(await focusedId(page), 'btn-pose');
    await page.clock.runFor(100);
    s = await read(page);
    assert.ok(s.phase >= before.phase + 90_000 && s.phase <= before.phase + 130_000, `resumed from the same instant (${before.phase} -> ${s.phase})`);
    assert.equal(s.misses, 0);
  });
});

test('Escape toggles Pause only while focus is in the game; elsewhere it is left alone', async () => {
  await withGame(env, {}, async ({ page }) => {
    await start(page);
    await runToWalk(page, 200);
    await page.keyboard.press('Escape');
    assert.equal((await read(page)).state, 'paused');
    await page.keyboard.press('Escape');
    assert.equal((await read(page)).state, 'walking');
    await page.focus('#link-about');
    await page.keyboard.press('Escape');
    assert.equal((await read(page)).state, 'walking', 'Escape on the footer link does not pause');
  });
});

test('window blur and a hidden page auto-pause without consuming a shot; returning never resumes', async () => {
  await withGame(env, {}, async ({ page }) => {
    await start(page);
    await runToWalk(page, 1000);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    let s = await read(page);
    assert.equal(s.state, 'paused'); assert.equal(s.pausedBy, 'blur');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.clock.runFor(4000);
    s = await read(page);
    assert.equal(s.state, 'paused', 'focus return does not resume');
    assert.deepEqual([s.usable, s.misses, s.engine], [0, 0, 'walking']);
    await page.click('#btn-resume');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    s = await read(page);
    assert.equal(s.state, 'paused'); assert.equal(s.pausedBy, 'hidden');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal((await read(page)).state, 'paused');
  });
});

test('a foreground stall above 250 ms auto-pauses at the last simulation time instead of failing the shot', async () => {
  await withGame(env, {}, async ({ page }) => {
    await start(page);
    await runToWalk(page, 1000);
    const before = await read(page);
    await page.clock.fastForward(900); // one huge gap before the next frame
    const s = await read(page);
    assert.equal(s.state, 'paused'); assert.equal(s.pausedBy, 'stall');
    assert.equal(s.phase, before.phase, 'simulation time was not advanced across the stall');
    assert.equal(s.misses, 0);
    await page.click('#btn-resume');
    await page.clock.runFor(50);
    assert.equal((await read(page)).misses, 0);
  });
});

test('win 4/5: states, cue text, contact sheet, caption, reveal; Replay reveal never changes the result; Retry gives a clean intro', async () => {
  await withGame(env, {}, async ({ page }) => {
    const kinds = await winFourOfFive(page);
    assert.deepEqual(kinds, ['usable', 'early', 'usable', 'usable', 'usable']);
    const s = await read(page);
    assert.deepEqual([s.state, s.outcome, s.usable, s.misses, s.shot], ['won', 'won', 4, 1, 5]);
    assert.equal(await page.textContent('#result-copy'), 'Usable take! A legend is born. It needs a sandwich.');
    const items = await page.locator('#contact li').evaluateAll((els) => els.map((e) => e.dataset.kind));
    assert.deepEqual(items, ['usable', 'early', 'usable', 'usable', 'usable']);
    assert.equal(await page.isVisible('#btn-replay'), true); assert.equal(await page.isVisible('#btn-share'), true);
    assert.equal(await page.isVisible('#btn-skip'), true, 'the 2 s reveal is optional (Skip)');
    await page.clock.runFor(2100);
    assert.equal(await page.isVisible('#btn-skip'), false);
    const finalHash = await canvasHash(page);
    await page.click('#btn-replay');
    assert.equal(await page.isVisible('#btn-skip'), true);
    await page.clock.runFor(2100);
    assert.equal(await canvasHash(page), finalHash, 'the replay lands on the same static final frame');
    const after = await read(page);
    assert.deepEqual([after.state, after.usable, after.misses, after.shot], ['won', 4, 1, 5]);
    assert.match(await page.getAttribute('#scene', 'aria-label'), /fan.*boom mic.*sandwich.*FOREST — FLAT PACK/);
    await page.click('#btn-retry');
    const r = await read(page);
    assert.deepEqual([r.state, r.shot, r.usable, r.misses, r.t], ['intro', 1, 0, 0, 0]);
    assert.equal(await focusedId(page), 'btn-start');
  });
});

test('4/4 wins right after shot 4 and never rolls a fifth', async () => {
  await withGame(env, {}, async ({ page }) => {
    await start(page);
    for (const ms of [1800, 2250, 1550, 2050]) await playShot(page, ms);
    const s = await read(page);
    assert.deepEqual([s.state, s.usable, s.misses, s.shot], ['won', 4, 0, 4]);
    assert.equal(await page.locator('#contact li[data-kind="unused"]').count(), 1);
  });
});

test('loss after the second miss: text, Retry, no sixth shot; Retry returns to an untouched intro with Start focused', async () => {
  await withGame(env, {}, async ({ page }) => {
    await loseByTimeouts(page);
    const s = await read(page);
    assert.deepEqual([s.state, s.outcome, s.misses, s.usable, s.shot], ['lost', 'lost', 2, 0, 2]);
    assert.equal(await page.textContent('#result-copy'), 'Back to rehearsal. The trees are on hourly rates.');
    assert.equal(await page.isVisible('#btn-share'), false);
    assert.equal(await page.isVisible('#btn-replay'), false);
    await page.clock.runFor(10_000);
    assert.equal((await read(page)).shot, 2);
    await page.click('#btn-retry');
    const r = await read(page);
    assert.deepEqual([r.state, r.shot, r.usable, r.misses, r.t], ['intro', 1, 0, 0, 0]);
    assert.equal(await focusedId(page), 'btn-start');
    await page.clock.runFor(2000);
    assert.equal((await read(page)).t, 0);
  });
});

test('Restart (utility row and paused panel) discards the attempt and shows the intro; it never hits the arena', async () => {
  await withGame(env, {}, async ({ page }) => {
    await start(page);
    await playShot(page, SHOT_MS[0].c);
    await runToWalk(page, 300);
    await page.click('#btn-restart');
    let s = await read(page);
    assert.deepEqual([s.state, s.shot, s.usable, s.misses], ['intro', 1, 0, 0]);
    assert.equal(await focusedId(page), 'btn-start');
    await start(page);
    await page.click('#btn-pause');
    await page.click('#btn-restart-paused');
    s = await read(page);
    assert.deepEqual([s.state, s.usable], ['intro', 0]);
  });
});

test('status live region announces each shot outcome once, with the usable count', async () => {
  await withGame(env, {}, async ({ page }) => {
    await page.evaluate(() => {
      window.__live = [];
      new MutationObserver(() => window.__live.push(document.getElementById('live').textContent.trim())).observe(document.getElementById('live'), { childList: true, characterData: true, subtree: true });
    });
    await start(page);
    await playShot(page, SHOT_MS[0].c);
    await page.clock.runFor(3000);
    const live = await page.evaluate(() => window.__live);
    const shots = live.filter((m) => /^Shot \d: /.test(m));
    assert.equal(shots.filter((m) => m.startsWith('Shot 1:')).length, 1, JSON.stringify(live));
    assert.equal(shots[0], 'Shot 1: Usable. Usable 1 of 4.');
    assert.equal(await page.getAttribute('#live', 'role'), 'status');
  });
});

// Fly the Simulation: Intro/Start/Pause/Resume/Restart/Retry flow, input gating, event boundaries, outcomes.
// Fake-clock automation in real Chromium. It proves our logic and DOM contract; it is not human or device play evidence.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, withGame, start, readSim, createBot, playFake, focusedId, rect, canvasHash, runTo } from './fly-helpers.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} !~ ${b}`);
/** Δy must equal 0.52 × Δt (in arena heights) for a held direction without clamping. */
const speedOk = (a, b, sign) => near(b.y - a.y, sign * 0.52 * ((b.tUs - a.tUs) / 1e6), 2e-6, 'speed');

test('first entry: frozen Intro inside the arena, goal + keys/touch + Start only, nonmodal, nothing moves behind it', async () => {
  await withGame(env, {}, async ({ page }) => {
    const s = await readSim(page);
    assert.deepEqual([s.state, s.tUs, s.y, s.cleared], ['intro', 0, 0.5, 0]);
    const intro = (await page.textContent('#panel-intro')).replace(/\s+/g, ' ').trim();
    assert.equal(intro, 'Fly the Simulation Reach the banana. Follow the dashed gap when the world rebuilds. ↑/↓ or W/S: steer Hold ▲ / ▼ to steer Start');
    assert.equal(await page.evaluate(() => document.getElementById('arena').contains(document.getElementById('panel-intro'))), true);
    assert.equal(await page.getAttribute('#panel-intro', 'aria-modal'), null);
    assert.equal(await page.evaluate(() => document.getElementById('page').inert || document.querySelector('[aria-modal]') !== null), false, 'no inert page, no modal');
    assert.equal(await page.evaluate(() => document.querySelectorAll('[autofocus]').length), 0);
    // browser focus is predictable: nothing was focused/scrolled by the page
    assert.equal(await focusedId(page), 'BODY');
    assert.equal(await page.evaluate(() => scrollY), 0);
    // Start is the first enabled arena action in normal tab order (steering/utilities are disabled)
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('#game button, #game [tabindex]')].filter((e) => !e.disabled && e.tabIndex >= 0 && e.getClientRects().length)[0].id), 'btn-start');
    for (const id of ['btn-up', 'btn-down', 'btn-pause', 'btn-restart']) assert.equal(await page.isDisabled(`#${id}`), true, `${id} disabled in Intro`);
    const before = await page.evaluate(() => document.getElementById('scene').toDataURL());
    await page.clock.runFor(3000);
    assert.deepEqual(await readSim(page), s, 'no clock, no obstacle motion');
    assert.equal(await page.evaluate(() => document.getElementById('scene').toDataURL()), before);
  });
});

test('Intro stays nonmodal: header, News, sources and the footer About link remain usable; About never starts play', async () => {
  await withGame(env, {}, async ({ page }) => {
    for (let i = 0; i < 40 && (await focusedId(page)) !== 'btn-start'; i++) await page.keyboard.press('Tab');
    assert.equal(await focusedId(page), 'btn-start', 'reachable by Tab');
    await page.keyboard.press('Tab');
    assert.notEqual(await focusedId(page), 'btn-start', 'no focus trap');
    await page.click('#link-about');
    assert.match(page.url(), /#about$/);
    assert.equal((await readSim(page)).state, 'intro');
    assert.equal(await page.isVisible('#about'), true);
    assert.equal(await page.isVisible('#link-open-x'), true);
    await page.click('#link-open-x', { trial: true });
    await page.clock.runFor(1000);
    assert.equal((await readSim(page)).state, 'intro');
  });
});

test('Start: native click / touch tap / Space begin once; clicking elsewhere in the arena never starts', async () => {
  await withGame(env, {}, async ({ page }) => {
    const a = await rect(page, '#arena');
    await page.mouse.click(a.x + 6, a.y + 6); // arena corner, not the Start button
    await page.clock.runFor(200);
    assert.equal((await readSim(page)).state, 'intro');
    await page.click('#btn-start');
    assert.equal((await readSim(page)).state, 'running');
    assert.equal(await focusedId(page), 'arena', 'focus moves to the named play region');
    assert.equal(await page.evaluate(() => document.getElementById('panel-intro').hidden), true);
    await page.clock.runFor(500);
    const s = await readSim(page);
    assert.ok(s.tUs > 400_000 && s.y === 0.5, 'clock runs, the opening click did not steer');
  });
  await withGame(env, { touch: true, viewport: { width: 390, height: 844 } }, async ({ page }) => {
    await page.tap('#btn-start');
    await page.clock.runFor(600);
    const s = await readSim(page);
    assert.equal(s.state, 'running');
    assert.equal(s.y, 0.5, 'touch Start never doubles as Fly up/down');
  });
  await withGame(env, {}, async ({ page }) => {
    await page.focus('#btn-start');
    await page.keyboard.press('Space');
    await page.clock.runFor(100);
    const s = await readSim(page);
    assert.deepEqual([s.state, s.armed, s.y], ['running', 'false', 0.5]);
    assert.ok(s.tUs > 0);
  });
});

test('hold-to-start: Enter keeps the clock at t=0 until it is released; directions held meanwhile are cleared', async () => {
  await withGame(env, {}, async ({ page }) => {
    await page.focus('#btn-start');
    await page.keyboard.down('Enter');
    let s = await readSim(page);
    assert.deepEqual([s.state, s.armed], ['running', 'true']);
    await page.keyboard.down('ArrowDown'); // pressed while the opening key is down: must not steer
    await page.clock.runFor(800);
    s = await readSim(page);
    assert.deepEqual([s.tUs, s.y], [0, 0.5], 'frozen at t=0 while armed');
    await page.keyboard.up('Enter');
    await page.clock.runFor(300);
    s = await readSim(page);
    assert.equal(s.armed, 'false');
    assert.ok(s.tUs > 200_000);
    assert.equal(s.y, 0.5, 'a key pressed during arming is cleared; it needs a fresh press');
    await page.keyboard.up('ArrowDown');
    await page.keyboard.down('ArrowDown');
    await page.clock.runFor(200);
    assert.ok((await readSim(page)).y > 0.5, 'fresh press steers');
    await page.keyboard.up('ArrowDown');
  });
});

test('keyboard steering: ArrowUp/ArrowDown and W/S at 0.52 arena-heights/s, immediate stop, neutral holds, both cancel', async () => {
  await withGame(env, {}, async ({ page }) => {
    await start(page);
    for (const [key, sign] of [['ArrowDown', 1], ['s', 1], ['ArrowUp', -1], ['w', -1]]) {
      const a = await readSim(page);
      await page.keyboard.down(key);
      await page.clock.runFor(160);
      const b = await readSim(page);
      await page.keyboard.up(key);
      assert.ok(b.tUs > a.tUs, key);
      speedOk(a, b, sign);
      assert.equal(b.held, sign > 0 ? 'down' : 'up');
      const c = await readSim(page);
      await page.clock.runFor(160);
      const d = await readSim(page);
      assert.equal(d.y, c.y, `${key}: released => neutral holds altitude`);
      assert.equal(d.held, 'none');
    }
    const a = await readSim(page);
    await page.keyboard.down('ArrowUp'); await page.keyboard.down('ArrowDown');
    await page.clock.runFor(160);
    const b = await readSim(page);
    assert.equal(b.y, a.y); assert.equal(b.held, 'cancel');
    await page.keyboard.up('ArrowUp'); // down alone now wins
    await page.clock.runFor(160);
    assert.ok((await readSim(page)).y > a.y);
    await page.keyboard.up('ArrowDown');
  });
});

test('direction keys are consumed only while the play region owns gameplay focus; scroll/typing/links elsewhere are untouched', async () => {
  await withGame(env, {}, async ({ page }) => {
    await page.evaluate(() => { /** @type {any} */ (window).__prevented = []; window.addEventListener('keydown', (e) => /** @type {any} */ (window).__prevented.push([e.key, e.defaultPrevented])); });
    // Intro: the page owns the keys (arrow/space scroll the page)
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Space');
    await start(page);
    await page.keyboard.down('ArrowDown'); await page.keyboard.up('ArrowDown');
    await page.keyboard.press('Space'); await page.keyboard.press('PageDown');
    await page.keyboard.press('Escape'); // pause
    // Paused: ordinary document navigation is back
    await page.focus('#link-about');
    await page.keyboard.press('ArrowDown');
    const log = await page.evaluate(() => /** @type {any} */ (window).__prevented);
    assert.deepEqual(log, [['ArrowDown', false], [' ', false], ['ArrowDown', true], [' ', true], ['PageDown', true], ['Escape', true], ['ArrowDown', false]]);
  });
});

test('Escape / Pause button pause, freeze time and geometry, clear held input, focus Resume; Resume keeps t/y/seams and waits for release', async () => {
  await withGame(env, {}, async ({ page }) => {
    await start(page);
    await runTo(page, 4_000_000);
    await page.keyboard.down('ArrowUp'); // held when Escape arrives
    await page.clock.runFor(48);
    const hold = await readSim(page);
    await page.keyboard.press('Escape');
    let s = await readSim(page);
    assert.equal(s.state, 'paused'); assert.equal(s.held, 'none'); assert.equal(await focusedId(page), 'btn-resume');
    assert.equal(s.pausedBy, 'escape');
    assert.ok(s.tUs >= hold.tUs && s.tUs - hold.tUs < 40_000);
    const view = await page.evaluate(() => document.getElementById('scene').toDataURL());
    await page.clock.runFor(2000);
    assert.deepEqual(await readSim(page), s, 'frozen');
    assert.equal(await page.evaluate(() => document.getElementById('scene').toDataURL()), view, 'frozen geometry');
    for (const id of ['btn-up', 'btn-down']) assert.equal(await page.isDisabled(`#${id}`), true, id);
    assert.equal(await page.evaluate(() => document.getElementById('page').inert), false, 'Paused is nonmodal');
    await page.keyboard.up('ArrowUp');
    // Resume by keyboard: Enter held keeps it armed (clock waits for release)
    await page.keyboard.down('Enter');
    let r = await readSim(page);
    assert.deepEqual([r.state, r.armed, r.tUs, r.y], ['running', 'true', s.tUs, s.y]);
    await page.clock.runFor(500);
    assert.equal((await readSim(page)).tUs, s.tUs, 'waits for the opening key release');
    await page.keyboard.up('Enter');
    await page.clock.runFor(200);
    r = await readSim(page);
    assert.equal(r.armed, 'false'); assert.ok(r.tUs > s.tUs); assert.equal(r.y, s.y, 'directions cleared; opening input never steers'); assert.equal(r.cleared, s.cleared);
    assert.equal(await focusedId(page), 'arena');
    // Pause button (mouse) pauses and focuses Resume; Resume by click continues
    await page.click('#btn-pause');
    s = await readSim(page);
    assert.equal(s.state, 'paused'); assert.equal(await focusedId(page), 'btn-resume');
    await page.click('#btn-resume');
    await page.clock.runFor(100);
    r = await readSim(page);
    assert.equal(r.state, 'running'); assert.ok(r.tUs > s.tUs); assert.equal(r.y, s.y);
  });
});

test('automatic pauses: Tab out, window blur, hidden document, long frame gap, scroll offscreen, real layout change; never auto-resume', async () => {
  const cases = {
    async focus(page) { await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); }, // arena -> up -> down -> Pause button
    async blur(page) { await page.evaluate(() => window.dispatchEvent(new Event('blur'))); },
    async hidden(page) { await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }); },
    async gap(page) { await page.clock.fastForward(450); }, // one frame callback 450 ms later
    async offscreen(page) { await page.evaluate(() => scrollTo(0, 5000)); await page.waitForFunction(() => document.getElementById('game').dataset.state === 'paused', null, { timeout: 5000 }); },
    async layout(page) { await page.setViewportSize({ width: 1100, height: 700 }); await page.waitForFunction(() => document.getElementById('game').dataset.state === 'paused', null, { timeout: 5000 }); },
  };
  for (const [name, trigger] of Object.entries(cases)) {
    await withGame(env, { viewport: { width: 1280, height: 800 } }, async ({ page }) => {
      await start(page);
      await runTo(page, 1_500_000);
      await page.keyboard.down('ArrowDown');
      await page.clock.runFor(48);
      const before = await readSim(page);
      await trigger(page);
      await page.keyboard.up('ArrowDown');
      const s = await readSim(page);
      assert.equal(s.state, 'paused', `${name} pauses`);
      assert.equal(s.pausedBy, name === 'focus' ? 'focus' : name === 'blur' ? 'blur' : name === 'hidden' ? 'hidden' : name === 'gap' ? 'gap' : name === 'offscreen' ? 'offscreen' : 'layout');
      assert.equal(s.held, 'none', `${name} clears inputs`);
      assert.ok(s.tUs - before.tUs < 70_000, `${name}: at most a frame of progress (${s.tUs - before.tUs} us), never a jump`);
      assert.ok(Math.abs(s.y - before.y) < 0.04);
      assert.equal(await page.evaluate(() => document.getElementById('panel-paused').hidden), false);
      await page.evaluate(() => { try { delete /** @type {any} */ (document).hidden; } catch { /* ignore */ } });
      await page.clock.runFor(1500);
      const later = await readSim(page);
      assert.equal(later.state, 'paused', `${name}: no auto-resume`);
      assert.equal(later.tUs, s.tUs);
      assert.equal(later.y, s.y);
    });
  }
});

test('a long frame gap cannot hide a death or teleport the fly: gap > 100 ms pauses at the previous state', async () => {
  await withGame(env, { viewport: { width: 1280, height: 800 } }, async ({ page }) => {
    await start(page);
    await runTo(page, 5_700_000, { bot: { tick: async () => {}, release: async () => {} } }); // neutral y=.5: seam 2 is about to hit at 5.86 s
    const before = await readSim(page);
    assert.equal(before.state, 'running');
    await page.clock.fastForward(1000); // would have crossed the wall; must pause instead
    const s = await readSim(page);
    assert.equal(s.state, 'paused');
    assert.equal(s.tUs, before.tUs, 'not a single microsecond simulated across the gap');
    assert.equal(s.y, before.y);
  });
});

test('redundant resize events with unchanged arena bounds do nothing; changing only the viewport width of a fixed arena is not a layout change', async () => {
  await withGame(env, { viewport: { width: 1280, height: 800 } }, async ({ page }) => {
    await start(page);
    for (let i = 0; i < 4; i++) await page.evaluate(() => { window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('orientationchange')); });
    await page.clock.runFor(200);
    assert.equal((await readSim(page)).state, 'running');
  });
});

test('rotation: portrait -> landscape mid-run pauses, keeps t/y/seams exactly, then explicit Resume continues in the new composition', async () => {
  await withGame(env, { viewport: { width: 390, height: 844 }, touch: true }, async ({ page }) => {
    await start(page);
    await runTo(page, 4_200_000);
    const before = await readSim(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction(() => document.getElementById('game').dataset.state === 'paused', null, { timeout: 5000 });
    const s = await readSim(page);
    assert.equal(s.state, 'paused'); assert.equal(s.pausedBy, 'layout');
    assert.ok(s.tUs - before.tUs < 40_000); assert.ok(Math.abs(s.y - before.y) < 0.02); assert.equal(s.cleared, before.cleared);
    await page.clock.runFor(1000);
    assert.equal((await readSim(page)).tUs, s.tUs, 'never auto-resumes');
    await page.click('#btn-resume');
    await page.clock.runFor(100);
    const r = await readSim(page);
    assert.equal(r.state, 'running'); assert.ok(r.tUs > s.tUs); assert.equal(r.y, s.y);
  });
});

test('Restart (utility, Paused, result), Retry and Play again each return to a fresh focused Intro; rapid restarts leak nothing', async () => {
  await withGame(env, {}, async ({ page }) => {
    const fresh = await readSim(page);
    for (let round = 0; round < 3; round++) {
      await start(page);
      await runTo(page, 4_000_000);
      await page.click('#btn-restart');
      let s = await readSim(page);
      assert.deepEqual([s.state, s.tUs, s.y, s.cleared], ['intro', 0, 0.5, 0]);
      assert.equal(await focusedId(page), 'btn-start');
    }
    // from Paused
    await start(page); await runTo(page, 1_000_000);
    await page.keyboard.press('Escape'); await page.click('#btn-restart-paused');
    assert.deepEqual({ ...(await readSim(page)), armed: undefined }, { ...fresh, held: 'none' });
    assert.equal(await focusedId(page), 'btn-start');
    // double activation of Restart in a single tick
    await start(page);
    await page.evaluate(() => { const b = document.getElementById('btn-restart'); b.click(); b.click(); b.click(); });
    assert.equal((await readSim(page)).state, 'intro');
    await page.clock.runFor(5000);
    const idle = await readSim(page);
    assert.deepEqual([idle.state, idle.tUs, idle.y], ['intro', 0, 0.5]);
    assert.equal(await page.evaluate(() => document.getElementById('panel-result').hidden && document.getElementById('panel-paused').hidden), true);
  });
});

test('loss: freezes at the contact instant with a visible burst, "Bonk. Still in beta." + Retry; Retry returns to a focused Intro, not action', async () => {
  await withGame(env, {}, async ({ page }) => {
    await start(page);
    let s = await readSim(page);
    for (let i = 0; i < 600 && s.state === 'running'; i++) { await page.clock.runFor(16); s = await readSim(page); }
    assert.equal(s.state, 'lost');
    assert.equal(s.tUs, 5_860_000, 'neutral y=.5 clears seam 1 and meets seam 2 at its first contact instant');
    assert.equal(s.cleared, 1);
    assert.equal(await page.getAttribute('#game', 'data-hit-seam'), '2');
    assert.equal(await page.textContent('#result-heading'), 'Bonk. Still in beta.');
    assert.equal(await focusedId(page), 'result-heading');
    assert.equal(await page.isVisible('#btn-retry'), true);
    assert.equal(await page.isVisible('#btn-again'), false);
    assert.equal(await page.isVisible('#btn-copy'), false);
    assert.equal(await page.isVisible('#result-copy'), false);
    // the burst is drawn where the core met the wall
    const burst = await page.evaluate(() => {
      const c = /** @type {HTMLCanvasElement} */ (document.getElementById('scene'));
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0; let minX = 1e9; let maxX = -1; let minY = 1e9; let maxY = -1;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (d[i] === 255 && d[i + 1] === 0xe1 && d[i + 2] === 0x4a && d[i + 3] === 255) { n++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); } }
      return { n, minX, maxX, minY, maxY, W: c.width, H: c.height };
    });
    assert.ok(burst.n > 20, 'burst pixels exist');
    const hitY = Number(await page.getAttribute('#game', 'data-hit-y'));
    near((burst.minY + burst.maxY) / 2 / burst.H, hitY, 0.03, 'burst at the collision height');
    near((burst.minX + burst.maxX) / 2 / burst.W, 0.23 + 0.018, 0.06, 'burst at the wall face by the fly');
    assert.equal(await page.evaluate(() => /** @type {HTMLElement} */ (document.getElementById('panel-result')).dataset.pos !== ''), true);
    await page.clock.runFor(3000);
    assert.equal((await readSim(page)).tUs, 5_860_000, 'frozen, no win after loss');
    // Retry => Intro
    await page.click('#btn-retry');
    s = await readSim(page);
    assert.deepEqual([s.state, s.tUs, s.y, s.cleared], ['intro', 0, 0.5, 0]);
    assert.equal(await focusedId(page), 'btn-start');
    assert.equal(await page.getAttribute('#game', 'data-hit-seam'), null);
    await page.clock.runFor(1500);
    assert.equal((await readSim(page)).tUs, 0);
  });
});

test('win at t=20.000 s: 7/7, heading + exact final copy, banana.png reveal with Skip, Play again / Copy result; Play again returns to Intro', async () => {
  await withGame(env, {}, async ({ page }) => {
    await start(page);
    const s = await playFake(page);
    assert.equal(s.state, 'won'); assert.equal(s.tUs, 20_000_000); assert.equal(s.cleared, 7);
    assert.equal(await page.textContent('#seam-count'), '7');
    assert.equal(await page.textContent('#result-heading'), 'You escaped the simulation.');
    assert.equal(await page.textContent('#result-copy'), 'WORLD: FAKE. LUNCH: REAL ENOUGH.');
    assert.equal(await focusedId(page), 'result-heading');
    assert.equal(await page.isVisible('#btn-skip'), true, 'Skip reveal is available immediately');
    assert.equal(await page.isVisible('#btn-again'), true);
    assert.equal(await page.isVisible('#btn-copy'), true);
    assert.equal(await page.isVisible('#btn-retry'), false);
    assert.match(await page.getAttribute('#scene', 'aria-label'), /banana\.png/);
    const filled = await page.evaluate(() => [...document.querySelectorAll('#ticks li')].every((li) => li.getAttribute('data-done') === 'true'));
    assert.equal(filled, true);
    const tags = await page.evaluate(() => [...document.querySelectorAll('.tag')].every((t) => t.hidden));
    assert.equal(tags, true, 'no stale cue tags in the payoff');
    await page.clock.runFor(1750);
    assert.equal(await page.isVisible('#btn-skip'), false, 'the animation ends by itself within ~1.7 s');
    await page.click('#btn-again');
    const r = await readSim(page);
    assert.deepEqual([r.state, r.tUs, r.y, r.cleared], ['intro', 0, 0.5, 0]);
    assert.equal(await focusedId(page), 'btn-start');
  });
});

test('reveal: Skip, natural completion and reduced motion all end on the same static final frame; restart during the reveal leaves no timer behind', async () => {
  const finalFrame = async (mode) => {
    let hash = '';
    await withGame(env, { reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' }, async ({ page }) => {
      await start(page);
      await playFake(page);
      if (mode === 'skip') { await page.click('#btn-skip'); }
      else if (mode === 'natural') await page.clock.runFor(2000);
      else assert.equal(await page.isVisible('#btn-skip'), false, 'reduced motion: static frame, nothing to skip');
      hash = await canvasHash(page);
      await page.clock.runFor(1000);
      assert.equal(await canvasHash(page), hash, 'stable');
    });
    return hash;
  };
  const [skip, natural, reduced] = [await finalFrame('skip'), await finalFrame('natural'), await finalFrame('reduced')];
  assert.equal(skip, natural);
  assert.equal(natural, reduced);
  await withGame(env, {}, async ({ page }) => {
    await start(page);
    const introHash = await (async () => { await page.click('#btn-restart'); const h = await canvasHash(page); await page.click('#btn-start'); await page.clock.runFor(48); return h; })();
    await playFake(page);
    await page.clock.runFor(600); // mid reveal
    await page.click('#btn-restart');
    await page.clock.runFor(4000);
    assert.equal(await canvasHash(page), introHash, 'a restarted Intro is not repainted by an old reveal');
    assert.equal((await readSim(page)).state, 'intro');
  });
});

test('events at the table boundaries: OLD / NEXT GAP from T-2.4, WORLD UPDATED at T-1.4 for 1.0 s, then clean; one pending recompile at a time', async () => {
  await withGame(env, {}, async ({ page }) => {
    await start(page);
    const probe = () => page.evaluate(() => ({ old: !document.getElementById('tag-old').hidden, next: !document.getElementById('tag-next').hidden, upd: !document.getElementById('tag-updated').hidden, cue: document.getElementById('cue-text').dataset.kind || '' }));
    const bot = createBot(page);
    const seen = [];
    let s = await readSim(page);
    for (let i = 0; i < 1500 && s.state === 'running' && s.tUs < 16_000_000; i++) {
      await bot.tick(s);
      await page.clock.runFor(16);
      s = await readSim(page);
      const p = await probe();
      const t = s.tUs / 1e6;
      const win = (a, b) => t >= a + 0.02 && t < b - 0.02; // away from the exact instants (frame granularity)
      for (const [T] of [[6.0], [10.8], [15.6]]) {
        if (win(T - 2.4, T - 1.4)) { assert.deepEqual([p.old, p.next, p.upd, p.cue], [true, true, false, 'rebuild'], `preview ${T} t=${t}`); seen.push(`p${T}`); }
        if (win(T - 1.4, T - 0.4)) { assert.deepEqual([p.old, p.next, p.upd, p.cue], [false, false, true, 'updated'], `commit ${T} t=${t}`); seen.push(`c${T}`); }
      }
      if (win(0, 3.5) || win(7.0, 7.9) || win(12.0, 12.7)) assert.deepEqual([p.old, p.next, p.upd], [false, false, false], `quiet t=${t}`);
    }
    await bot.release();
    for (const k of ['p6', 'c6', 'p10.8', 'c10.8', 'p15.6', 'c15.6']) assert.ok(seen.includes(k), `${k} observed`);
    assert.equal(s.state, 'running');
  });
});

test('wall openings are drawn on the exact normalized bounds (pixel sampled), old opening until the commit then the final one', async () => {
  await withGame(env, { viewport: { width: 1280, height: 800 } }, async ({ page }) => {
    await start(page);
    const bot = createBot(page);
    const sample = async (seamN) => {
      await page.keyboard.press('Escape'); // freeze so we sample a stable frame
      const out = await page.evaluate((n) => {
        const SEAMS = [[3.6, 0.5, 0.5], [6.0, 0.25, 0.75], [8.4, 0.25, 0.25]];
        const g = document.getElementById('game'); const c = /** @type {HTMLCanvasElement} */ (document.getElementById('scene'));
        const t = Number(g.dataset.tUs) / 1e6; const [T, o, f] = SEAMS[n - 1];
        const center = t >= T - 1.4 ? f : o;
        const W = c.width; const H = c.height;
        const x = Math.round((0.23 + 0.3 * (T - t)) * W);
        const d = c.getContext('2d').getImageData(0, 0, W, H).data;
        const px = (xx, yy) => { const i = (yy * W + xx) * 4; return [d[i], d[i + 1], d[i + 2]]; };
        const hex = (a) => `#${a.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
        const wallish = new Set(['#2e7d39', '#53b05a', '#1f5a29', '#fff6c8', '#143d1a', '#164a78', '#7fefff', '#ffffff', '#000000', '#1e2f9c', '#dcdce6', '#aaaab8', '#5a5a6a', '#1a1a24', '#ff2fb9', '#2ff0ff']);
        const top = Math.round((center - 0.14) * H); const bot2 = Math.round((center + 0.14) * H);
        const col = [];
        for (let y = 0; y < H; y++) col.push(wallish.has(hex(px(x, y))));
        return { x, W, H, t, center, top, bot: bot2, col };
      }, seamN);
      await page.click('#btn-resume'); await page.clock.runFor(16);
      return out;
    };
    // seam 1 visible well before arrival (t ~ 2.0 s)
    await runTo(page, 2_000_000, { bot });
    let o = await sample(1);
    assert.equal(o.center, 0.5);
    assert.equal(o.col[o.top - 1], true, 'solid just above the opening');
    assert.equal(o.col[o.top], false, 'opening starts at round((c-.14)H)');
    assert.equal(o.col[o.bot - 1], false);
    assert.equal(o.col[o.bot], true, 'solid again at round((c+.14)H)');
    assert.equal(o.col.slice(o.top, o.bot).some(Boolean), false, 'nothing solid inside the opening');
    assert.equal(o.col.slice(0, o.top).every(Boolean), true); assert.equal(o.col.slice(o.bot).every(Boolean), true);
    // seam 2 while only the OLD opening is real (t ~ 4.2), and after the commit (t ~ 5.0)
    await runTo(page, 4_200_000, { bot });
    o = await sample(2);
    assert.equal(o.center, 0.25, 'old opening before the commit');
    assert.equal(o.col[o.top - 1], true); assert.equal(o.col[o.top], false); assert.equal(o.col[o.bot - 1], false); assert.equal(o.col[o.bot], true);
    await runTo(page, 5_000_000, { bot });
    o = await sample(2);
    assert.equal(o.center, 0.75, 'final opening after the commit');
    assert.equal(o.col[o.top - 1], true); assert.equal(o.col[o.top], false); assert.equal(o.col[o.bot - 1], false); assert.equal(o.col[o.bot], true);
    assert.equal(o.col.slice(0, o.top).every(Boolean) && o.col.slice(o.bot).every(Boolean), true, 'the old opening is filled in');
  });
});

test('polite live announcements are concise state changes only: no per-frame time or y', async () => {
  await withGame(env, { init: () => {
    /** @type {any} */ (window).__live = [];
    new MutationObserver(() => /** @type {any} */ (window).__live.push((document.getElementById('live')?.textContent || '').trim())).observe(document, { subtree: true, childList: true, characterData: true });
  } }, async ({ page }) => {
    assert.equal(await page.getAttribute('#live', 'aria-live'), 'polite');
    assert.equal(await page.getAttribute('#live', 'role'), 'status');
    await start(page);
    await runTo(page, 7_000_000);
    await page.keyboard.press('Escape');
    const live = (await page.evaluate(() => /** @type {any} */ (window).__live)).filter((s, i, a) => s && s !== a[i - 1]);
    assert.deepEqual(live, ['Started. Follow the dashed gap when the world rebuilds.', 'World rebuilding. Follow the dashed gap.', 'World updated.', 'Paused.']);
  });
});

test('focus rules: Tab out leaves focus where the user put it; result moves focus to its heading then Tab reaches the buttons', async () => {
  await withGame(env, {}, async ({ page }) => {
    await start(page);
    await page.keyboard.press('Tab'); // arena -> Fly up (still inside the play region)
    assert.equal(await focusedId(page), 'btn-up');
    assert.equal((await readSim(page)).state, 'running');
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); // Fly down, then the Pause button (outside)
    assert.equal(await focusedId(page), 'btn-pause');
    assert.equal((await readSim(page)).state, 'paused', 'Tab out pauses and leaves focus on the element tabbed to');
  });
  await withGame(env, {}, async ({ page }) => {
    await start(page);
    for (let i = 0; i < 400 && (await readSim(page)).state === 'running'; i++) await page.clock.runFor(16);
    assert.equal(await focusedId(page), 'result-heading');
    await page.keyboard.press('Tab');
    assert.equal(await focusedId(page), 'btn-retry');
    for (const id of ['btn-again', 'btn-copy', 'btn-skip', 'copy-text']) assert.equal(await page.evaluate((i) => document.getElementById(i).offsetParent === null || document.getElementById(i).hidden, id), true, `${id} hidden/not in tab order on a loss`);
  });
});

test('accessible names, headings and landmarks: named buttons, labelled sections, one h1, no unnamed controls', async () => {
  await withGame(env, { viewport: { width: 390, height: 844 }, touch: true }, async ({ page }) => {
    for (const name of ['Start', 'Fly up', 'Fly down', 'Pause', 'Restart']) assert.equal(await page.getByRole('button', { name, exact: true }).count(), 1, `button "${name}"`);
    assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1);
    assert.match(await page.getByRole('heading', { level: 1 }).textContent(), /Fly the Simulation/);
    assert.equal(await page.getByRole('region', { name: 'Fly the Simulation', exact: true }).count(), 1, 'Intro is a labelled section');
    assert.equal(await page.getByRole('group', { name: /Play area/ }).count(), 1);
    assert.equal(await page.getByRole('heading', { name: 'News behind the game' }).count(), 1);
    assert.equal(await page.getByRole('link', { name: 'About', exact: true }).count(), 1);
    const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, a[href], textarea')].filter((e) => !(e.getAttribute('aria-label') || e.textContent.trim() || e.getAttribute('title'))).map((e) => e.id || e.tagName));
    assert.deepEqual(unnamed, []);
    // disabled Previous/Next keep names and disabled semantics
    const prev = page.getByRole('button', { name: /Previous game/ });
    assert.equal(await prev.isDisabled(), true);
    // the canvas has a text alternative; decorative cue tags are hidden from assistive technology
    assert.match(await page.getAttribute('#scene', 'aria-label'), /cartoon fly/);
    assert.equal(await page.getAttribute('#tags', 'aria-hidden'), 'true');
    assert.equal(await page.getAttribute('#ticks', 'aria-hidden'), 'true');
  });
});

test('footer About while Paused never resumes or starts play; hidden controls are out of the tab order in every state', async () => {
  await withGame(env, { viewport: { width: 1280, height: 800 } }, async ({ page }) => {
    const tabbable = () => page.evaluate(() => [...document.querySelectorAll('#game button, #game textarea, #game [tabindex]')].filter((e) => !e.disabled && e.tabIndex >= 0 && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map((e) => e.id));
    assert.deepEqual(await tabbable(), ['btn-start']);
    await start(page);
    assert.deepEqual(await tabbable(), ['btn-up', 'btn-down', 'btn-pause', 'btn-restart']);
    await page.keyboard.press('Escape');
    const s = await readSim(page);
    assert.deepEqual(await tabbable(), ['btn-resume', 'btn-restart-paused', 'btn-pause', 'btn-restart']);
    await page.click('#link-about');
    await page.clock.runFor(1000);
    assert.deepEqual(await readSim(page), s, 'About does not resume');
    await page.evaluate(() => scrollTo(0, 0));
    await page.clock.runFor(500);
    assert.equal((await readSim(page)).state, 'paused');
    await page.click('#btn-restart-paused');
    assert.deepEqual(await tabbable(), ['btn-start']);
  });
});

test('tiny screens: minimums that cannot fit let the document scroll; Paused explains "More room needed", never over a running hazard', async () => {
  await withGame(env, { viewport: { width: 320, height: 400 }, touch: true }, async ({ page }) => {
    await page.evaluate(() => scrollTo(0, 0));
    const m = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, vh: innerHeight, arena: document.getElementById('arena').getBoundingClientRect().height, up: document.getElementById('btn-up').getBoundingClientRect().height }));
    assert.ok(m.arena >= 180, `arena keeps its minimum (${m.arena})`);
    assert.ok(m.up >= 56, 'controls are not shrunk');
    assert.ok(m.h > m.vh, 'the document scrolls rather than clipping');
    await start(page);
    assert.equal(await page.isVisible('#room-note'), false, 'no note over a running hazard');
    await page.evaluate(() => scrollTo(0, 5000));
    await page.waitForFunction(() => document.getElementById('game').dataset.state === 'paused', null, { timeout: 5000 }); // the scroll event arrives on the next real frame
    assert.equal((await readSim(page)).state, 'paused');
    assert.equal(await page.isVisible('#room-note'), true);
    assert.equal((await page.textContent('#room-note')).trim(), 'More room needed — rotate or scroll to the play area.');
  });
});

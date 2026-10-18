// r6 entry/reset semantics: every entry, Restart (play or Pause) and Retry (any outcome) land in a non-modal Intro inside
// the arena; only the native Start round control can begin the countdown; Resume keeps the round.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, openGame, state, text, hp, startFight, playToWin, until } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const active = (page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
const requests = (page) => page.getAttribute('#app', 'data-punch-requests');
const calls = (page) => page.evaluate(() => window.__tw?.calls ?? []);
const stopped = async (page) => [await state(page), await text(page, '#time-left'), ...(await hp(page))];
const introVisible = (page) => page.isVisible('#panel-intro');
const countdownTo = async (page) => { for (let i = 0; i < 400 && (await state(page)) !== 'playing'; i++) await page.clock.runFor(16); };

test('first entry: Intro inside the arena, Start focused with a visible ring, nothing advances, combat keys outside Start do nothing, Escape does not dismiss', async () => {
  const g = await openGame(env, { viewport: { width: 390, height: 844 } });
  const { page } = g;
  assert.equal(await introVisible(page), true);
  assert.equal(await active(page), 'btn-start');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('btn-start')).outlineStyle), 'solid', 'visible focus ring');
  assert.deepEqual(await stopped(page), ['intro', '30', 100, 100]);
  await page.clock.runFor(45000); // far longer than a round
  assert.deepEqual(await stopped(page), ['intro', '30', 100, 100]);
  // combat keys anywhere, including with focus on the arena itself and on the document body, cannot start or attack
  await page.evaluate(() => document.activeElement.blur());
  for (const k of ['Space', 'j', 'J', 'k', 'K', 'Shift', 'Escape']) await page.keyboard.press(k);
  await page.focus('#arena');
  for (const k of ['Space', 'j', 'k', 'Shift']) await page.keyboard.press(k);
  assert.equal(await state(page), 'intro');
  assert.equal(await introVisible(page), true, 'Escape never dismisses the overlay');
  assert.equal(await requests(page), '0');
  assert.equal(await page.evaluate(() => document.getElementById('countdown').hidden), true);
  assert.deepEqual(g.problems, []);
  await g.context.close();
});

test('Intro is non-modal: Tab and Shift+Tab reach nav, news, embed link and footer About; nothing is inert; no trap', async () => {
  const g = await openGame(env, { viewport: { width: 320, height: 568 } });
  const { page } = g;
  assert.equal(await page.evaluate(() => document.getElementById('page').inert || document.getElementById('panel-intro').closest('[inert]') !== null), false);
  assert.equal(await page.evaluate(() => document.getElementById('panel-intro').getAttribute('aria-modal')), null);
  const fwd = [];
  for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); fwd.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.textContent?.trim().slice(0, 24) || document.activeElement?.tagName)); }
  for (const need of ['link-open-x', 'btn-about']) assert.ok(fwd.includes(need), `forward reached ${need}: ${fwd}`);
  assert.ok(fwd.some((x) => /FearedBuck reporting/.test(x)), 'news source link');
  assert.ok(fwd.some((x) => /Skip to content|Trend Raiders/.test(x)), 'wrapped back into the header: no trap');
  await page.focus('#btn-start');
  const back = [];
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Shift+Tab'); back.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.textContent?.trim().slice(0, 24))); }
  assert.ok(back.some((x) => /Sound|17 Oct/.test(x)), `Shift+Tab reaches the nav/tools: ${back}`);
  assert.equal(await state(page), 'intro');
  assert.equal(await requests(page), '0');
  await g.context.close();
});

test('accessible Start: Enter, Space and pointer each begin exactly one 3-2-1; overlay leaves the layout and the accessibility tree; no simulation in the countdown', async () => {
  for (const how of ['enter', 'space', 'click']) {
    const g = await openGame(env, { viewport: { width: 390, height: 844 } });
    const { page } = g;
    assert.ok(await page.getByRole('region', { name: 'Ready?' }).count() === 1, 'labeled intro region is in the accessibility tree');
    assert.equal(await page.locator('#btn-start').getAttribute('aria-describedby'), 'intro-goal intro-keys intro-touch', 'Start is described by the goal and key/touch mappings');
    if (how === 'click') await page.click('#btn-start');
    else { await page.focus('#btn-start'); await page.keyboard.press(how === 'enter' ? 'Enter' : 'Space'); }
    assert.equal(await state(page), 'countdown', how);
    assert.equal(await text(page, '#countdown'), '3');
    assert.equal(await page.getByRole('region', { name: 'Ready?' }).count(), 0, 'overlay removed from the accessibility tree');
    assert.equal(await page.evaluate(() => document.getElementById('panel-intro').hidden), true);
    assert.equal(await page.getByText('Block the hit').filter({ visible: true }).count(), 0, 'no instruction text visible during the countdown');
    // further activations during the countdown cannot start a second one
    await page.keyboard.press('Enter'); await page.keyboard.press('Space');
    await page.clock.runFor(2000);
    assert.deepEqual([await state(page), await text(page, '#time-left'), ...(await hp(page))], ['countdown', '30', 100, 100]);
    assert.equal(await text(page, '#countdown'), '1');
    await page.clock.runFor(1100);
    assert.equal(await state(page), 'playing');
    assert.equal(await active(page), 'arena', 'focus lands in the play region');
    assert.equal(await requests(page), '0', `${how}: the opening activation never became a punch`);
    assert.deepEqual(g.problems, []);
    await g.context.close();
  }
});

test('a held opening key or pointer never becomes an attack or guard; fresh presses are required', async () => {
  const g = await openGame(env, { viewport: { width: 390, height: 844 } });
  const { page } = g;
  await page.focus('#btn-start');
  await page.keyboard.down('Enter'); // click fires on keydown; the key stays down through the countdown
  assert.equal(await state(page), 'countdown');
  await page.keyboard.down('k'); // another key held across the countdown
  await countdownTo(page);
  await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); // auto-repeat while playing
  await page.keyboard.down('k');
  await page.clock.runFor(1500);
  assert.equal(await requests(page), '0', 'held Enter/Space never punches');
  assert.deepEqual(await hp(page), [78, 100], 'held K from before the countdown is not a guard: the first strike is unguarded');
  await page.keyboard.up('Enter'); await page.keyboard.up('k');
  await g.context.close();
});

test('Start is refused while the document is hidden', async () => {
  const g = await openGame(env, { viewport: { width: 390, height: 844 } });
  const { page } = g;
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); });
  await page.click('#btn-start');
  assert.equal(await state(page), 'intro');
  await g.context.close();
});

test('touch Start: a tap starts one countdown and the tap never punches or guards', async () => {
  const g = await openGame(env, { viewport: { width: 390, height: 844 }, touch: true });
  const { page } = g;
  await page.tap('#btn-start');
  assert.equal(await state(page), 'countdown');
  await countdownTo(page);
  assert.equal(await requests(page), '0');
  assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'false');
  await g.context.close();
});

test('Restart during play with a held Guard and a pending Punch: state cleared, focused Intro (not a countdown), nothing runs, a fresh Start gives the clean first strike', async () => {
  const g = await openGame(env, { viewport: { width: 390, height: 844 } });
  const { page } = g;
  await startFight(page);
  await page.keyboard.down('k');
  await page.clock.runFor(1300);
  await page.keyboard.press('Space'); // punch pending (impact +100 ms)
  await page.click('#btn-restart-play');
  assert.deepEqual(await stopped(page), ['intro', '30', 100, 100]);
  assert.equal(await page.getAttribute('#btn-guard', 'aria-pressed'), 'false');
  assert.equal(await active(page), 'btn-start');
  assert.equal(await introVisible(page), true);
  await page.clock.runFor(45000);
  assert.deepEqual(await stopped(page), ['intro', '30', 100, 100]);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.rail')).display), 'none', 'combat buttons are not operable behind Intro');
  await page.keyboard.up('k');
  await page.click('#btn-start');
  await countdownTo(page);
  await page.keyboard.down('k');
  await page.clock.runFor(1500);
  assert.deepEqual(await hp(page), [96, 100], 'first strike again at 1,400 ms, guarded');
  await g.context.close();
});

test('Pause: Restart resets to focused Intro; Resume keeps the same round via the countdown and never shows Intro', async () => {
  const g = await openGame(env, { viewport: { width: 390, height: 844 } });
  const { page } = g;
  await startFight(page);
  await page.keyboard.down('k');
  await page.clock.runFor(1500);
  assert.deepEqual(await hp(page), [96, 100]);
  await page.keyboard.press('Escape');
  assert.equal(await state(page), 'paused');
  const t = await text(page, '#time-left');
  await page.click('#btn-resume');
  assert.equal(await state(page), 'countdown');
  assert.equal(await introVisible(page), false, 'Resume is not a reset');
  assert.equal(await page.getByRole('region', { name: 'Ready?' }).count(), 0);
  await countdownTo(page);
  assert.deepEqual(await hp(page), [96, 100], 'same round');
  assert.equal(await text(page, '#time-left'), t);
  await page.keyboard.press('Escape');
  const before = await requests(page);
  await page.focus('#btn-restart');
  await page.keyboard.press('Space'); // activating Restart with the keyboard cannot also punch
  assert.deepEqual(await stopped(page), ['intro', '30', 100, 100]);
  assert.equal(await requests(page), before);
  assert.equal(await active(page), 'btn-start');
  await g.context.close();
});

for (const outcome of ['loss', 'timeout', 'win']) {
  test(`Retry after a ${outcome}: focused Intro, not a countdown; nothing advances; Start runs a clean round; no duplicate widget or script`, async () => {
    const g = await openGame(env, { viewport: { width: 390, height: 844 } });
    const { page } = g;
    await startFight(page);
    if (outcome === 'loss') await page.clock.runFor(9600);
    else if (outcome === 'timeout') { await page.keyboard.down('k'); await page.clock.runFor(31000); await page.keyboard.up('k'); }
    else await playToWin(page);
    assert.equal(await state(page), 'result');
    assert.equal(await page.isEnabled('#btn-retry'), true);
    const calls0 = (await calls(page)).length;
    const scripts0 = await page.evaluate(() => document.querySelectorAll('script[src*="platform.twitter.com"]').length);
    await page.click('#btn-retry');
    assert.deepEqual(await stopped(page), ['intro', '30', 100, 100]);
    assert.equal(await active(page), 'btn-start');
    assert.equal(await introVisible(page), true);
    assert.equal(await page.isVisible('#panel-result'), false);
    await page.clock.runFor(45000);
    assert.deepEqual(await stopped(page), ['intro', '30', 100, 100]);
    await page.click('#btn-start');
    await countdownTo(page);
    await page.keyboard.down('k');
    await page.clock.runFor(1500);
    assert.deepEqual(await hp(page), [96, 100]);
    assert.equal((await calls(page)).length, calls0, 'no second widget attempt');
    assert.equal(await page.evaluate(() => document.querySelectorAll('script[src*="platform.twitter.com"]').length), scripts0);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#embed-mount iframe').length), 1);
    assert.deepEqual(g.problems, []);
    await g.context.close();
  });
}

test('Double KO (engine fixture) is a draw result and Retry still returns to Intro (engine path unchanged)', async () => {
  const { Sim } = await import('../../games/2026-10-17/js/engine.js');
  const sim = new Sim({ ai: false });
  sim.applyDamageForTest(500, 100, 100);
  assert.equal(sim.result.reason, 'double-ko'); // the UI cannot reach this through ordinary combat; Retry is outcome-independent
  const g = await openGame(env, { viewport: { width: 390, height: 844 } });
  const { page } = g;
  await startFight(page);
  await page.clock.runFor(9600);
  await page.click('#btn-retry');
  assert.equal(await state(page), 'intro');
  await g.context.close();
});

test('provider completion and failure during Intro change nothing: state, focus, clock, HUD and overlay geometry stay put', async () => {
  for (const kind of ['ok', 'reject']) {
    const g = await openGame(env, { viewport: { width: 320, height: 568 }, provider: 'deferred' });
    const { page } = g;
    assert.ok(await until(async () => (await calls(page)).length === 1));
    const rects = () => page.evaluate(() => Object.fromEntries(['#arena', '#panel-intro', '#btn-start', '#hud'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [s, [r.x, r.y, r.width, r.height]]; })));
    const before = await rects();
    await page.evaluate(([i, k]) => window.__settle[i](k), [0, kind]);
    assert.deepEqual(await rects(), before);
    assert.deepEqual(await stopped(page), ['intro', '30', 100, 100]);
    assert.equal(await active(page), 'btn-start');
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    await g.context.close();
  }
});

test('history: returning to the route (back/forward/refresh) always shows a fresh focused Intro', async () => {
  const g = await openGame(env, { viewport: { width: 390, height: 844 } });
  const { page } = g;
  await startFight(page);
  await page.keyboard.down('k');
  await page.clock.runFor(1500);
  await Promise.all([page.waitForURL(`${env.host.origin}/`), page.click('.site-header a.brand')]);
  await page.goBack();
  await page.waitForURL(`${env.host.origin}/games/2026-10-17/`);
  assert.deepEqual(await stopped(page), ['intro', '30', 100, 100]);
  assert.equal(await active(page), 'btn-start');
  await page.reload();
  assert.deepEqual(await stopped(page), ['intro', '30', 100, 100]);
  await g.context.close();
});

test('Exit from Pause leaves for the landing route (not an in-page Intro)', async () => {
  const g = await openGame(env, { viewport: { width: 390, height: 844 } });
  const { page } = g;
  await startFight(page);
  await page.keyboard.press('Escape');
  await Promise.all([page.waitForURL(`${env.host.origin}/`), page.click('#btn-exit')]);
  assert.equal(await state(page), 'intro');
  await g.context.close();
});

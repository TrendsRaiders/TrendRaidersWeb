// Share behavior once an edition is in a (fixture) verified release registry. The fixture origin is not a real site.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, openGame, state, text, startFight, playToWin, GAME } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup({ released: true }); });
after(async () => { await env.close(); });

const URL_ = 'https://games.example.test/games/2026-10-17/';

test('released edition: win text includes exact time and production edition URL; Web Share used on explicit click', async () => {
  const g = await openGame(env, {
    init: () => {
      window.__shared = [];
      navigator.share = async (d) => { window.__shared.push(d); };
    },
  });
  const { page } = g;
  assert.equal(await page.evaluate(() => window.__shared.length), 0);
  await startFight(page);
  await playToWin(page);
  const time = (await text(page, '#result-time')).match(/(\d+\.\d\d)s/)[1];
  assert.equal(await text(page, '#btn-share'), 'Share result');
  assert.equal(await page.locator('.preview-badge').count(), 0, 'no preview framing on a released edition');
  await page.click('#btn-share');
  assert.deepEqual(await page.evaluate(() => window.__shared), [{ text: `I scored a KO in ${time}s in 30-Second KO. Can you beat my time? ${URL_}` }]);
  assert.equal(await page.isVisible('#dlg-share'), false);
  await g.context.close();
});

test('canceled native share leaves the result unchanged, with no error or dialog', async () => {
  const g = await openGame(env, { init: () => { navigator.share = async () => { throw new DOMException('cancel', 'AbortError'); }; } });
  const { page } = g;
  await startFight(page);
  await page.clock.runFor(9500); // loss
  const before = await page.textContent('#panel-result');
  await page.click('#btn-share');
  await page.clock.runFor(100);
  assert.equal(await page.isVisible('#dlg-share'), false);
  assert.equal(await state(page), 'result');
  assert.equal(await page.textContent('#panel-result'), before);
  assert.deepEqual(g.problems, []);
  await g.context.close();
});

test('unsupported Web Share falls back to clipboard with the link; loss text per spec', async () => {
  const g = await openGame(env, {
    init: () => {
      window.__copied = [];
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t); } }, configurable: true });
    },
  });
  const { page } = g;
  await startFight(page);
  await page.clock.runFor(9500);
  await page.click('#btn-share');
  assert.deepEqual(await page.evaluate(() => window.__copied), [`Can you land a KO in 30 seconds? Try 30-Second KO: ${URL_}`]);
  assert.match(await text(page, '#share-note'), /Copied to clipboard/);
  await g.context.close();
});

test('released edition at its stable route still loads, has no preview framing, and root opens it', async () => {
  const g = await openGame(env, { route: '/' });
  const { page } = g;
  assert.equal(await page.locator('.preview-badge').count(), 0);
  assert.equal(await page.getAttribute('nav a[aria-current="page"]', 'href'), GAME);
  assert.match(await text(page, 'nav a[aria-current="page"]'), /^17 Oct 2026\s*UTC edition$/);
  assert.equal(await state(page), 'intro');
  assert.deepEqual(g.problems, []);
  await g.context.close();
});

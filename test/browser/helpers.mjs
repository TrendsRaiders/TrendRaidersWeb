import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync, writeFileSync, cpSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, ROOT } from '../../scripts/lib/build-lib.mjs';
import { serve } from '../helpers/static-server.mjs';

export const GAME = '/games/2026-10-17/';
export const CHROMIUM = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

/**
 * Builds the preview site and starts a browser.
 * released: put the real candidate in a FIXTURE release registry (share-link tests).
 * fixture: { release: [dates], preview: [dates], stubs: [dates] } builds isolated, non-public neighbor editions
 *   (stub pages) next to the real candidate. Nothing here is ever a real release.
 */
export async function setup({ released = false, fixture = null } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'tr-browser-'));
  const regPath = join(tmp, 'registry.json');
  const entry = (date) => ({ date, verified: true, sha: 'abc1234', origin: 'https://games.example.test', verification: 'fixture-only (browser test)' });
  const releaseDates = fixture ? fixture.release : released ? ['2026-10-17'] : [];
  writeFileSync(regPath, JSON.stringify({ schema: 1, editions: releaseDates.map(entry) }));
  const opts = { mode: /** @type {'preview'} */ ('preview'), outDir: join(tmp, 'dist'), releaseRegistry: regPath };
  if (fixture) {
    const gamesDir = join(tmp, 'games');
    cpSync(join(ROOT, 'games'), gamesDir, { recursive: true });
    for (const d of [...fixture.stubs, ...fixture.preview.filter((x) => x !== '2026-10-17')]) {
      mkdirSync(join(gamesDir, d), { recursive: true });
      writeFileSync(join(gamesDir, d, 'edition.json'), JSON.stringify({ date: d, title: `Fixture ${d}`, description: 'fixture only' }));
      writeFileSync(join(gamesDir, d, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8">{{csp}}<title>{{title}}</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/assets/site.css"></head><body>{{banner}}{{nav}}<main id="main"><h1>Fixture edition {{title}}</h1>{{gamenav}}</main></body></html>');
    }
    const previewPath = join(tmp, 'preview.json');
    writeFileSync(previewPath, JSON.stringify({ schema: 1, editions: fixture.preview.map((date) => ({ date })) }));
    Object.assign(opts, { gamesDir, previewRegistry: previewPath });
  }
  await build(opts);
  const host = await serve(join(tmp, 'dist'));
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  return {
    host,
    browser,
    async close() { await browser.close(); await host.close(); rmSync(tmp, { recursive: true, force: true }); },
  };
}

/** New page on a fake clock; collects console errors and failed requests. */
export async function openGame(env, { viewport = { width: 390, height: 800 }, route = GAME, reducedMotion = 'no-preference', touch = false, init } = {}) {
  const context = await env.browser.newContext({ viewport, reducedMotion: /** @type {any} */ (reducedMotion), hasTouch: touch });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
  if (init) await page.addInitScript(init);
  await page.clock.install();
  await page.goto(env.host.origin + route);
  return { page, context, problems };
}

export const state = (page) => page.getAttribute('#app', 'data-state');
export const text = (page, sel) => page.textContent(sel).then((s) => (s || '').trim());
export const hp = async (page) => [Number(await text(page, '#hp-player')), Number(await text(page, '#hp-enemy'))].map((n) => n);

export async function startFight(page) {
  await page.click('#btn-play');
  // Step by frames so simulation time 0 is within one frame of the first assertion.
  for (let i = 0; i < 400 && (await state(page)) !== 'playing'; i++) await page.clock.runFor(16);
  if ((await state(page)) !== 'playing') throw new Error('fight did not start');
}

/** Hold K, and tap Space as soon as the counter window opens, until a result appears. */
export async function playToWin(page) {
  await page.keyboard.down('k');
  for (let i = 0; i < 1200 && (await state(page)) === 'playing'; i++) {
    await page.clock.runFor(16);
    if (await page.isVisible('#counter-badge')) {
      await page.keyboard.press('Space');
      await page.clock.runFor(150);
    }
  }
  await page.keyboard.up('k');
}

export const inside = (page, sel) => page.evaluate((s) => !!document.activeElement && !!document.querySelector(s)?.contains(document.activeElement), sel);

/** Poll from Node with real time (page timers may be on a fake clock). */
export async function until(fn, timeout = 8000, step = 25) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, step)); }
  return false;
}

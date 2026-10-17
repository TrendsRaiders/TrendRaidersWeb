import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../../scripts/lib/build-lib.mjs';
import { serve } from '../helpers/static-server.mjs';

export const GAME = '/games/2026-10-17/';
export const CHROMIUM = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

/** Builds the preview site (and an optional fixture-released variant) and starts a browser. */
export async function setup({ released = false } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'tr-browser-'));
  const regPath = join(tmp, 'registry.json');
  const editions = released
    ? [{ date: '2026-10-17', verified: true, sha: 'abc1234', origin: 'https://games.example.test', verification: 'fixture-only (browser test)' }]
    : [];
  (await import('node:fs')).writeFileSync(regPath, JSON.stringify({ schema: 1, editions }));
  await build({ mode: 'preview', outDir: join(tmp, 'dist'), releaseRegistry: regPath });
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

// Screenshot + measurement evidence for Fly the Simulation (Intro, active incl. recompile cue, Paused, lost and won results)
// at 1280x800, 320x568, 390x844, 568x320 and 844x390. Output goes OUTSIDE the repository:
//   node scripts/capture-evidence.mjs --out /home/<user>/fly-work/<run>            (builds + serves the preview locally)
//   node scripts/capture-evidence.mjs --out <dir> --url https://<draft origin>      (captures a hosted draft)
// Deterministic: a Playwright fake clock and the scripted route follower (scripts/lib/fly-bot.mjs). These are emulated
// viewports/touch, not physical-device or human evidence.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { build, ROOT } from './lib/build-lib.mjs';
import { serve } from '../test/helpers/static-server.mjs';
import { playFake, readSim } from './lib/fly-bot.mjs';
import { measureLayout, rectGap, VIEWPORTS, geometryChecks } from './lib/fly-measure.mjs';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const OUT = arg('out') ? resolve(/** @type {string} */ (arg('out'))) : '';
if (!OUT) { console.error('usage: --out <dir outside the repository> [--url <origin>]'); process.exit(2); }
if (OUT.startsWith(ROOT)) { console.error('refusing to write evidence inside the repository'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

let tmp = ''; let host;
if (arg('url')) host = { origin: new URL(/** @type {string} */ (arg('url'))).origin, close: async () => {} };
else {
  tmp = mkdtempSync(join(tmpdir(), 'fly-evidence-'));
  await build({ mode: 'preview', outDir: join(tmp, 'dist') });
  host = await serve(join(tmp, 'dist'));
}
const ROUTE = '/games/2026-10-18/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
const report = { origin: host.origin, note: 'Emulated viewports, scripted route follower and fake clock; not physical-device or human evidence.', viewports: {} };

async function fresh(vp, reducedMotion = 'no-preference') {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, reducedMotion: /** @type {any} */ (reducedMotion) });
  // keep the capture offline for X: the provider is blocked so no network/identifiers are involved
  await context.route('https://platform.twitter.com/**', (r) => r.abort('blockedbyclient'));
  const page = await context.newPage();
  await page.clock.install();
  await page.goto(`${host.origin}${ROUTE}`);
  return { context, page };
}
const shot = (page, vp, name) => page.screenshot({ path: join(OUT, `${vp.name}-${name}.png`) });

try {
  for (const vp of VIEWPORTS) {
    const rec = {};
    // 1. Intro
    let { context, page } = await fresh(vp);
    rec.intro = await measureLayout(page);
    await shot(page, vp, '1-intro');
    // 2. active, scripted route to just after the first recompile preview starts (t ~ 4.2 s: NEXT GAP + OLD + dashed gap)
    await page.click('#btn-start');
    await page.clock.runFor(50);
    await playFake(page, { until: ['won', 'lost'], hook: async (sim) => { if (sim.tUs >= 4_200_000) throw new Error('stop'); } }).catch(() => {});
    await page.keyboard.up('ArrowUp').catch(() => {}); await page.keyboard.up('ArrowDown').catch(() => {});
    rec.active = await measureLayout(page);
    rec.activeSim = await readSim(page);
    await shot(page, vp, '2-active-recompile-preview');
    // 3. after the commit (t ~ 5.0 s): WORLD UPDATED
    await playFake(page, { hook: async (sim) => { if (sim.tUs >= 5_000_000) throw new Error('stop'); } }).catch(() => {});
    await shot(page, vp, '3-active-world-updated');
    // 4. Paused
    await page.keyboard.press('Escape');
    rec.paused = await measureLayout(page);
    await shot(page, vp, '4-paused');
    await context.close();

    // 5. lost: no input at all, first failure at seam 2
    ({ context, page } = await fresh(vp));
    await page.click('#btn-start');
    for (let i = 0; i < 600 && (await readSim(page)).state === 'running'; i++) await page.clock.runFor(16);
    rec.lost = await measureLayout(page); rec.lostSim = await readSim(page);
    await shot(page, vp, '5-result-lost');
    await context.close();

    // 6. won, reveal finished (static final frame) and a mid-reveal frame
    ({ context, page } = await fresh(vp));
    await page.click('#btn-start');
    await page.clock.runFor(50);
    rec.wonSim = await playFake(page);
    await page.clock.runFor(700);
    await shot(page, vp, '6-result-won-reveal-midway');
    await page.clock.runFor(1500);
    rec.won = await measureLayout(page);
    await shot(page, vp, '7-result-won-final');
    await context.close();

    // 7. reduced motion win: final frame immediately
    ({ context, page } = await fresh(vp, 'reduce'));
    await page.click('#btn-start');
    await page.clock.runFor(50);
    await playFake(page);
    await shot(page, vp, '8-result-won-reduced-motion');
    await context.close();

    // derived numbers the spec asks for
    const m = rec.active;
    rec.derived = {
      arenaHeight: m.arena.h, arenaWidth: m.arena.w, arenaShareOfViewportHeight: Number((m.arena.h / m.vh).toFixed(3)),
      steerToUtilGap: Math.min(...[m.up, m.down].flatMap((s) => [m.pause, m.restart].map((u) => rectGap(s, u)))),
      headerHeight: m.header.h, spriteScale: m.canvas.scale, horizontalOverflow: m.scrollW > m.vw,
    };
    rec.geometryChecks = [...geometryChecks(vp, rec.intro, 'intro'), ...geometryChecks(vp, rec.active, 'active')].map(([name, pass, detail]) => ({ name, pass, ...(pass ? {} : { detail }) }));
    report.viewports[vp.name] = rec;
  }
} finally {
  await browser.close(); await host.close(); if (tmp) rmSync(tmp, { recursive: true, force: true });
}
writeFileSync(join(OUT, 'measurements.json'), `${JSON.stringify(report, null, 2)}\n`);
const failed = Object.values(report.viewports).flatMap((v) => v.geometryChecks.filter((c) => !c.pass));
console.log(`Wrote ${Object.keys(report.viewports).length * 8} screenshots and measurements.json to ${OUT}; geometry checks failing: ${failed.length}`);
for (const f of failed) console.log(`FAIL ${f.name}: ${f.detail}`);
process.exit(failed.length ? 1 : 0);

// Real-provider check for the AUTOMATIC X embed (r5/r6: no Load gate; one attempt starts at page mount). Needs internet access to platform.twitter.com and uses the
// production CSP served by the same static host helper as the tests. NOT part of `npm test` (network-dependent).
// It never claims success: it reports what the provider actually did in this run.
//   node scripts/real-embed-check.mjs                 -> builds the preview locally, serves it with the production headers
//   node scripts/real-embed-check.mjs --url <origin>  -> checks an already hosted preview/draft instead (no local build)
// JSON report on stdout; exit 1 on unexpected CSP violations or layout failures.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { build } from './lib/build-lib.mjs';
import { serve } from '../test/helpers/static-server.mjs';

const TWEET = '2111278238253342868';
const argUrl = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : process.env.EMBED_URL;
let tmp = '';
let host;
if (argUrl) {
  host = { origin: new URL(argUrl).origin, close: async () => {} };
} else {
  tmp = mkdtempSync(join(tmpdir(), 'tr-real-embed-'));
  const reg = join(tmp, 'registry.json');
  writeFileSync(reg, JSON.stringify({ schema: 1, editions: [] }));
  await build({ mode: 'preview', outDir: join(tmp, 'dist'), releaseRegistry: reg });
  host = await serve(join(tmp, 'dist'));
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
/** @type {{ tweetId: string, checks: { name: string, pass: boolean, detail?: any }[], [k: string]: any }} */
const report = { tweetId: TWEET, target: argUrl ? 'hosted' : 'local preview build', origin: '', checks: [] };
const check = (name, pass, detail) => report.checks.push({ name, pass: !!pass, ...(pass ? {} : { detail }) });
try {
  const context = await browser.newContext({ viewport: { width: 320, height: 568 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    /** @type {any} */ (window).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => /** @type {any} */ (window).__csp.push({ directive: e.effectiveDirective, blocked: e.blockedURI, source: (e.sourceFile || '').slice(0, 80) }));
  });
  const reqs = [];
  /** @type {string[]} */ const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(`${(e.stack || '').includes('platform.twitter.com') ? 'provider-script' : 'OWN'}: ${e.message.slice(0, 100)}`));
  const t0 = Date.now();
  page.on('request', (r) => reqs.push({ ms: Date.now() - t0, url: r.url(), type: r.resourceType(), top: r.frame() === page.mainFrame() }));
  const nav = await page.goto(`${host.origin}/games/2026-10-17/`);
  report.origin = host.origin;
  report.cspHeader = nav?.headers()['content-security-policy'] ?? null;
  const origin = host.origin;
  const rectsOf = () => page.evaluate(() => Object.fromEntries(['#game', '#hud', '#arena', '#btn-start'].map((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return [s, r ? [r.x, r.y, r.width, r.height].map((v) => Math.round(v)) : null]; })));
  // r5: NO click, scroll or key press anywhere in this check. One attempt must start by itself.
  report.noteInteraction = 'none: the page is only loaded, then observed';
  check('no Load control exists (automatic embed)', (await page.locator('#btn-load-embed').count()) === 0 && (await page.getByText('Load source post').count()) === 0, 'Load control found');
  check('automatic-connection notice is visible', ((await page.textContent('.privacy')) || '').trim() === 'This embedded post connects to X automatically. X may use cookies or other identifiers and download media.', await page.textContent('.privacy'));
  const stateEarly = await page.getAttribute('#embed-area', 'data-embed-state');
  check('summary and ordinary source link are visible while loading/failed (summary is replaced only by a displayed post)', (await page.isVisible('#link-open-x')) && (stateEarly === 'loaded' || ((await page.textContent('#embed-summary')) || '').startsWith('Source summary:')), stateEarly);
  const rectsMount = await rectsOf();
  const focusAtMount = await page.evaluate(() => document.activeElement?.id === 'btn-start');
  const settled = await page.waitForFunction(() => ['loaded', 'failed'].includes(document.getElementById('embed-area')?.dataset.embedState ?? ''), null, { timeout: 20000 }).then(() => true, () => false);
  const stateNow = await page.getAttribute('#embed-area', 'data-embed-state');
  report.msToSettle = Date.now() - t0;
  await page.waitForTimeout(3000); // let provider sub-requests (media preload etc.) finish
  report.outcome = settled ? stateNow : 'neither (still loading after 20 s)';
  const hosts = (list) => [...new Set(list.map((r) => new URL(r.url).host))].sort();
  const ext = reqs.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('data:'));
  report.firstExternalRequestMs = ext.length ? ext[0].ms : null;
  report.topFrameRequestHosts = hosts(ext.filter((r) => r.top));
  report.topFrameRequests = ext.filter((r) => r.top).map((r) => `${r.ms}ms ${r.type} ${r.url.slice(0, 90)}`);
  report.providerFrameRequestHosts = hosts(ext.filter((r) => !r.top));
  report.providerFrameRequestCountByType = ext.filter((r) => !r.top).reduce((a, r) => ({ ...a, [r.type]: (a[r.type] || 0) + 1 }), {});
  report.mediaRequests = ext.filter((r) => /video\.twimg\.com|\.m3u8|\.m4s|\.mp4/.test(r.url)).map((r) => `${r.ms}ms ${r.type} ${r.url.slice(0, 90)}`).slice(0, 12);
  const iframe = await page.evaluate(() => { const f = /** @type {HTMLIFrameElement|null} */ (document.querySelector('#embed-mount iframe')); return f ? { src: f.src.slice(0, 160), w: f.getBoundingClientRect().width } : null; });
  report.iframe = iframe;
  report.violations = await page.evaluate(() => /** @type {any} */ (window).__csp);
  const expected = (v) => v.directive === 'style-src-elem' && v.blocked === 'inline' && /platform\.twitter\.com\/widgets\.js/.test(v.source);
  report.pageErrors = pageErrors;
  check('no page error came from our own code (errors thrown inside X\'s scripts are recorded, not ours)', pageErrors.every((e) => e.startsWith('provider-script')), pageErrors);
  check('a provider request started without any user interaction', report.firstExternalRequestMs !== null, 'no external request');
  check('exactly one widgets.js request', ext.filter((r) => r.top && /\/widgets\.js/.test(r.url)).length === 1, ext.filter((r) => /widgets\.js/.test(r.url)).length);
  check('only the widgets.js inline CSP self-test <style> is blocked; no other CSP violation', report.violations.every(expected), report.violations.filter((v) => !expected(v)));
  check('top-document requests go only to platform.twitter.com', report.topFrameRequestHosts.every((/** @type {string} */ h) => h === 'platform.twitter.com'), report.topFrameRequestHosts);
  const geo = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, activeIsBody: document.activeElement?.id === 'btn-start', scrollY: scrollY }));
  check('no horizontal overflow at 320px', geo.sw <= geo.iw, geo);
  check('provider render/failure left focus on Start round and did not scroll the page', focusAtMount && geo.activeIsBody && geo.scrollY === 0, { focusAtMount, geo });
  check('play panel geometry unchanged by provider load (arena, HUD, Play)', JSON.stringify(await rectsOf()) === JSON.stringify(rectsMount), { before: rectsMount, after: await rectsOf() });
  if (stateNow === 'loaded') {
    check('official iframe is from platform.twitter.com', !!iframe && iframe.src.startsWith('https://platform.twitter.com/'), iframe);
    check('iframe fits the 320px card', !!iframe && iframe.w <= 320, iframe);
    await page.evaluate(() => document.getElementById('source-post')?.scrollIntoView());
    await page.screenshot({ path: process.env.EMBED_SHOT || join(tmpdir(), 'real-embed-320.png') });
  } else {
    check('fallback shown with explicit retry (provider did not render)', await page.isVisible('#btn-retry-embed'), stateNow);
  }
  await context.close();
} finally {
  await browser.close(); await host.close(); if (tmp) rmSync(tmp, { recursive: true, force: true });
}
report.ok = report.checks.every((c) => c.pass);
report.note = 'Result of one run against the live provider at this moment; the provider may render, refuse or change at any time.';
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

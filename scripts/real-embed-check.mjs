// Real-provider check for the AUTOMATIC X embed (one attempt starts at page mount; no Load gate), for either edition (--edition). Needs internet access to platform.twitter.com and uses the
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

// Edition selection: --edition <UTC date> (default 2026-10-17, the original behavior). Each edition lists its own post,
// disclosure/fallback copy and geometry selectors; the checks themselves are shared.
const EDITIONS = {
  '2026-10-17': {
    tweet: '2111278238253342868', title: '30-Second KO',
    privacy: 'This embedded post connects to X automatically. X may use cookies or other identifiers and download media.',
    summaryStart: 'Source summary:', geometry: ['#game', '#hud', '#arena', '#btn-start'], focusId: 'btn-start',
    failedNeeds: '#btn-retry-embed', failedText: null, timeoutMs: 10000,
  },
  '2026-10-18': {
    tweet: '2111589148146749616', title: 'Fly the Simulation',
    privacy: 'Official X post — loading may contact X and its media services and share network/device identifiers.',
    summaryStart: 'Summary:', geometry: ['#game', '#strip', '#arena', '#btn-start', '#btn-up', '#btn-down', '#btn-pause'], focusId: 'BODY',
    failedNeeds: null, failedText: 'Embed unavailable — read the source on X', timeoutMs: 8000,
  },
};
const argEdition = process.argv.includes('--edition') ? process.argv[process.argv.indexOf('--edition') + 1] : '2026-10-17';
const ED = /** @type {any} */ (EDITIONS)[argEdition];
if (!ED) { console.error(`unknown --edition ${argEdition}; known: ${Object.keys(EDITIONS).join(', ')}`); process.exit(2); }
const TWEET = ED.tweet;
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
const report = { edition: argEdition, tweetId: TWEET, target: argUrl ? 'hosted' : 'local preview build', origin: '', checks: [] };
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
  const nav = await page.goto(`${host.origin}/games/${argEdition}/`);
  report.origin = host.origin;
  report.cspHeader = nav?.headers()['content-security-policy'] ?? null;
  const origin = host.origin;
  const rectsOf = () => page.evaluate((sels) => Object.fromEntries(sels.map((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return [s, r ? [r.x, r.y, r.width, r.height].map((v) => Math.round(v)) : null]; })), ED.geometry);
  // r5: NO click, scroll or key press anywhere in this check. One attempt must start by itself.
  report.noteInteraction = 'none: the page is only loaded, then observed';
  check('no Load control exists (automatic embed)', (await page.locator('#btn-load-embed').count()) === 0 && (await page.getByText('Load source post').count()) === 0, 'Load control found');
  check('automatic-connection notice is visible', ((await page.textContent('.privacy')) || '').trim() === ED.privacy, await page.textContent('.privacy'));
  const stateEarly = await page.getAttribute('#embed-area', 'data-embed-state');
  check('summary and ordinary source link are visible while loading/failed (summary is replaced only by a displayed post)', (await page.isVisible('#link-open-x')) && (stateEarly === 'loaded' || ((await page.textContent('#embed-summary')) || '').startsWith(ED.summaryStart)), stateEarly);
  const rectsMount = await rectsOf();
  const focusOf = () => page.evaluate(() => document.activeElement === document.body ? 'BODY' : document.activeElement?.id);
  const focusAtMount = (await focusOf()) === ED.focusId;
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
  const geo = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, scrollY: scrollY }));
  const activeIsSame = (await focusOf()) === ED.focusId;
  check('no horizontal overflow at 320px', geo.sw <= geo.iw, geo);
  check(`provider render/failure left focus on ${ED.focusId} (unchanged from mount) and did not scroll the page`, focusAtMount && activeIsSame && geo.scrollY === 0, { focusAtMount, activeIsSame, geo });
  check('play panel geometry unchanged by provider load (arena, HUD/strip, controls)', JSON.stringify(await rectsOf()) === JSON.stringify(rectsMount), { before: rectsMount, after: await rectsOf() });
  if (stateNow === 'loaded') {
    check('official iframe is from platform.twitter.com', !!iframe && iframe.src.startsWith('https://platform.twitter.com/'), iframe);
    check('iframe fits the 320px card', !!iframe && iframe.w <= 320, iframe);
    await page.evaluate(() => document.getElementById('source-post')?.scrollIntoView());
    await page.screenshot({ path: process.env.EMBED_SHOT || join(tmpdir(), 'real-embed-320.png') });
  } else {
    if (ED.failedNeeds) check('fallback shown with explicit retry (provider did not render)', await page.isVisible(ED.failedNeeds), stateNow);
    if (ED.failedText) {
      check('stable fallback text shown (provider did not render); no retry control', ((await page.textContent('#embed-status')) || '').trim() === ED.failedText && (await page.locator('#btn-retry-embed, #btn-load-embed').count()) === 0, await page.textContent('#embed-status'));
    }
  }
  await context.close();
} finally {
  await browser.close(); await host.close(); if (tmp) rmSync(tmp, { recursive: true, force: true });
}
report.ok = report.checks.every((c) => c.pass);
report.note = 'Result of one run against the live provider at this moment; the provider may render, refuse or change at any time.';
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

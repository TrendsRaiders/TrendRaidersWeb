// Real-provider check for the click-to-load X embed. Needs internet access to platform.twitter.com and uses the
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
  const context = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    /** @type {any} */ (window).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => /** @type {any} */ (window).__csp.push({ directive: e.effectiveDirective, blocked: e.blockedURI, source: (e.sourceFile || '').slice(0, 80) }));
  });
  const reqs = [];
  page.on('request', (r) => reqs.push({ t: Date.now(), url: r.url(), type: r.resourceType(), top: r.frame() === page.mainFrame() }));
  const nav = await page.goto(`${host.origin}/games/2026-10-17/`);
  report.origin = host.origin;
  report.cspHeader = nav?.headers()['content-security-policy'] ?? null;
  await page.waitForTimeout(1500);
  const origin = host.origin;
  const before = reqs.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('data:'));
  check('no request leaves the site before Load', before.length === 0, before.map((r) => r.url));
  await page.focus('#btn-load-embed');
  const clickAt = Date.now();
  await page.keyboard.press('Enter');
  const settled = await page.waitForFunction(() => ['loaded', 'failed'].includes(document.getElementById('embed-area')?.dataset.embedState ?? ''), null, { timeout: 20000 }).then(() => true, () => false);
  const stateNow = await page.getAttribute('#embed-area', 'data-embed-state');
  await page.waitForTimeout(2500); // let provider sub-requests finish
  report.outcome = settled ? stateNow : 'neither (still loading after 20 s)';
  report.msToSettle = Date.now() - clickAt;
  const after = reqs.filter((r) => r.t >= clickAt);
  const hosts = (list) => [...new Set(list.map((r) => new URL(r.url).host))].sort();
  report.topFrameRequestHosts = hosts(after.filter((r) => r.top && !r.url.startsWith(origin)));
  report.topFrameRequests = after.filter((r) => r.top && !r.url.startsWith(origin)).map((r) => `${r.type} ${r.url.slice(0, 90)}`);
  report.allRequestHostsIncludingProviderFrames = hosts(after.filter((r) => !r.url.startsWith(origin)));
  const iframe = await page.evaluate(() => { const f = /** @type {HTMLIFrameElement|null} */ (document.querySelector('#embed-mount iframe')); return f ? { src: f.src.slice(0, 160), w: f.getBoundingClientRect().width } : null; });
  report.iframe = iframe;
  report.violations = await page.evaluate(() => /** @type {any} */ (window).__csp);
  const expected = (v) => v.directive === 'style-src-elem' && v.blocked === 'inline' && /platform\.twitter\.com\/widgets\.js/.test(v.source);
  check('only the widgets.js inline CSP self-test <style> is blocked; no other CSP violation', report.violations.every(expected), report.violations.filter((v) => !expected(v)));
  check('top-document requests go only to platform.twitter.com', report.topFrameRequestHosts.every((/** @type {string} */ h) => h === 'platform.twitter.com'), report.topFrameRequestHosts);
  const geo = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, active: document.activeElement?.id }));
  check('no horizontal overflow at 320px', geo.sw <= geo.iw, geo);
  check('focus stays on the Load control', geo.active === 'btn-load-embed', geo);
  if (stateNow === 'loaded') {
    check('official iframe is from platform.twitter.com', !!iframe && iframe.src.startsWith('https://platform.twitter.com/'), iframe);
    check('iframe fits the 320px card', !!iframe && iframe.w <= 320, iframe);
    await page.evaluate(() => document.getElementById('source-post')?.scrollIntoView());
    await page.screenshot({ path: process.env.EMBED_SHOT || '/tmp/real-embed-320.png' });
  } else {
    check('fallback shown with explicit retry (provider did not render)', ((await page.textContent('#btn-load-embed')) || '') === 'Try loading again', stateNow);
  }
  await context.close();
} finally {
  await browser.close(); await host.close(); if (tmp) rmSync(tmp, { recursive: true, force: true });
}
report.ok = report.checks.every((c) => c.pass);
report.note = 'Result of one run against the live provider at this moment; the provider may render, refuse or change at any time.';
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

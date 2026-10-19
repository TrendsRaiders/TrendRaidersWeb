// Hosted-preview verifier for the Fly the Simulation edition (2026-10-18), r1. Written for this edition's manifest, assets,
// routes, copy and geometry; it does NOT reuse scripts/verify-hosted.mjs (which hardcodes the boxing edition). Run it
// against a draft of the SAME clean commit:
//   node scripts/verify-hosted-fly.mjs --url <draft origin> --sha <40-hex commit> --base <40-hex boxing baseline, e.g.
//        b7321bab07dc8fd21df0207d747dbdfa4d8e5acf> [--mode preview|public] --out <evidence.json outside the repo>
//        [--shots <dir outside the repo>] [--skip-real-win]
// --base is REQUIRED (no built-in default: boxing must be byte-identical to it). --mode defaults to preview; build the SAME
// commit in the matching mode first (`npm run build:preview` / `npm run build`). In public mode both editions are pending
// candidates (staged, not approved or live), Fly is the root and the boxing page is Fly's Previous destination.
// It compares hosted bytes with local dist/, checks effective headers incl. the _headers file, route/scaffold/boxing
// preservation, real-clock scripted gameplay and measured geometry at the five named viewports. Scripted automation in
// emulated viewports: NOT human, physical-device or screen-reader evidence, and it never asserts that the X post rendered
// (use `npm run check:embed-real -- --edition 2026-10-18 --url <origin>` for the provider).
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, stat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT, build, CSP } from './lib/build-lib.mjs';
import { createBot, playReal, readSim } from './lib/fly-bot.mjs';
import { measureLayout, geometryChecks, VIEWPORTS } from './lib/fly-measure.mjs';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const flag = (n) => process.argv.includes(`--${n}`);
const DRAFT = (arg('url') || '').replace(/\/$/, '');
const SHA = arg('sha') || '';
const BASE = arg('base') || ''; // the boxing baseline SHA is REQUIRED (no default): boxing must be byte-identical to it
const MODE = arg('mode') || 'preview'; // 'preview' (default) or 'public' (two pending release candidates)
const PUB = MODE === 'public';
const ORIGIN = 'https://empty-site-7f987b.netlify.app';
const FLY_BASE = 'ef20ccb392005e0aef4325d4ede356cf79d571d9';
const SHOTS = arg('shots') ? resolve(/** @type {string} */ (arg('shots'))) : '';
if (!/^(https:\/\/|http:\/\/127\.0\.0\.1)/.test(DRAFT) || !/^[0-9a-f]{40}$/.test(SHA) || !/^[0-9a-f]{40}$/.test(BASE) || !['preview', 'public'].includes(MODE)) { console.error('usage: --url https://<draft origin> --sha <40-hex commit> --base <40-hex boxing baseline commit, e.g. b7321bab07dc8fd21df0207d747dbdfa4d8e5acf> [--mode preview|public] [--out file] [--shots dir] [--skip-real-win]'); process.exit(2); }
for (const p of [arg('out'), SHOTS]) if (p && resolve(p).startsWith(ROOT)) { console.error('refusing to write evidence inside the repository'); process.exit(2); }

const ED = '2026-10-18'; const OLD = '2026-10-17';
const FLY = `/games/${ED}/`; const BOX = `/games/${OLD}/`; const UNKNOWN = '/games/2026-10-19/';
const checks = []; const notes = []; const evidence = {};
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, ...(pass ? {} : { detail: String(detail).slice(0, 600) }) });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const get = async (p) => { const r = await fetch(`${DRAFT}${p}`, { cache: 'no-store', redirect: 'manual' }); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), headers: r.headers }; };
const local = (p) => readFile(join(ROOT, 'dist', p));
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'] });
const walk = async (d, base = d) => (await Promise.all((await readdir(d)).sort().map(async (n) => ((await stat(join(d, n))).isDirectory() ? walk(join(d, n), base) : [relative(base, join(d, n)).split(sep).join('/')])))).flat();

// ---------------------------------------------------------------------------------------------------------------- HTTP
async function http() {
  const lm = await local('build-manifest.json'); const man = JSON.parse(lm.toString());
  check(`local dist is the expected clean ${MODE} artifact for this SHA`, man.mode === MODE && man.source?.commit === SHA && man.source?.dirty === false && man.source?.exactShaArtifact === true, JSON.stringify({ mode: man.mode, source: man.source }));
  const hm = await get('/build-manifest.json');
  check('hosted manifest 200 and byte-identical to local', hm.status === 200 && hm.buf.equals(lm), `status ${hm.status}`);
  const hosted = JSON.parse(hm.buf.toString());
  check(`hosted manifest: full SHA, clean, exactShaArtifact, ${MODE} mode, same tree hash`, hosted.source?.commit === SHA && hosted.source?.dirty === false && hosted.source?.exactShaArtifact === true && hosted.mode === MODE && hosted.treeSha256 === man.treeSha256, JSON.stringify(hosted.source));
  if (PUB) {
    const pend = (hosted.releasedEditions || []);
    check('manifest (public): root is the latest edition; no preview edition; BOTH editions listed as PENDING candidates with their source SHAs, origin and no timestamps (this artifact is staged, not a verified release)', hosted.root === 'latest-released' && (hosted.previewEditions || []).length === 0 && JSON.stringify(pend) === JSON.stringify([{ date: OLD, status: 'candidate-pending-approval', sourceSha: BASE, origin: ORIGIN }, { date: ED, status: 'candidate-pending-approval', sourceSha: FLY_BASE, origin: ORIGIN }]) && !/released_?at|publishedAt/i.test(JSON.stringify(hosted)), JSON.stringify({ root: hosted.root, released: pend, previews: hosted.previewEditions }));
  } else {
    check('manifest: root is the preview candidate, no released edition (preview build ignores pending candidates), both previews listed', hosted.root === 'preview-candidate' && (hosted.releasedEditions || []).length === 0 && JSON.stringify(hosted.previewEditions) === JSON.stringify([OLD, ED]), JSON.stringify({ root: hosted.root, released: hosted.releasedEditions, previews: hosted.previewEditions }));
  }
  // exact manifest: every shipped file is listed (no silent omission) and every listed file exists locally with the same hash
  const localFiles = (await walk(join(ROOT, 'dist'))).filter((f) => f !== 'build-manifest.json');
  const listed = hosted.files.map((f) => f.path);
  check(`manifest lists exactly the ${localFiles.length} files in local dist (besides itself)`, JSON.stringify([...listed].sort()) === JSON.stringify([...localFiles].sort()), JSON.stringify({ missing: localFiles.filter((f) => !listed.includes(f)), extra: listed.filter((f) => !localFiles.includes(f)) }));
  const flyFiles = listed.filter((f) => f.startsWith(`games/${ED}/`));
  const wantFly = ['index.html', 'game.css', 'js/main.js', 'js/engine.js', 'js/art.js', 'js/render.js', 'js/embed.js', 'js/share.js'].map((f) => `games/${ED}/${f}`);
  check('manifest has exactly the eight Fly edition files (edition.json is build input only)', JSON.stringify(flyFiles.sort()) === JSON.stringify(wantFly.sort()), flyFiles.join(','));
  const bad = [];
  for (const f of hosted.files.filter((x) => x.path !== '_headers')) { const r = await get(`/${f.path}`); if (r.status !== 200 || sha(r.buf) !== f.sha256) bad.push(`${f.path} ${r.status}`); }
  check(`all ${hosted.files.length - 1} non-config manifest files: HTTP 200 and SHA-256 equal to the manifest`, bad.length === 0, bad.join('; '));
  // _headers is consumed by Netlify: hash in the manifest equals the local file; the effective values are read from real responses
  const lh = await local('_headers');
  check('manifest lists _headers with the local file hash', hosted.files.find((x) => x.path === '_headers')?.sha256 === sha(lh));
  const hr = await get('/_headers');
  notes.push(`GET /_headers -> HTTP ${hr.status} (${hr.headers.get('content-type')}): Netlify consumes this config file; ${hr.status === 200 && !/html/.test(hr.headers.get('content-type') || '') ? 'it is also served' : 'it is not served as an asset (its config is not a served asset)'}. Its effective values are asserted from response headers below, not from this GET.`);
  const want = {};
  for (const line of lh.toString().split('\n').slice(1)) { const i = line.indexOf(':'); if (i > 0) want[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
  check('_headers CSP equals the unchanged site CSP (no expansion) plus frame-ancestors', want['content-security-policy'] === `${CSP}; frame-ancestors 'none'`, want['content-security-policy']);
  evidence.expectedHeaders = want; evidence.effectiveHeaders = {};
  const targets = { root: '/', fly: FLY, 'fly main.js': `${FLY}js/main.js`, 'fly engine.js': `${FLY}js/engine.js`, 'fly render.js': `${FLY}js/render.js`, 'fly embed.js': `${FLY}js/embed.js`, 'fly game.css': `${FLY}game.css`, boxing: BOX, 'boxing main.js': `${BOX}js/main.js`, 'site.css': '/assets/site.css', 'scaffold styles.css': '/styles.css', 'unknown date (404)': UNKNOWN };
  for (const [label, p] of Object.entries(targets)) {
    const r = await get(p); evidence.effectiveHeaders[label] = { status: r.status };
    for (const [k, v] of Object.entries(want)) { const got = r.headers.get(k); evidence.effectiveHeaders[label][k] = got; check(`effective ${k} on ${label} equals local _headers`, got === v, `got ${got}`); }
  }
  // routes, scaffold and boxing preservation
  const root = await get('/'); const fly = await get(FLY); const box = await get(BOX);
  check('root and direct route: 200, equal to local HTML and to each other (preview root = latest candidate)', root.status === 200 && fly.status === 200 && root.buf.equals(await local('index.html')) && fly.buf.equals(await local(`games/${ED}/index.html`)) && root.buf.equals(fly.buf));
  check('boxing preview route 200 and equal to local dist', box.status === 200 && box.buf.equals(await local(`games/${OLD}/index.html`)));
  const baseFile = (p) => { try { return git('show', `${BASE}:${p}`); } catch { return null; } };
  const pres = [];
  for (const f of ['edition.json', 'game.css', 'js/art.js', 'js/embed.js', 'js/engine.js', 'js/main.js', 'js/modal.js', 'js/share.js']) {
    const b = baseFile(`games/${OLD}/${f}`);
    if (!b) { pres.push(`${f}: not in base ${BASE}`); continue; }
    if (f === 'edition.json') continue; // build input, not shipped
    const r = await get(`${BOX}${f}`);
    if (r.status !== 200 || !r.buf.equals(b)) pres.push(`${f} differs from base`);
  }
  check(`boxing assets served are byte-identical to boxing r6 (${BASE.slice(0, 7)}); boxing keeps its 10 s embed timeout`, pres.length === 0 && /LOAD_TIMEOUT_MS = 10000/.test((await get(`${BOX}js/embed.js`)).buf.toString()), pres.join('; '));
  const sc = await get('/styles.css'); const baseCss = baseFile('public/styles.css');
  check('scaffold stylesheet served equals the base scaffold (the scaffold root itself is checked by the local public build below)', !!baseCss && sc.status === 200 && sc.buf.equals(baseCss));
  const nf = await get(UNKNOWN);
  check('unknown date is an honest HTTP 404 page equal to local 404.html and not an app page', nf.status === 404 && nf.buf.equals(await local('404.html')) && /Page not found/.test(nf.buf.toString()) && !/id="game"/.test(nf.buf.toString()));
  check('trailing-slash redirect on the direct route is a redirect to the stable route', [301, 308].includes((await get(`/games/${ED}`)).status));
  // HTML contract
  const html = fly.buf.toString();
  const bare = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
  const has = (s) => html.includes(s);
  if (PUB) {
    check('HTML (public): indexable, no preview framing, current date link, share URL is the dated production route', !has('name="robots"') && has('<title>Fly the Simulation</title>') && !/preview-badge|Preview \(not released\)|Preview — not released/.test(html) && has('aria-current="page">18 Oct 2026<span class="sr-only"> UTC edition</span>') && has(`"shareUrl":"${ORIGIN}${FLY}"`) && has('"mode":"public"'));
  } else {
    check('HTML: preview framing, noindex, title, badge, current date link, no share URL', has('<meta name="robots" content="noindex">') && has('<title>Fly the Simulation — Preview (not released)</title>') && has('<span class="preview-badge" role="note">Preview — not released</span>') && has('aria-current="page">18 Oct 2026<span class="pv"> — Preview (not released)</span>') && has('"shareUrl":null'));
  }
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  check('HTML: one compact nav; no About/tutorial/title in the header; About is a footer link after the News', (html.match(/<nav /g) || []).length === 1 && !/About|Reach the banana|<h1/.test(header) && has('<footer class="site-footer"><a id="link-about" class="footer-link" href="#about">About</a></footer>') && html.indexOf('id="link-about"') > html.indexOf('id="news"'));
  if (PUB) {
    check('HTML (public): Previous is a real link to the boxing route with its date, Next is a disabled None later (released neighbors only)', has(`<a class="gn-link" href="${BOX}" data-gn="prev">`) && has('17 Oct 2026<span class="sr-only"> UTC</span>') && has('None later<span class="sr-only"> — No later released game</span>') && /class="gn-link" disabled data-gn="next"/.test(html));
  } else {
    check('HTML: Previous/Next are disabled with accessible names (the other preview is not a released neighbor)', has('None earlier<span class="sr-only"> — No earlier released game</span>') && has('None later<span class="sr-only"> — No later released game</span>') && !/<a class="gn-link"/.test(html));
  }
  check('HTML: exact recap, source date line, both sources, disclosure before the embed, ordinary link', has('Source date 17 October 2026; edition 18 October 2026 UTC') && has('On 17 October, Odyssey said it had placed a fruit-fly brain inside its Odyssey-3 world model and showed a demo it described as a fly navigating imagined worlds. CEO Oliver Cameron shared the demo with “Fly free lil’ buddy.” This game turns that premise into a fictional cartoon obstacle course: the rebuilding walls, banana escape and desktop reveal are our joke, not claims about the experiment.') && has('href="https://twitter.com/odysseyml/status/2111589148146749616"') && has('href="https://twitter.com/olivercameron/status/2111589310571147464"') && has('Official X post — loading may contact X and its media services and share network/device identifiers.') && html.indexOf('class="privacy"') < html.indexOf('id="embed-mount"'));
  check('HTML: Intro copy, nonmodal in-arena sections, separate steering and utility controls, no provider markup/hints', has('Reach the banana. Follow the dashed gap when the world rebuilds.') && has('↑/↓ or W/S: steer') && has('Hold ▲ / ▼ to steer') && !/aria-modal|role="dialog"|autofocus/.test(html) && html.indexOf('id="panel-intro"') > html.indexOf('id="arena"') && html.indexOf('id="utils"') > html.indexOf('id="steer"') && !/<iframe|rel="(preconnect|dns-prefetch|preload)"|<script[^>]+src="https?:/i.test(bare));
  const metaCsp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/) || [])[1]?.replace(/&#39;/g, "'");
  check('meta CSP equals the header CSP minus frame-ancestors', metaCsp === CSP, metaCsp);
  const emb = (await local(`games/${ED}/js/embed.js`)).toString();
  check('Fly embed.js: 8 s timeout, post id 2111589148146749616, one automatic attempt, no retry/load control', /LOAD_TIMEOUT_MS = 8000/.test(emb) && /TWEET_ID = '2111589148146749616'/.test(emb) && !/retryButton|btn-retry|retry\(\)/.test(emb));
  return hosted;
}

/** Hermetic local builds: an EMPTY registry keeps the scaffold root; in public mode the repository registry build must reproduce the artifact. */
async function localBuilds() {
  const tmp = await mkdtemp(join(tmpdir(), 'fly-verify-public-'));
  try {
    const empty = join(tmp, 'empty.json'); await writeFile(empty, JSON.stringify({ schema: 1, editions: [] }));
    const m = await build({ mode: 'public', outDir: join(tmp, 'scaffold'), releaseRegistry: empty });
    const idx = await readFile(join(tmp, 'scaffold', 'index.html')); const baseIdx = (() => { try { return git('show', `${BASE}:public/index.html`); } catch { return null; } })();
    const files = await walk(join(tmp, 'scaffold'));
    check('local build with an EMPTY registry fixture: scaffold root equals the base scaffold, no games, neither edition in any file', m.root === 'scaffold' && m.releasedEditions.length === 0 && !!baseIdx && idx.equals(baseIdx) && !files.some((f) => f.startsWith('games/')));
    if (PUB) {
      const again = await build({ mode: 'public', outDir: join(tmp, 'again') });
      const lm = JSON.parse((await local('build-manifest.json')).toString());
      check('local public build from the repository registry reproduces the dist tree hash (same registry, same bytes)', again.treeSha256 === lm.treeSha256, `${again.treeSha256} vs ${lm.treeSha256}`);
    }
  } finally { await rm(tmp, { recursive: true, force: true }); }
}

// ------------------------------------------------------------------------------------------------------------ browser
const problems = []; const external = []; const providerErrors = [];
async function pageFor(browser, opts, label) {
  const context = await browser.newContext(opts); const page = await context.newPage();
  page.on('console', (m) => { if (m.type() !== 'error') return; const known404 = m.location().url.endsWith(UNKNOWN) && /status of 404/.test(m.text()); const csp = /Executing inline script|Applying inline style violates.*style-src/.test(m.text()) && /widgets\.js|style-src/.test(m.text()); if (!known404 && !csp) problems.push(`[${label}] console: ${m.text()}`); });
  page.on('pageerror', (e) => { if (/platform\.twitter\.com/.test(e.stack || '')) providerErrors.push(e.message.slice(0, 90)); else problems.push(`[${label}] pageerror: ${e.message}`); });
  page.on('request', (r) => { if (!r.url().startsWith(DRAFT) && !/^(data|blob|about):/.test(r.url())) external.push(`[${label}] ${new URL(r.url()).host}`); });
  return { context, page };
}
const st = async (p) => (await readSim(p))?.state;
const waitState = (p, s, timeout = 8000) => p.waitForFunction((x) => document.getElementById('game')?.dataset.state === x, s, { timeout, polling: 20 });
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) }); };

async function viewportFlow(browser, vp) {
  const { context, page } = await pageFor(browser, { viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch }, vp.name);
  await page.goto(`${DRAFT}${FLY}`);
  const intro = await measureLayout(page);
  evidence[`${vp.name} intro`] = intro;
  for (const [n, p, d] of geometryChecks(vp, intro, 'intro')) check(n, p, d);
  const s0 = await readSim(page);
  check(`${vp.name}: first entry is a frozen Intro (t=0, y=.5) with browser focus untouched`, s0?.state === 'intro' && s0.tUs === 0 && s0.y === 0.5 && intro.active === 'BODY', JSON.stringify({ s0, active: intro.active }));
  await page.waitForTimeout(1200);
  check(`${vp.name}: nothing advances behind Intro (real 1.2 s)`, (await readSim(page))?.tUs === 0);
  await shot(page, `${vp.name}-1-intro`);
  await page.click('#btn-start'); await waitState(page, 'running');
  await page.waitForTimeout(400);
  const active = await measureLayout(page);
  evidence[`${vp.name} active`] = active;
  for (const [n, p, d] of geometryChecks(vp, active, 'active')) check(n, p, d);
  await shot(page, `${vp.name}-2-active`);
  // follow the route in real time until the first recompile preview is on screen, shoot it, then pause
  const bot = createBot(page);
  let sim = await readSim(page);
  while (sim.state === 'running' && sim.tUs < 4_200_000) { await bot.tick(sim); await page.waitForTimeout(12); sim = await readSim(page); }
  await bot.release();
  const cue = await page.evaluate(() => ({ old: !document.getElementById('tag-old')?.hidden, next: !document.getElementById('tag-next')?.hidden }));
  check(`${vp.name}: OLD and NEXT GAP cues visible during the first recompile preview`, sim.state === 'running' && cue.old && cue.next, JSON.stringify({ sim, cue }));
  await shot(page, `${vp.name}-3-recompile-preview`);
  await page.keyboard.press('Escape');
  const paused = await readSim(page);
  check(`${vp.name}: Escape pauses, clears input, freezes the clock`, paused.state === 'paused' && paused.held === 'none', JSON.stringify(paused));
  await page.waitForTimeout(600);
  check(`${vp.name}: paused clock does not advance (real 0.6 s)`, (await readSim(page)).tUs === paused.tUs);
  await shot(page, `${vp.name}-4-paused`);
  await page.click('#btn-restart-paused');
  check(`${vp.name}: Restart returns to a fresh focused Intro`, (await st(page)) === 'intro' && (await page.evaluate(() => document.activeElement?.id)) === 'btn-start' && (await readSim(page)).tUs === 0);
  evidence[`${vp.name} embed state`] = await page.getAttribute('#embed-area', 'data-embed-state');
  await context.close();
}

async function desktopFlow(browser) {
  const { context, page } = await pageFor(browser, { viewport: { width: 1280, height: 800 } }, 'flow');
  await page.goto(`${DRAFT}/`);
  check(PUB ? 'root opens the latest edition (Fly, 18 Oct) without preview framing' : 'root opens the labeled preview candidate', /^18 Oct 2026/.test(((await page.textContent('nav a[aria-current="page"]')) || '').trim()) && (PUB ? (await page.locator('.preview-badge').count()) === 0 && (await page.title()) === 'Fly the Simulation' : (await page.isVisible('.preview-badge')) && (await page.title()) === 'Fly the Simulation — Preview (not released)'));
  await page.goto(`${DRAFT}${FLY}`);
  await page.reload(); check('refresh keeps the dated route at Intro', (await st(page)) === 'intro');
  await page.click('details.others > summary');
  await Promise.all([page.waitForURL(`${DRAFT}${BOX}`), page.click('details.others a')]);
  check('boxing preview still loads at its own route with its Intro', (await page.getAttribute('#app', 'data-state')) === 'intro' && /30-Second KO/.test((await page.textContent('#game-title')) || ''));
  await page.goBack(); await page.waitForURL(`${DRAFT}${FLY}`);
  check('Back returns to the Fly Intro', (await st(page)) === 'intro');
  const r404 = await page.goto(`${DRAFT}${UNKNOWN}`); check('browser: unknown date HTTP 404, honest page', r404?.status() === 404 && /Page not found/.test((await page.textContent('main')) || ''));
  await page.goto(`${DRAFT}${FLY}`);
  // loss: hold nothing
  await page.click('#btn-start'); await waitState(page, 'running');
  await waitState(page, 'lost', 12000);
  const lost = await readSim(page);
  check('real-clock neutral run: loses at seam 2 contact (5.86 s) with the exact result card, focus on its heading', lost?.tUs === 5_860_000 && (await page.textContent('#result-heading')) === 'Bonk. Still in beta.' && (await page.evaluate(() => document.activeElement?.id)) === 'result-heading', JSON.stringify(lost));
  await shot(page, '1280x800-5-result-lost');
  await page.click('#btn-retry');
  check('Retry returns to a focused, frozen Intro (not action)', (await st(page)) === 'intro' && (await page.evaluate(() => document.activeElement?.id)) === 'btn-start' && (await readSim(page)).tUs === 0);
  if (!flag('skip-real-win')) {
    await page.click('#btn-start'); await waitState(page, 'running');
    const t0 = Date.now();
    const s = await playReal(page, { timeoutMs: 40000 });
    evidence.realWin = { state: s?.state, tUs: s?.tUs, cleared: s?.cleared, wallMs: Date.now() - t0 };
    check('real-clock scripted route wins at t=20.000 s with 7/7, exact heading and final copy, Skip/Play again/Copy result', s?.state === 'won' && s.tUs === 20_000_000 && s.cleared === 7 && (await page.textContent('#result-heading')) === 'You escaped the simulation.' && (await page.textContent('#result-copy')) === 'WORLD: FAKE. LUNCH: REAL ENOUGH.' && (await page.isEnabled('#btn-again')) && (await page.isEnabled('#btn-copy')), JSON.stringify(s));
    await page.waitForTimeout(250); await shot(page, '1280x800-6-result-won-reveal-start');
    await page.waitForTimeout(2000); await shot(page, '1280x800-7-result-won-final');
    await page.click('#btn-copy');
    await page.waitForFunction(() => !!document.getElementById('copy-note')?.textContent, null, { timeout: 5000 }).catch(() => {});
    const note = ((await page.textContent('#copy-note')) || '').trim();
    check('Copy result is honest: either "Copied to clipboard." or a visible selectable fallback with the exact text (link-free in preview, the dated production URL in public)', note === 'Copied to clipboard.' || (/^Copy failed\./.test(note) && (await page.inputValue('#copy-text')) === `I escaped the simulation. The banana was a desktop icon. — Fly the Simulation, 2026-10-18${PUB ? ` ${ORIGIN}${FLY}` : ''}`), note);
    notes.push(`Copy result outcome on this hosted draft: "${note}"`);
    await page.click('#btn-again');
    check('Play again returns to a focused Intro', (await st(page)) === 'intro' && (await page.evaluate(() => document.activeElement?.id)) === 'btn-start');
  }
  await page.keyboard.press('Space'); await page.waitForTimeout(300);
  check('Space with Start focused starts exactly one run', (await st(page)) === 'running');
  evidence.flowEmbedState = await page.getAttribute('#embed-area', 'data-embed-state');
  await context.close();
}

/** Real-clock scripted boxing win at the boxing route (its own verifier checks it in depth): keeps both games' wins covered here. */
async function boxingWin(browser) {
  const { context, page } = await pageFor(browser, { viewport: { width: 1280, height: 720 } }, 'boxing');
  await page.goto(`${DRAFT}${BOX}`);
  const bs = () => page.getAttribute('#app', 'data-state');
  await page.click('#btn-start'); await page.waitForFunction(() => document.getElementById('app')?.dataset.state === 'playing', null, { timeout: 8000, polling: 20 });
  const t0 = Date.now(); await page.keyboard.down('k');
  while ((await bs()) === 'playing' && Date.now() - t0 < 40000) { if (await page.evaluate(() => !document.getElementById('counter-badge')?.hidden)) { await page.keyboard.press('Space'); await page.waitForTimeout(620); } else await page.waitForTimeout(10); }
  await page.keyboard.up('k');
  check('boxing real-clock scripted win: exact headline, KO time, BEAT THE BUZZER, 80/0 HP; Retry returns to Intro', (await bs()) === 'result' && ((await page.textContent('#result-headline')) || '').trim() === 'KO! You beat the 30-second headline.' && /KO time: \d+\.\d\ds/.test((await page.textContent('#result-time')) || '') && ((await page.textContent('.stamp-line')) || '').includes('BEAT THE BUZZER') && /You: 80 HP · Jack: 0 HP/.test((await page.textContent('#result-health')) || ''));
  if (PUB) check('boxing (public): the result offers "Share result" (dated production link allowed), not the link-free copy', ((await page.textContent('#btn-share')) || '').trim() === 'Share result');
  await page.click('#btn-retry');
  check('boxing Retry returns to a focused Intro with 100/30', (await bs()) === 'intro' && (await page.evaluate(() => document.activeElement?.id)) === 'btn-start' && ((await page.textContent('#time-left')) || '').trim() === '30');
  await context.close();
}

let fatal = null; let browser; let hosted = null;
try {
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  hosted = await http();
  await localBuilds();
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  await desktopFlow(browser);
  if (!flag('skip-real-win')) await boxingWin(browser);
  for (const vp of VIEWPORTS) await viewportFlow(browser, vp);
} catch (e) { fatal = /** @type {any} */ (e)?.stack || String(e); } finally { if (browser) await browser.close(); }
check('no unexpected console/page errors (intentional 404 and the known widgets.js CSP self-test excluded)', problems.length === 0, problems.join(' | '));
const allowed = /^(platform\.twitter\.com|syndication\.twitter\.com|cdn\.syndication\.twimg\.com|syndication\.x\.com|pbs\.twimg\.com|video\.twimg\.com|abs-0\.twimg\.com)$/;
const hostsOf = (list) => [...new Set(list.map((h) => h.replace(/^\[[^\]]*\] /, '')))].sort();
const bad = hostsOf(external).filter((h) => !allowed.test(h));
check('only the documented X provider hosts were contacted (top-document + provider frames)', bad.length === 0, bad.join(','));
if (providerErrors.length) notes.push(`third-party errors thrown inside X's own scripts (not our code, did not affect play): ${[...new Set(providerErrors)].join(' | ')} (x${providerErrors.length})`);
notes.push(`external hosts contacted: ${hostsOf(external).join(', ') || 'none'}`);
const failures = checks.filter((c) => !c.pass);
const report = { ok: failures.length === 0 && !fatal, draft: DRAFT, expectedSha: SHA, baseSha: BASE, note: 'Scripted automation (real Chromium, emulated viewports/touch, real clock); not human play, physical-device, screen-reader or provider-render evidence.', total: checks.length, passed: checks.length - failures.length, failures, fatal, notes, evidence };
const outFile = arg('out');
if (outFile) await writeFile(outFile, JSON.stringify({ ...report, checks }, null, 2) + '\n');
console.log(JSON.stringify({ ...report, evidence: undefined }, null, 2));
process.exit(report.ok ? 0 : 1);

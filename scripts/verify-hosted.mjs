// Hosted-preview verifier for the boxing edition (r7: two-candidate preview, lower mobile Pause). Run against a draft after `npm run build:preview` of the SAME clean commit:
//   node scripts/verify-hosted.mjs --url <draft origin> --sha <full 40-char commit> [--out evidence.json]
// Compares hosted bytes with local dist/, checks effective headers, navigation, real-clock gameplay and the active
// phone/landscape/desktop geometry. Scripted automation only: not human play evidence. It never asserts that the X
// post rendered (that belongs to `npm run check:embed-real -- --url <origin>`); it only records the embed state.
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT } from './lib/build-lib.mjs';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const DRAFT = (arg('url') || '').replace(/\/$/, '');
const SHA = arg('sha') || '';
if (!/^(https:\/\/|http:\/\/127\.0\.0\.1)/.test(DRAFT) || !/^[0-9a-f]{40}$/.test(SHA)) { console.error('usage: --url https://<draft origin> --sha <40-hex commit> [--out file]'); process.exit(2); }
const GAME = '/games/2026-10-17/';
const FLY = '/games/2026-10-18/'; // the second (Fly the Simulation) preview candidate; preserved, never a boxing arrow destination
const UNKNOWN = '/games/2026-10-19/';
const walk = async (d, base = d) => (await Promise.all((await readdir(d)).sort().map(async (n) => ((await stat(join(d, n))).isDirectory() ? walk(join(d, n), base) : [relative(base, join(d, n)).split(sep).join('/')])))).flat();
const LABEL = '17 Oct 2026 — Preview (not released)';
const checks = []; const notes = []; const evidence = {};
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, ...(pass ? {} : { detail: String(detail) }) });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const get = async (p) => { const r = await fetch(`${DRAFT}${p}`, { cache: 'no-store', redirect: 'manual' }); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), headers: r.headers }; };
const local = (p) => readFile(join(ROOT, 'dist', p));

async function http() {
  const lm = await local('build-manifest.json'); const man = JSON.parse(lm.toString());
  check('local dist is the expected clean preview artifact', man.mode === 'preview' && man.source?.commit === SHA && man.source?.dirty === false && man.source?.exactShaArtifact === true, JSON.stringify({ mode: man.mode, source: man.source }));
  const hm = await get('/build-manifest.json');
  check('hosted manifest 200 and byte-identical to local', hm.status === 200 && hm.buf.equals(lm), `status ${hm.status}`);
  const hosted = JSON.parse(hm.buf.toString());
  check('hosted manifest: SHA, clean, exact flag, preview mode, tree hash', hosted.source?.commit === SHA && hosted.source?.dirty === false && hosted.source?.exactShaArtifact === true && hosted.mode === 'preview' && hosted.treeSha256 === man.treeSha256, JSON.stringify(hosted.source));
  check('manifest: no released edition (public registry empty); BOTH preview candidates listed; root is the latest preview candidate', (hosted.releasedEditions || []).length === 0 && JSON.stringify(hosted.previewEditions) === JSON.stringify(['2026-10-17', '2026-10-18']) && hosted.root === 'preview-candidate', JSON.stringify([hosted.releasedEditions, hosted.previewEditions, hosted.root]));
  // every shipped file is listed (no silent omission) and every listed file exists locally with the same hash
  const localFiles = (await walk(join(ROOT, 'dist'))).filter((f) => f !== 'build-manifest.json');
  const listed = hosted.files.map((f) => f.path);
  check('manifest lists exactly the files in local dist/ (nothing omitted, nothing extra)', JSON.stringify([...localFiles].sort()) === JSON.stringify([...listed].sort()), JSON.stringify({ missing: localFiles.filter((f) => !listed.includes(f)), extra: listed.filter((f) => !localFiles.includes(f)) }));
  for (const f of hosted.files) check(`local file ${f.path} matches its manifest hash`, sha(await local(f.path)) === f.sha256);
  const bad = [];
  for (const f of hosted.files.filter((x) => x.path !== '_headers')) { const r = await get(`/${f.path}`); if (r.status !== 200 || sha(r.buf) !== f.sha256) bad.push(`${f.path} ${r.status}`); }
  check(`all ${hosted.files.length - 1} non-config manifest files: HTTP 200 and SHA-256 match`, bad.length === 0, bad.join('; '));
  const lh = await local('_headers');
  check('manifest lists _headers with the local file hash', hosted.files.find((x) => x.path === '_headers')?.sha256 === sha(lh));
  const hr = await get('/_headers');
  notes.push(`GET /_headers -> HTTP ${hr.status} (${hr.headers.get('content-type')}): Netlify consumes this config file; ${hr.status === 200 && !/html/.test(hr.headers.get('content-type') || '') ? 'it is also served' : 'it is not served as an asset'}. Effective values are checked from response headers below.`);
  const want = {};
  for (const line of lh.toString().split('\n').slice(1)) { const i = line.indexOf(':'); if (i > 0) want[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
  evidence.expectedHeaders = want; evidence.effectiveHeaders = {};
  for (const [label, p] of Object.entries({ root: '/', dated: GAME, 'main.js': `${GAME}js/main.js`, 'embed.js': `${GAME}js/embed.js`, 'game.css': `${GAME}game.css`, 'fly route': FLY, 'site.css': '/assets/site.css', 'scaffold css': '/styles.css', 404: UNKNOWN })) {
    const r = await get(p); evidence.effectiveHeaders[label] = {};
    for (const [k, v] of Object.entries(want)) { const got = r.headers.get(k); evidence.effectiveHeaders[label][k] = got; check(`effective ${k} on ${label} equals local _headers`, got === v, `got ${got}`); }
  }
  const root = await get('/'); const dated = await get(GAME); const fly = await get(FLY);
  check('root = latest preview candidate (Fly) byte-for-byte; boxing dated route equals its local HTML and is different from root', root.status === 200 && dated.status === 200 && fly.status === 200 && root.buf.equals(await local('index.html')) && root.buf.equals(await local('games/2026-10-18/index.html')) && fly.buf.equals(await local('games/2026-10-18/index.html')) && dated.buf.equals(await local('games/2026-10-17/index.html')) && !root.buf.equals(dated.buf));
  const html = dated.buf.toString();
  const bare = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
  check('HTML: preview framing, noindex, nav label, source href, news heading', html.includes('<meta name="robots" content="noindex">') && html.includes('Preview — not released') && html.includes('aria-current="page">17 Oct 2026<span class="pv"> — Preview (not released)</span>') && html.includes('<span class="preview-badge" role="note">Preview — not released</span>') && html.includes('href="https://twitter.com/FearedBuck/status/2111278238253342868"') && html.includes('>News behind the game</h2>'));
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  check('HTML r6: ONE compact navigation in the header; no About/tutorial/title/share in the header; About only in the footer after the news', (html.match(/<nav /g) || []).length === 1 && html.includes('<nav class="site-nav" aria-label="Game navigation">') && !/About|Block the hit|<h1|Share/.test(header) && /<footer class="site-footer"><button type="button" id="btn-about"/.test(html) && html.indexOf('id="btn-about"') > html.indexOf('id="news"') && (html.match(/id="btn-about"/g) || []).length === 1);
  check('HTML r6: Intro overlay inside the arena with the exact goal, keyboard and touch lines and Start round; no persistent instruction element', html.indexOf('id="panel-intro"') > html.indexOf('id="arena"') && html.indexOf('id="panel-intro"') < html.indexOf('id="cuebar"') && html.includes('Block the hit. Punch on COUNTER. KO Jack before time runs out.') && html.includes('<strong>PUNCH:</strong> Space / J · <strong>GUARD:</strong> hold K / Shift · Esc: Pause') && html.includes('<strong>PUNCH:</strong> tap · <strong>GUARD:</strong> hold') && html.includes('>Start round</button>') && !html.includes('instr-play') && (html.match(/Block the hit\. Punch on COUNTER/g) || []).length === 2);
  check('HTML r6: disabled ends carry compact visible and full accessible labels', html.includes('None earlier<span class="sr-only"> — No earlier released game</span>') && html.includes('None later<span class="sr-only"> — No later released game</span>'));
  check('HTML r7: one real Pause <button> with the 24x24-badge markup and an accessible name; Restart is a text button; Pause/Restart sit in the tools row after the combat rail; old text-only HUD Pause is gone', /<button type="button" id="btn-pause" class="pause-btn" disabled><span class="pause-badge" aria-hidden="true"><i><\/i><i><\/i><\/span><span class="pause-label" aria-hidden="true">Pause<\/span><span class="sr-only">Pause game<\/span><\/button>/.test(html) && html.includes('id="btn-restart-play" class="btn small">Restart</button>') && (html.match(/id="btn-pause"/g) || []).length === 1 && !html.includes('class="btn small" disabled>Pause'));
  const chooser = (html.match(/<details class="others">[\s\S]*?<\/details>/) || [''])[0];
  check('HTML r7: the boxing page offers the Fly preview only in the Other dates chooser (a real link), and both arrows stay disabled buttons', chooser.includes('href="/games/2026-10-18/"') && (html.match(/class="gn-link" disabled/g) || []).length === 2 && !html.includes('<a class="gn-link"'));
  check('HTML: no provider script/iframe/hint in markup (the one automatic attempt is injected by game code)', !/<iframe|rel="(preconnect|dns-prefetch|preload)"|<script[^>]+src="https?:/i.test(bare));
  const nf = await get(UNKNOWN);
  check('unknown date is an honest HTTP 404 page, equal to local 404.html', nf.status === 404 && nf.buf.equals(await local('404.html')) && /Page not found/.test(nf.buf.toString()) && !/id="app"/.test(nf.buf.toString()));
  const metaCsp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/) || [])[1]?.replace(/&#39;/g, "'");
  check('meta CSP equals the header CSP minus frame-ancestors', metaCsp === (want['content-security-policy'] || '').replace(/; frame-ancestors 'none'$/, ''), metaCsp);
}

const problems = []; const external = []; const providerErrors = [];
async function pageFor(browser, opts, label) {
  const context = await browser.newContext(opts); const page = await context.newPage();
  page.on('console', (m) => { if (m.type() !== 'error') return; const known404 = m.location().url.endsWith(UNKNOWN) && /status of 404/.test(m.text()); const csp = /Executing inline script|Applying inline style violates.*style-src/.test(m.text()) && /widgets\.js|style-src/.test(m.text()); if (!known404 && !csp) problems.push(`[${label}] console: ${m.text()}`); });
  page.on('pageerror', (e) => { if (/platform\.twitter\.com/.test(e.stack || '')) providerErrors.push(e.message.slice(0, 90)); else problems.push(`[${label}] pageerror: ${e.message}`); });
  page.on('request', (r) => { if (!r.url().startsWith(DRAFT) && !/^(data|blob|about):/.test(r.url())) external.push(`[${label}] ${new URL(r.url()).host}`); });
  return { context, page };
}
const st = (p) => p.getAttribute('#app', 'data-state');
const tx = async (p, s) => ((await p.textContent(s)) || '').trim();
const geo = (page) => page.evaluate(() => {
  const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; };
  return { vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, restart: r('#btn-restart-play'), badge: r('.pause-badge'), hud: r('#hud'), arena: r('#arena'), cue: r('#cuebar'), guard: r('#btn-guard'), punch: r('#btn-punch'), pause: r('#btn-pause'), canvas: (() => { const c = /** @type {HTMLCanvasElement} */ (document.getElementById('art')); return [c.width, c.height, Number(c.dataset.px)]; })() };
});
const waitState = (p, s) => p.waitForFunction((x) => document.getElementById('app')?.dataset.state === x, s, { timeout: 8000, polling: 20 });

async function active(browser, name, w, h, mode) {
  const { context, page } = await pageFor(browser, { viewport: { width: w, height: h }, hasTouch: mode !== 'desktop' }, name);
  await page.goto(`${DRAFT}${GAME}`);
  const intro = await page.evaluate(() => { const r = (id) => /** @type {HTMLElement} */ (document.getElementById(id)).getBoundingClientRect(); const a = r('arena'); const i = r('panel-intro'); return { inside: i.x >= a.x - 0.5 && i.right <= a.right + 0.5 && i.y >= a.y - 0.5 && i.bottom <= a.bottom + 0.5, active: document.activeElement?.id, header: /** @type {Element} */ (document.querySelector('.site-header')).getBoundingClientRect().height, fonts: ['.intro-goal', '.intro-keys', '.intro-touch', '#btn-start'].map((s) => parseFloat(getComputedStyle(/** @type {Element} */ (document.querySelector(s))).fontSize)), hp: (document.getElementById('hp-player')?.textContent || '').trim(), time: (document.getElementById('time-left')?.textContent || '').trim() }; });
  evidence[`${name} intro`] = intro;
  check(`${name}: Intro fits inside the arena at >=16px, Start focused, 100/30 shown, preview label, notice, summary/link, no Load button`, (await st(page)) === 'intro' && intro.inside && intro.active === 'btn-start' && intro.fonts.every((f) => f >= 16) && /100$/.test(intro.hp) && intro.time === '30' && (await tx(page, 'nav a[aria-current="page"]')).startsWith('17 Oct 2026') && (await tx(page, '.privacy')).startsWith('This embedded post connects to X automatically.') && (await page.locator('#btn-load-embed').count()) === 0 && (await page.isVisible('#link-open-x')));
  if (mode === 'desktop') check(`${name}: compact header <= 72px`, intro.header <= 72, intro.header);
  else check(`${name}: compact header <= 112px (two short rows at most)`, intro.header <= 112, intro.header);
  check(`${name}: Previous/Next are disabled buttons with compact honest text (real empty registry)`, await page.evaluate(() => [...document.querySelectorAll('.site-nav button[data-gn]')].every((b) => /** @type {HTMLButtonElement} */ (b).disabled) && document.querySelectorAll('.site-nav a[data-gn]').length === 0));
  await page.waitForTimeout(1500);
  check(`${name}: nothing advances behind Intro (HUD still 100/30 after 1.5 s real time)`, (await tx(page, '#time-left')) === '30' && (await tx(page, '#hp-player')).endsWith('100'));
  await page.click('#btn-start'); await waitState(page, 'playing');
  check(`${name}: overlay and instruction absent in play`, await page.evaluate(() => !!document.getElementById('panel-intro')?.hidden && !document.getElementById('instr-play')));
  await page.keyboard.down('k'); await page.waitForTimeout(1000);
  const m = await geo(page); evidence[name] = m;
  for (const k of ['hud', 'arena', 'cue', 'guard', 'punch', 'pause', 'restart']) check(`${name}: ${k} inside the active view after Start (no manual scroll)`, m[k].x >= -0.5 && m[k].right <= m.vw + 0.5 && m[k].y >= -0.5 && m[k].bottom <= m.vh + 0.5, JSON.stringify(m[k]));
  check(`${name}: no horizontal overflow; thumb controls >= 64px; Pause and Restart >= 44px`, m.sw <= m.vw && m.guard.h >= 64 && m.punch.h >= 64 && m.pause.h >= 44 && m.restart.h >= 44);
  const dist = (a, b) => Math.hypot(Math.max(0, a.x - b.right, b.x - a.right), Math.max(0, a.y - b.bottom, b.y - a.bottom));
  if (mode !== 'desktop') {
    // r7 lower, smaller-looking mobile Pause
    check(`${name}: r7 Pause is one real >=44x44 button with a 24x24 centered badge; Restart >=44`, m.pause.w >= 44 && m.pause.h >= 44 && Math.abs(m.badge.w - 24) < 0.5 && Math.abs(m.badge.h - 24) < 0.5 && Math.abs(m.badge.x + m.badge.w / 2 - (m.pause.x + m.pause.w / 2)) < 0.5 && Math.abs(m.badge.y + m.badge.h / 2 - (m.pause.y + m.pause.h / 2)) < 0.5, JSON.stringify([m.pause, m.badge]));
    const gaps = [dist(m.pause, m.guard), dist(m.pause, m.punch), dist(m.restart, m.guard), dist(m.restart, m.punch)];
    check(`${name}: r7 every utility rectangle is >=16px from Guard and Punch; Pause-Restart gap >=12`, gaps.every((g) => g >= 15.99) && dist(m.pause, m.restart) >= 11.99, JSON.stringify([gaps, dist(m.pause, m.restart)]));
    check(`${name}: r7 utilities are below the arena, not above it`, m.pause.y >= m.arena.bottom && m.restart.y >= m.arena.bottom);
    check(`${name}: cue >= 40 high, cue/arena minima kept`, m.cue.h >= 40 && m.arena.h >= 200);
  }
  if (mode === 'portrait') check(`${name}: arena >= 296 wide (at 320), = clamp(210, 40svh, 360) or the 600-899 clamp(240, 40svh, 400); utility row >=16px below the combat row, Pause left of Restart`, (w >= 600 ? Math.abs(m.arena.h - Math.min(400, Math.max(240, h * 0.4))) <= 1 : (m.arena.w >= 296 && Math.abs(m.arena.h - Math.min(360, Math.max(210, h * 0.4))) <= 1)) && m.pause.y >= Math.max(m.guard.bottom, m.punch.bottom) + 15.99 && m.pause.x < m.restart.x, `${m.arena.w}x${m.arena.h}`);
  if (mode === 'landscape') check(`${name}: arena >= 200 high; 104-128px right rail Guard over Punch with NO utilities; lower-left band (utilities >=16px left of the rail, cue beside them >=12px)`, m.arena.h >= 200 && m.guard.w >= 104 && m.guard.w <= 128 && m.guard.x >= m.arena.right && m.guard.y < m.punch.y && m.pause.right <= m.guard.x - 16 && m.restart.right <= m.guard.x - 16 && m.cue.x >= m.restart.right + 11.99 && m.cue.right <= m.guard.x, JSON.stringify([m.arena, m.pause, m.restart, m.cue, m.guard]));
  if (mode === 'desktop') check(`${name}: desktop unchanged: full 1120px panel, arena ~374 high, text Pause/Restart in the heading row, no badge`, Math.abs(m.arena.w - 1120) <= 1 && Math.abs(m.arena.h - 374) <= 2 && m.pause.y < m.hud.y && m.restart.y < m.hud.y && m.badge.w === 0, `${m.arena.w}x${m.arena.h}`);
  check(`${name}: WIND-UP label and progress visible at ~1 s`, (await page.isVisible('#windup-wrap')) && /WIND-UP/.test(await tx(page, '#windup-wrap')));
  await page.waitForTimeout(550);
  check(`${name}: BLOCK cue and COUNTER NOW after the guarded first strike`, /BLOCK/.test(await tx(page, '#cue')) && (await page.isVisible('#counter-badge')));
  evidence[`${name} embed state`] = await page.getAttribute('#embed-area', 'data-embed-state');
  await page.screenshot({ path: join(process.env.TMPDIR || '/tmp', `verify-hosted-${name.replace(/\W+/g, '-')}.png`) });
  await page.keyboard.up('k');
  if (mode !== 'desktop') {
    // r7 input routing (synthetic touch in an emulated viewport; not physical-phone evidence)
    const cdp = await context.newCDPSession(page);
    const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const c = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    await page.evaluate(() => { /** @type {any} */ (window).__clicks = 0; document.getElementById('btn-pause')?.addEventListener('click', () => { /** @type {any} */ (window).__clicks += 1; }); });
    const gc = c(m.guard); const pa = c(m.pause);
    await send('touchStart', [{ ...gc, id: 1 }]); await send('touchMove', [{ ...pa, id: 1 }]); await send('touchEnd', [{ ...pa, id: 1 }]);
    check(`${name}: a Guard touch dragged and released over Pause releases Guard and does not activate Pause`, (await st(page)) === 'playing' && (await page.getAttribute('#btn-guard', 'aria-pressed')) === 'false' && (await page.evaluate(() => /** @type {any} */ (window).__clicks)) === 0);
    const before = Number(await page.getAttribute('#app', 'data-punch-requests'));
    for (const [x, y] of [[m.punch.x + 2, m.punch.bottom - 2], [m.punch.right - 2, m.punch.bottom - 2], [m.punch.x + 2, m.punch.bottom - 2]]) await page.touchscreen.tap(x, y);
    check(`${name}: repeated Punch taps 2px inside its lower corners are Punch requests and never pause`, Number(await page.getAttribute('#app', 'data-punch-requests')) - before >= 3 && (await st(page)) === 'playing');
    await page.touchscreen.tap(m.pause.x + 1, m.pause.y + 1);
    check(`${name}: a deliberate tap 1px inside Pause pauses exactly once; Resume keeps the round, Restart returns to Intro`, (await st(page)) === 'paused' && (await page.evaluate(() => /** @type {any} */ (window).__clicks)) <= 1 && (await page.isVisible('#dlg-pause')));
    await page.click('#btn-resume');
    check(`${name}: Resume shows the countdown (round preserved, no Intro)`, (await st(page)) === 'countdown' && !(await page.isVisible('#panel-intro')));
  }
  await context.close();
}

async function desktopFlow(browser) {
  const { context, page } = await pageFor(browser, { viewport: { width: 1280, height: 720 } }, 'flow');
  await page.goto(`${DRAFT}/`);
  check('root opens the latest preview candidate (Fly the Simulation, 18 Oct) with Preview framing', (await tx(page, 'nav a[aria-current="page"]')).startsWith('18 Oct 2026') && (await page.isVisible('.preview-badge')));
  await page.goto(`${DRAFT}${GAME}`);
  check('boxing dated route: selected 17 Oct preview, one real aria-current link', (await tx(page, 'nav a[aria-current="page"]')).startsWith(LABEL) && (await page.locator('.site-header a[aria-current="page"]').count()) === 1);
  await page.reload(); check('refresh keeps the dated route at Intro', (await st(page)) === 'intro');
  await Promise.all([page.waitForURL(`${DRAFT}/`), page.click('.site-header a.brand')]); await page.goBack(); await page.waitForURL(`${DRAFT}${GAME}`);
  check('back returns to the boxing Intro', (await st(page)) === 'intro');
  await page.click('details.others > summary'); await Promise.all([page.waitForURL(`${DRAFT}${FLY}`), page.click('details.others a[href="/games/2026-10-18/"]')]);
  check('Other dates chooser reaches the Fly preview route (preserved edition, its own page)', new URL(page.url()).pathname === FLY && (await page.locator('#app, #game').count()) >= 1);
  await page.goBack(); await page.waitForURL(`${DRAFT}${GAME}`);
  const r404 = await page.goto(`${DRAFT}${UNKNOWN}`); check('browser: unknown date HTTP 404, honest page', r404?.status() === 404 && /Page not found/.test(await tx(page, 'main')));
  await page.goto(`${DRAFT}${GAME}`);
  await page.click('#btn-start'); await waitState(page, 'playing');
  await page.keyboard.press('Escape'); check('Escape pauses with the dialog', (await st(page)) === 'paused' && (await page.isVisible('#dlg-pause')));
  await page.click('#btn-restart');
  check('Pause > Restart returns to a focused Intro (no countdown) with 100/30', (await st(page)) === 'intro' && (await page.evaluate(() => document.activeElement?.id)) === 'btn-start' && (await tx(page, '#time-left')) === '30');
  await page.click('#btn-start'); await waitState(page, 'playing');
  const t0 = Date.now(); await page.keyboard.down('k');
  while ((await st(page)) === 'playing' && Date.now() - t0 < 40000) { if (await page.evaluate(() => !document.getElementById('counter-badge')?.hidden)) { await page.keyboard.press('Space'); await page.waitForTimeout(620); } else await page.waitForTimeout(10); }
  await page.keyboard.up('k');
  const head = await tx(page, '#result-headline');
  check('real-clock scripted win: headline, KO time, BEAT THE BUZZER, punchline, 80/0 HP, Retry/Share', head === 'KO! You beat the 30-second headline.' && /KO time: \d+\.\d\ds/.test(await tx(page, '#result-time')) && (await tx(page, '.stamp-line')).includes('BEAT THE BUZZER') && (await tx(page, '#payoff .punchline')) === 'Headline speedrun complete. The timeline can wait.' && /You: 80 HP · Jack: 0 HP/.test(await tx(page, '#result-health')) && (await page.isEnabled('#btn-retry')) && (await page.isEnabled('#btn-share')), head);
  check('pre-release share is link-free', (await tx(page, '#btn-share')) === 'Copy result' && /Link sharing is off/.test(await tx(page, '#share-note')));
  await page.screenshot({ path: join(process.env.TMPDIR || '/tmp', 'verify-hosted-desktop-win.png'), fullPage: true });
  await page.click('#btn-retry');
  check('Retry after the win returns to a focused Intro (no countdown) with 100/30, overlay visible', (await st(page)) === 'intro' && (await page.evaluate(() => document.activeElement?.id)) === 'btn-start' && (await tx(page, '#time-left')) === '30' && (await page.isVisible('#panel-intro')));
  await page.keyboard.press('Space'); await page.waitForTimeout(300);
  check('Space with Start focused starts exactly one countdown (native activation)', (await st(page)) === 'countdown');
  await context.close();
}

let fatal = null; let browser;
try {
  await http();
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  await desktopFlow(browser);
  for (const [n, w, h, mode] of [['320x568', 320, 568, 'portrait'], ['390x844', 390, 844, 'portrait'], ['667x375', 667, 375, 'landscape'], ['768x1024', 768, 1024, 'portrait'], ['1280x720', 1280, 720, 'desktop']]) await active(browser, n, w, h, mode);
} catch (e) { fatal = /** @type {any} */ (e)?.stack || String(e); } finally { if (browser) await browser.close(); }
check('no unexpected console/page errors (intentional 404 and the known widgets.js CSP self-test excluded)', problems.length === 0, problems.join(' | '));
const bad = external.filter((h) => !/ (platform\.twitter\.com|syndication\.twitter\.com|cdn\.syndication\.twimg\.com|syndication\.x\.com|pbs\.twimg\.com|video\.twimg\.com)$/.test(h));
check('only the documented X provider hosts were contacted (top-document + provider frames)', bad.length === 0, bad.join(','));
if (providerErrors.length) notes.push(`third-party errors thrown inside X's own scripts (not our code, did not affect play): ${[...new Set(providerErrors)].join(' | ')} (x${providerErrors.length})`);
notes.push(`external hosts contacted: ${[...new Set(external.map((h) => h.replace(/^\[[^\]]*\] /, '')))].sort().join(', ') || 'none'}`);
const failures = checks.filter((c) => !c.pass);
const report = { ok: failures.length === 0 && !fatal, draft: DRAFT, expectedSha: SHA, note: 'Scripted automation (real Chromium, emulated viewports/touch); not human play, device or screen-reader evidence.', total: checks.length, passed: checks.length - failures.length, failures, fatal, notes, evidence };
const outFile = arg('out');
if (outFile) await writeFile(outFile, JSON.stringify({ ...report, checks }, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

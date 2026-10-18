import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from '../scripts/lib/build-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'tr-build-'));
const out = (n) => join(tmp, n);
const read = (dir, p) => readFileSync(join(dir, p), 'utf8');
after(() => rmSync(tmp, { recursive: true, force: true }));

before(async () => {
  await build({ mode: 'public', outDir: out('public') });
  await build({ mode: 'preview', outDir: out('preview') });
});

test('public build with an empty release registry keeps the honest scaffold root and no candidate', () => {
  const d = out('public');
  const html = read(d, 'index.html');
  assert.match(html, /<h1>Hello, world!<\/h1>/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="viewport"/);
  assert.equal(existsSync(join(d, 'games')), false, 'no game files are published');
  for (const f of ['index.html', 'styles.css', '404.html', 'assets/site.css', 'build-manifest.json']) assert.ok(existsSync(join(d, f)), f);
  assert.doesNotMatch(html, /2026-10-17|30-Second|Preview/);
  const nf = read(d, '404.html');
  assert.match(nf, /No game editions are released yet/);
  assert.doesNotMatch(nf, /2026-10-17/);
});

test('scaffold page references no remote assets', () => {
  const html = read(out('public'), 'index.html');
  assert.doesNotMatch(html, /(src|href)=["']?(https?:)?\/\//);
  assert.doesNotMatch(read(out('public'), 'styles.css'), /https?:\/\/|@import/);
});

test('preview build exposes the candidate route, labeled nav entry and conspicuous banner', () => {
  const d = out('preview');
  const html = read(d, 'games/2026-10-17/index.html');
  assert.match(html, /17 Oct 2026<span class="pv"> — Preview \(not released\)<\/span>/);
  assert.match(html, /aria-current="page"[^>]*>17 Oct 2026/);
  assert.match(html, /class="preview-badge" role="note">Preview — not released/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<nav class="site-nav" aria-label="Game navigation">/);
  assert.match(html, /"shareUrl":null/);
  // root opens the candidate only with the banner
  const root = read(d, 'index.html');
  assert.match(root, /Preview — not released/);
  assert.equal(JSON.parse(read(d, 'build-manifest.json')).root, 'preview-candidate');
  assert.ok(existsSync(join(d, 'games/2026-10-17/js/main.js')));
  assert.ok(existsSync(join(d, 'games/2026-10-17/game.css')));
  assert.equal(existsSync(join(d, 'games/2026-10-17/edition.json')), false);
});

test('page template placeholders are all resolved and the source template stays unreleased', () => {
  for (const m of ['public', 'preview']) {
    const dir = out(m);
    const files = [`index.html`, `404.html`, ...(m === 'preview' ? ['games/2026-10-17/index.html'] : [])];
    for (const f of files) assert.doesNotMatch(read(dir, f), /\{\{\w+\}\}/, `${m}/${f}`);
  }
});

test('news section has the exact recap, source date and source link', () => {
  const html = read(out('preview'), 'games/2026-10-17/index.html');
  const recap = "FearedBuck reported on 17 October 2026 that Jack Doherty knocked out one of the Island Boys within the first 30 seconds at Brand Risk 16. That report inspired this game's 30-second first-to-KO challenge, but the cartoon duel, guard/counter rules and outcomes are fictional—not a reconstruction of the bout. The result has not been independently verified by this studio, and this unofficial parody implies no affiliation or endorsement.";
  assert.ok(html.includes(recap));
  assert.match(html, /<h2 id="news-heading">News behind the game<\/h2>/);
  assert.ok(html.includes('News/source date: 17 October 2026 (UTC)'));
  assert.ok(html.includes('href="https://twitter.com/FearedBuck/status/2111278238253342868"'));
  assert.ok(html.indexOf('id="news"') > html.indexOf('id="game"'), 'recap sits below the play area');
});

test('manifest hashes match the files and are reproducible', async () => {
  const d = out('public');
  const m = JSON.parse(read(d, 'build-manifest.json'));
  assert.equal(m.mode, 'public');
  assert.ok(m.files.length >= 4);
  for (const f of m.files) {
    assert.equal(createHash('sha256').update(readFileSync(join(d, f.path))).digest('hex'), f.sha256, f.path);
  }
  assert.ok(!m.files.some((f) => f.path === 'build-manifest.json'));
  const again = await build({ mode: 'public', outDir: out('public2') });
  assert.equal(again.treeSha256, m.treeSha256);
});

test('hosting env such as Netlify URL never creates a release or share link', async () => {
  const saved = { URL: process.env.URL, DEPLOY_PRIME_URL: process.env.DEPLOY_PRIME_URL };
  process.env.URL = 'https://scaffold.example.netlify.app';
  process.env.DEPLOY_PRIME_URL = 'https://draft--scaffold.example.netlify.app';
  try {
    const m = await build({ mode: 'preview', outDir: out('env') });
    assert.deepEqual(m.releasedEditions, []);
    assert.doesNotMatch(read(out('env'), 'games/2026-10-17/index.html'), /netlify\.app/);
    assert.match(read(out('env'), 'games/2026-10-17/index.html'), /"shareUrl":null/);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('npm run build CLI works and both builds leave dist/ untracked output only', () => {
  execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')], { stdio: 'pipe' });
  assert.deepEqual(readdirSync(join(root, 'dist')).sort(), ['404.html', '_headers', 'assets', 'build-manifest.json', 'index.html', 'styles.css']);
});

test('netlify config builds to dist without production settings or redirects that alias dates', () => {
  const toml = readFileSync(join(root, 'netlify.toml'), 'utf8');
  assert.match(toml, /command = "npm run build"/);
  assert.match(toml, /publish = "dist"/);
  assert.doesNotMatch(toml, /\[\[redirects\]\]|--prod|\[context/);
});

test('release registry is empty in the repository (no placeholder releases)', () => {
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'releases', 'registry.json'), 'utf8')).editions, []);
});

test('manifest records local git source and marks dirty trees as not exact-SHA artifacts', async () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
  const { source } = JSON.parse(read(out('public'), 'build-manifest.json'));
  assert.equal(source.commit, head);
  assert.match(source.commit, /^[0-9a-f]{40}$/);
  assert.equal(source.dirty, dirty);
  assert.equal(source.exactShaArtifact, !dirty);
  if (dirty) assert.match(source.note, /UNCOMMITTED/);
  // synthetic cases through the override
  const clean = await build({ outDir: out('src-clean'), source: { commit: head, dirty: false, exactShaArtifact: true, note: 'Clean working tree at commit.' } });
  const dirt = await build({ outDir: out('src-dirty'), source: { commit: head, dirty: true, exactShaArtifact: false, note: 'UNCOMMITTED: x' } });
  assert.equal(clean.treeSha256, dirt.treeSha256, 'tree hash covers output files only');
  assert.equal(dirt.source.exactShaArtifact, false);
});

test('gitSource outside a repository reports unknown, uncommitted', async () => {
  const { gitSource } = await import('../scripts/lib/build-lib.mjs');
  const s = gitSource(tmp);
  assert.equal(s.commit, null);
  assert.equal(s.dirty, true);
  assert.equal(s.exactShaArtifact, false);
  assert.match(s.note, /UNCOMMITTED/);
});

test('package is type: module', () => {
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).type, 'module');
});

test('r5: CSP is narrow (no unsafe-inline/eval, no wildcards) and only the X widget host is allowed', async () => {
  const { CSP, CSP_DIRECTIVES } = await import('../scripts/lib/build-lib.mjs');
  assert.doesNotMatch(CSP, /unsafe-|\*|http:/);
  assert.deepEqual(CSP_DIRECTIVES.filter((d) => d.includes('data:')), ["img-src 'self' data:"], 'data: only for images (inline favicon)');
  const hosts = new Set(CSP.match(/https:\/\/[a-z0-9.-]+/g));
  assert.deepEqual([...hosts], ['https://platform.twitter.com']);
  for (const need of ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "media-src 'none'"]) assert.ok(CSP_DIRECTIVES.includes(need), need);
  assert.ok(/script-src 'self' https:\/\/platform\.twitter\.com(;|$)/.test(CSP));
  assert.ok(/frame-src https:\/\/platform\.twitter\.com(;|$)/.test(CSP));
  for (const mode of ['public', 'preview']) {
    const headers = read(out(mode), '_headers');
    assert.ok(headers.includes(`Content-Security-Policy: ${CSP}; frame-ancestors 'none'`), mode);
    assert.match(headers, /X-Content-Type-Options: nosniff/);
    const html = read(out(mode), '404.html');
    assert.ok(html.includes('http-equiv="Content-Security-Policy"'));
  }
  const game = read(out('preview'), 'games/2026-10-17/index.html');
  assert.ok(game.includes('http-equiv="Content-Security-Policy"'));
  assert.ok(game.indexOf('Content-Security-Policy') < game.indexOf('<script'), 'policy precedes every script');
});

test('r5: no X/provider script, iframe, preconnect or prefetch exists in the initial HTML', () => {
  const game = read(out('preview'), 'games/2026-10-17/index.html');
  const withoutCsp = game.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
  assert.doesNotMatch(withoutCsp, /<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(withoutCsp, /<iframe|rel=["'](preconnect|dns-prefetch|preload|prefetch)["']|platform\.twitter\.com|widgets\.js|syndication/i);
  // the only external references are ordinary anchor links
  assert.deepEqual([...game.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]).sort(), [
    'https://twitter.com/FearedBuck/status/2111278238253342868',
    'https://twitter.com/FearedBuck/status/2111278238253342868',
  ]);
});

test('r5: copy — intro subheading, exact short instruction, placard, payoff punchline, automatic-embed notice and links', () => {
  const game = read(out('preview'), 'games/2026-10-17/index.html');
  for (const t of [
    'The headline lasted 30 seconds. Your rematch gets 30.',
    'Block the hit. Punch on COUNTER. KO Jack before time runs out.',
    '30-SECOND HEADLINE CHALLENGE',
    'Headline speedrun complete. The timeline can wait.',
    'Source post — FearedBuck',
    'This embedded post connects to X automatically. X may use cookies or other identifiers and download media.',
    'Source summary: FearedBuck reported a Jack Doherty knockout within the first 30 seconds at Brand Risk 16. Posted 17 October 2026, 02:08:52 UTC. This summary is not the embedded post.',
    'Try loading again',
    'Open source post on X',
  ]) assert.ok(game.includes(t), t);
  assert.equal((game.match(/Block the hit\. Punch on COUNTER\. KO Jack before time runs out\./g) || []).length, 2, 'Intro overlay and About only: no persistent instruction in the play layout');
  assert.ok(game.includes('<strong>PUNCH:</strong> Space / J · <strong>GUARD:</strong> hold K / Shift · Esc: Pause'));
  assert.ok(game.includes('<strong>PUNCH:</strong> tap · <strong>GUARD:</strong> hold'));
  assert.match(game, /<h2 id="intro-heading" class="intro-heading">Ready\?<\/h2>/);
  assert.match(game, /<button type="button" id="btn-start" class="btn primary start" aria-describedby="intro-goal intro-keys intro-touch">Start round<\/button>/);
  assert.ok(game.indexOf('id="panel-intro"') > game.indexOf('id="arena"') && game.indexOf('id="panel-intro"') < game.indexOf('id="cuebar"'), 'Intro lives inside the arena');
  assert.ok(!game.includes('instr-play') && !game.includes('data-open-about'));
  assert.equal((game.match(/id="btn-about"/g) || []).length, 1, 'one About control');
  assert.ok(game.indexOf('id="btn-about"') > game.indexOf('id="news"') && /<footer class="site-footer"><button type="button" id="btn-about"/.test(game), 'About is a normal-flow footer control after the news');
  const head = game.slice(game.indexOf('<header'), game.indexOf('</header>'));
  assert.doesNotMatch(head, /About|Block the hit|Unofficial creator-boxing|news-card|<h1/i, 'header has no About, tutorial, framing or title block');
  assert.ok(game.includes('The headline lasted 30 seconds. Your rematch gets 30.'), 'flavor line (About)');
  const intro = game.slice(game.indexOf('id="panel-intro"'), game.indexOf('</section>', game.indexOf('id="panel-intro"')));
  assert.doesNotMatch(intro, /Unofficial|About|The headline lasted|<a /, 'minimal overlay: goal, keys, touch, Start');
  assert.match(game, /GUARD <span class="ctl-sub">— hold<\/span>/);
  assert.match(game, /PUNCH <span class="ctl-sub">— tap<\/span>/);
  for (const gone of ['Load source post from X', 'You can read the source without loading the embed', 'Hold Guard for the wind-up. After the hit, tap Punch']) assert.ok(!game.includes(gone), `removed: ${gone}`);
  assert.match(game, /id="btn-retry-embed" class="btn" hidden/);
});

test('r5: stylesheet is flat — no gradients, shadows, glow, blur or translucent glass', () => {
  for (const f of ['games/2026-10-17/game.css', 'assets/site.css']) {
    const css = read(out('preview'), f);
    assert.doesNotMatch(css, /gradient|box-shadow|text-shadow|drop-shadow|backdrop-filter|filter:|blur\(/i, f);
    assert.doesNotMatch(css, /#[0-9a-f]{8}\b/i, `${f}: no alpha colors (glass)`);
  }
});

test('r6: real (empty) registry gives the preview candidate two genuinely disabled ends in the single compact header navigation', () => {
  const game = read(out('preview'), 'games/2026-10-17/index.html');
  assert.match(game, /<nav class="site-nav" aria-label="Game navigation">/);
  assert.equal((game.match(/<nav /g) || []).length, 1, 'one navigation region, no second toolbar');
  assert.equal((game.match(/<button type="button" class="gn-link" disabled/g) || []).length, 2);
  assert.doesNotMatch(game, /<a class="gn-link"/);
  assert.ok(game.includes('None earlier') && game.includes('None later'), 'compact visible labels');
  assert.ok(game.includes('No earlier released game') && game.includes('No later released game'), 'accessible full labels');
  assert.match(game, /← <\/span> Previous<span class="sr-only"> game<\/span>|<span aria-hidden="true">←<\/span> Previous<span class="sr-only"> game<\/span>/);
  assert.ok(game.indexOf('<header') < game.indexOf('<main') && game.indexOf('</header>') < game.indexOf('id="game"'), 'header above the play section');
  assert.doesNotMatch(read(out('public'), 'index.html'), /site-nav|game-nav/);
});

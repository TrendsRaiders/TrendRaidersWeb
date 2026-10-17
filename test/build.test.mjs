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
  assert.match(html, /17 Oct 2026 — Preview \(not released\)/);
  assert.match(html, /aria-current="page"[^>]*>17 Oct 2026/);
  assert.match(html, /class="preview-banner"[^>]*>Preview — not released/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<nav class="site-nav" aria-label="Game editions">/);
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
  assert.deepEqual(readdirSync(join(root, 'dist')).sort(), ['404.html', 'assets', 'build-manifest.json', 'index.html', 'styles.css']);
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

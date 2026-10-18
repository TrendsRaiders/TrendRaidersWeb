// Fly the Simulation: registry/build integration, preview vs public output, preserved boxing/scaffold artifacts, CSP,
// exact text contract. Everything here builds into temporary directories; nothing is published.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { build, CSP, CSP_DIRECTIVES, validateReleaseRegistry } from '../scripts/lib/build-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'tr-fly-build-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const read = (d, p) => readFileSync(join(d, p), 'utf8');
const sha = (p) => createHash('sha256').update(readFileSync(join(root, p))).digest('hex');
const walk = (d, base = d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n), base) : [join(d, n).slice(base.length + 1)]));
const pub = join(tmp, 'public'); const prev = join(tmp, 'preview');
before(async () => {
  await build({ mode: 'public', outDir: pub });
  await build({ mode: 'preview', outDir: prev });
});

test('public build: the released registry is empty, so root stays the scaffold and neither edition is published', () => {
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'releases', 'registry.json'), 'utf8')).editions, []);
  assert.match(read(pub, 'index.html'), /<h1>Hello, world!<\/h1>/);
  assert.equal(existsSync(join(pub, 'games')), false);
  const all = walk(pub).map((f) => read(pub, f)).join('\n');
  assert.doesNotMatch(all, /2026-10-18|Fly the Simulation|2026-10-17|30-Second/);
  assert.match(read(pub, '404.html'), /No game editions are released yet/);
  const man = JSON.parse(read(pub, 'build-manifest.json'));
  assert.equal(man.root, 'scaffold'); assert.deepEqual(man.releasedEditions, []); assert.deepEqual(man.previewEditions, []);
});

test('preview build: adds the 2026-10-18 candidate and keeps the boxing candidate; nothing is released', () => {
  const man = JSON.parse(read(prev, 'build-manifest.json'));
  assert.equal(man.mode, 'preview'); assert.deepEqual(man.releasedEditions, []); assert.deepEqual(man.previewEditions, ['2026-10-17', '2026-10-18']);
  assert.equal(man.root, 'preview-candidate');
  for (const f of ['index.html', 'game.css', 'js/main.js', 'js/engine.js', 'js/art.js', 'js/render.js', 'js/embed.js', 'js/share.js']) assert.ok(existsSync(join(prev, 'games', '2026-10-18', f)), f);
  assert.equal(existsSync(join(prev, 'games', '2026-10-18', 'edition.json')), false, 'edition.json is build input only');
  assert.ok(existsSync(join(prev, 'games', '2026-10-17', 'index.html')), 'boxing preview route preserved');
  assert.equal(read(prev, 'index.html'), read(prev, 'games/2026-10-18/index.html'), 'preview root opens the latest candidate');
  assert.ok(existsSync(join(prev, 'styles.css')), 'scaffold stylesheet still shipped');
  assert.doesNotMatch(read(prev, 'games/2026-10-18/index.html'), /\{\{/, 'no unfilled template placeholders');
});

test('direct route page is framed as a preview, never as released, and links no unreleased neighbor', () => {
  const html = read(prev, 'games/2026-10-18/index.html');
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<title>Fly the Simulation — Preview \(not released\)<\/title>/);
  assert.match(html, /<span class="preview-badge" role="note">Preview — not released<\/span>/);
  assert.match(html, /"shareUrl":null/);
  assert.match(html, /aria-current="page">18 Oct 2026<span class="pv"> — Preview \(not released\)<\/span>/);
  assert.equal((html.match(/data-gn="/g) || []).length, 2);
  assert.equal((html.match(/<a class="gn-link"/g) || []).length, 0, 'no enabled Previous/Next (neither neighbor is released)');
  assert.match(html, /<button type="button" class="gn-link" disabled data-gn="prev">/);
  assert.match(html, /<button type="button" class="gn-link" disabled data-gn="next">/);
  assert.match(html, /None earlier<span class="sr-only"> — No earlier released game<\/span>/);
  // the boxing candidate is only in the date chooser, labeled as a preview
  assert.match(html, /<details class="others">.*href="\/games\/2026-10-17\/">17 Oct 2026<span class="pv"> — Preview \(not released\)<\/span>/s);
  const box = read(prev, 'games/2026-10-17/index.html');
  assert.match(box, /href="\/games\/2026-10-18\/">18 Oct 2026<span class="pv"> — Preview \(not released\)<\/span>/);
  assert.equal((box.match(/<a class="gn-link"/g) || []).length, 0);
  assert.match(read(prev, '404.html'), /href="\/games\/2026-10-18\/">18 Oct 2026 — Preview \(not released\)/);
});

test('boxing edition, scaffold, release registry, shared build code and site CSS are preserved byte for byte', () => {
  const pinned = {
    'docs/thirty-second-ko.md': '945ada2327e9bc2981b5bfe8c1ee632bb021a9efba9d9ff7ab2825db128c1f38',
    'games/2026-10-17/edition.json': 'aeef498083d1cd221191ef6c22dc6646d4751ee4de4b7cc9bef171ba9e4ebf1f',
    'games/2026-10-17/game.css': '42d3d96089b193a3f023ef1abb1564f818a5ba39e84b0d34870cae7af1744e0a',
    'games/2026-10-17/index.html': '58c5d414834a56586eb41926e916247d8a094ad023f4fe7abd4685087643a71a',
    'games/2026-10-17/js/art.js': '484ab874a8dbe9704efb7dac464844e76a522bbbd9762334d262697eff165925',
    'games/2026-10-17/js/embed.js': '5d5662b41d41947620aa1a4c3114d6ef8db442d392be9f9db3e56d35222c0144',
    'games/2026-10-17/js/engine.js': 'a3a7dcb460381e633bd2217c435b45a11bc425a77e8d127edf047aabb3196fb7',
    'games/2026-10-17/js/main.js': 'd0b7a198c9069eb1a56a29b5f8d30e501c2fbdb7277eaac3602700da9ae36852',
    'games/2026-10-17/js/modal.js': 'f5e104fa22596e939e725007dcef10a4929325f723e6808270eb13221fd7508a',
    'games/2026-10-17/js/share.js': '04d21a063ed9895e26191aef1bd041ccffca3d2d031e96fd1246108a0ce7ec51',
    'public/index.html': '30336adeab1328b33f39f858663311a4dd9fcde02788b15762d1664755ee009d',
    'public/styles.css': '7eb90602b2dcd8a66eff78ca5371ff87adc70d9287593daff88213d2dda43b4b',
    'releases/registry.json': '9e4d1f778021927463eeef76e90018f1e809bd20674359605b0847144544f937',
    'scripts/lib/build-lib.mjs': '3b30b12b2af5baf7dd7367bc45119d3fb601ebc66811882f8eae5c683fcd6591',
    'site/site.css': '5991ffd6be16f0687a9dfd3318104f584af5dbc49798675f39a23f735accfad5',
  };
  for (const [f, h] of Object.entries(pinned)) assert.equal(sha(f), h, `${f} changed`);
  // and the shipped boxing assets equal their sources; boxing keeps its 10 s embed timeout
  for (const f of ['game.css', 'js/art.js', 'js/embed.js', 'js/engine.js', 'js/main.js', 'js/modal.js', 'js/share.js']) assert.equal(read(prev, `games/2026-10-17/${f}`), read(root, `games/2026-10-17/${f}`), f);
  assert.match(read(prev, 'games/2026-10-17/js/embed.js'), /LOAD_TIMEOUT_MS = 10000/);
  assert.match(read(prev, 'games/2026-10-18/js/embed.js'), /LOAD_TIMEOUT_MS = 8000/);
});

test('CSP is unchanged and not expanded: same directives, provider hosts only platform.twitter.com, header equals meta', () => {
  assert.equal(CSP, "default-src 'self'; script-src 'self' https://platform.twitter.com; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src https://platform.twitter.com; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
  assert.equal(CSP_DIRECTIVES.length, 11);
  const headers = read(prev, '_headers');
  assert.match(headers, new RegExp(`Content-Security-Policy: ${CSP.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}; frame-ancestors 'none'`));
  const html = read(prev, 'games/2026-10-18/index.html');
  const meta = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/) || [])[1].replace(/&#39;/g, "'");
  assert.equal(meta, CSP);
  assert.doesNotMatch(CSP, /unsafe|\*/);
  assert.equal(read(prev, '_headers'), read(pub, '_headers'));
});

test('page text contract: recap, dates, sources, disclosure, intro strings, footer About, no About in the header', () => {
  const html = read(prev, 'games/2026-10-18/index.html');
  const text = (s) => assert.ok(html.includes(s), `missing: ${s}`);
  text('<h2 id="news-heading">News behind the game</h2>');
  text('Source date 17 October 2026; edition 18 October 2026 UTC');
  text('On 17 October, Odyssey said it had placed a fruit-fly brain inside its Odyssey-3 world model and showed a demo it described as a fly navigating imagined worlds. CEO Oliver Cameron shared the demo with “Fly free lil’ buddy.” This game turns that premise into a fictional cartoon obstacle course: the rebuilding walls, banana escape and desktop reveal are our joke, not claims about the experiment.');
  text('href="https://twitter.com/odysseyml/status/2111589148146749616"');
  text('href="https://twitter.com/olivercameron/status/2111589310571147464"');
  text('2026-10-17 22:44:19 UTC'); text('2026-10-17 22:44:57 UTC');
  text('Official X post — loading may contact X and its media services and share network/device identifiers.');
  text('Reach the banana. Follow the dashed gap when the world rebuilds.');
  text('↑/↓ or W/S: steer'); text('Hold ▲ / ▼ to steer'); text('>Start</button>');
  text('Fly up</button>'); text('Fly down</button>');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.doesNotMatch(header, /About/);
  assert.match(html, /<footer class="site-footer"><a id="link-about" class="footer-link" href="#about">About<\/a><\/footer>/);
  assert.ok(html.indexOf('id="news"') > html.indexOf('id="game"') && html.indexOf('id="news"') > html.indexOf('</section>', html.indexOf('id="game"')), 'News follows the game');
  assert.equal((html.match(/<nav /g) || []).length, 1);
  // the embed is only in News, never inside the arena or intro
  const arena = html.slice(html.indexOf('id="arena"'), html.indexOf('id="steer"'));
  assert.doesNotMatch(arena, /embed|twitter|iframe|widgets/);
  assert.doesNotMatch(html, /<iframe|rel="(preconnect|dns-prefetch|preload)"|<script[^>]+src="https?:/);
  assert.doesNotMatch(html, /Odyssey[- ]?logo|odyssey\.(ml|world)/i);
});

test('steering/utility markup contract: dedicated hold buttons, utilities outside the play region, no Pause over the arena', () => {
  const html = read(prev, 'games/2026-10-18/index.html');
  const region = html.slice(html.indexOf('id="play-region"'), html.indexOf('id="utils"'));
  assert.match(region, /id="btn-up"/); assert.match(region, /id="btn-down"/);
  assert.doesNotMatch(region, /btn-pause|id="btn-restart"/, 'Pause/Restart are outside the steering/pointer-capture region');
  const arena = html.slice(html.indexOf('id="arena"'), html.indexOf('id="steer"'));
  assert.doesNotMatch(arena, /id="btn-pause"|id="btn-up"|id="btn-down"|id="btn-restart"/);
  assert.match(html, /id="panel-intro"[^>]*aria-labelledby="intro-heading"/);
  assert.doesNotMatch(html, /aria-modal|role="dialog"|autofocus/, 'nonmodal in-arena sections; no focus trap, no autofocus');
});

test('isolated fixture: when (and only when) a release registry lists it, the edition is exposed with a share URL and real neighbors', async () => {
  const reg = join(tmp, 'reg.json');
  const entry = (date) => ({ date, verified: true, sha: 'abc1234', origin: 'https://games.example.test', verification: 'fixture-only (fly build test)' });
  writeFileSync(reg, JSON.stringify({ schema: 1, editions: [entry('2026-10-17'), entry('2026-10-18')] }));
  validateReleaseRegistry(JSON.parse(readFileSync(reg, 'utf8')));
  const dist = join(tmp, 'fixture-released');
  const man = await build({ mode: 'public', outDir: dist, releaseRegistry: reg });
  assert.equal(man.root, 'latest-released');
  const html = read(dist, 'games/2026-10-18/index.html');
  assert.match(html, /"shareUrl":"https:\/\/games\.example\.test\/games\/2026-10-18\/"/);
  assert.doesNotMatch(html, /Preview|noindex/);
  assert.match(html, /<a class="gn-link" href="\/games\/2026-10-17\/" data-gn="prev">/);
  assert.match(html, /<button type="button" class="gn-link" disabled data-gn="next">/);
  assert.equal(read(dist, 'index.html'), html, 'root = latest released edition');
});

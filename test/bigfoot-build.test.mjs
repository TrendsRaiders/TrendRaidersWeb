// Bigfoot: Take Two: build/registry integration, preservation of the earlier editions and registry, exact copy contract,
// no third-party assets, embed constants. Everything builds into temporary directories; nothing is published.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from '../scripts/lib/build-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'tr-bigfoot-build-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const read = (d, p) => readFileSync(join(d, p), 'utf8');
const walk = (d, base = d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n), base) : [join(d, n).slice(base.length + 1)]));
const prev = join(tmp, 'preview'); const pub = join(tmp, 'public');
before(async () => {
  await build({ mode: 'preview', outDir: prev });
  await build({ mode: 'public', outDir: pub });
});

test('preview registry lists the candidate; the released registry is untouched (two pending boxing/Fly candidates only)', () => {
  const pv = JSON.parse(readFileSync(join(root, 'preview', 'registry.json'), 'utf8'));
  assert.deepEqual(pv.editions.map((e) => e.date), ['2026-10-17', '2026-10-18', '2026-10-19']);
  const reg = JSON.parse(readFileSync(join(root, 'releases', 'registry.json'), 'utf8'));
  assert.deepEqual(reg.editions.map((e) => e.date), ['2026-10-17', '2026-10-18'], 'Bigfoot is not in the released registry');
  assert.ok(reg.editions.every((e) => e.verified === false));
});

test('preview build: /games/2026-10-19/ exists as a labeled, noindex, link-free candidate preview', () => {
  const man = JSON.parse(read(prev, 'build-manifest.json'));
  assert.deepEqual(man.previewEditions, ['2026-10-17', '2026-10-18', '2026-10-19']);
  assert.deepEqual(man.releasedEditions, []);
  for (const f of ['index.html', 'game.css', 'js/main.js', 'js/engine.js', 'js/art.js', 'js/render.js', 'js/embed.js', 'js/share.js']) assert.ok(existsSync(join(prev, 'games', '2026-10-19', f)), f);
  assert.equal(existsSync(join(prev, 'games', '2026-10-19', 'edition.json')), false);
  const html = read(prev, 'games/2026-10-19/index.html');
  assert.doesNotMatch(html, /\{\{/);
  assert.match(html, /<title>Bigfoot: Take Two — Preview \(not released\)<\/title>/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<span class="preview-badge" role="note">Preview — not released<\/span>/);
  assert.match(html, /"shareUrl":null/);
  assert.match(html, /aria-current="page">19 Oct 2026<span class="pv"> — Preview \(not released\)<\/span>/);
  assert.equal((html.match(/<a class="gn-link"/g) || []).length, 0, 'no enabled Previous/Next: neither neighbor is released');
  assert.match(html, /<button type="button" class="gn-link" disabled data-gn="prev">/);
  assert.match(html, /<button type="button" class="gn-link" disabled data-gn="next">/);
  assert.equal(read(prev, 'index.html'), html, 'preview root opens the latest staged candidate');
  assert.match(read(prev, '404.html'), /href="\/games\/2026-10-19\/">19 Oct 2026 — Preview \(not released\)/);
});

test('public build does not publish Bigfoot: it is not in the release registry', () => {
  assert.equal(existsSync(join(pub, 'games', '2026-10-19')), false);
  const all = walk(pub).filter((f) => /\.(html|json|js|css)$/.test(f)).map((f) => read(pub, f)).join('\n');
  assert.doesNotMatch(all, /Bigfoot|2026-10-19/);
  assert.deepEqual(JSON.parse(read(pub, 'build-manifest.json')).releasedEditions.map((e) => e.date), ['2026-10-17', '2026-10-18']);
});

test('earlier editions, shared build code, site CSS and registries are unchanged from HEAD', () => {
  const diff = execFileSync('git', ['diff', '--stat', 'HEAD', '--', 'games/2026-10-17', 'games/2026-10-18', 'releases/registry.json', 'site/site.css', 'scripts/lib/build-lib.mjs', 'public'], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(diff, '', 'no tracked change to the boxing/Fly editions, release registry, build library, site CSS or scaffold');
});

test('exact copy contract: intro, news recap, privacy notice, fallback, captions, share text', () => {
  const html = readFileSync(join(root, 'games/2026-10-19/index.html'), 'utf8');
  for (const s of [
    'Get 4 of 5 usable shots.', 'The monster walks. Tap POSE when its feet reach the tape. Space / Enter or the POSE button.',
    'On October 18, 2026, Variety posted a review of Marq Evans’s documentary <em>Capturing Bigfoot</em>. Film accounts also circulated claims of rehearsal footage; those claims are not an independently established verdict on the historical film. Our cardboard forest and homemade monster are fictional: your job is simply to get a usable take.',
    'Official X embed loads automatically. X may receive your IP address and browser/device identifiers and request media. The game works without it.',
    'https://twitter.com/Variety/status/2111896526234505466', 'https://twitter.com/TheCinesthetic/status/2111938893193023829',
    '2026-10-18T19:05:43Z', '2026-10-18T21:54:04Z', '<h2 id="news-heading">News behind the game</h2>',
  ]) assert.ok(html.includes(s), s);
  const main = readFileSync(join(root, 'games/2026-10-19/js/main.js'), 'utf8');
  assert.ok(main.includes('Usable take! A legend is born. It needs a sandwich.'));
  assert.ok(main.includes('Back to rehearsal. The trees are on hourly rates.'));
  assert.ok(main.includes('a sign reading FOREST — FLAT PACK'));
  assert.doesNotMatch(html, /officially confirmed hoax/i);
  assert.doesNotMatch(html, /tracker-free|no tracking/i);
});

test('embed: one Variety post, 6000 ms timeout, spec failure text, official widgets.js only (reviewed CSP unchanged)', () => {
  const e = readFileSync(join(root, 'games/2026-10-19/js/embed.js'), 'utf8');
  assert.match(e, /TWEET_ID = '2111896526234505466'/);
  assert.match(e, /LOAD_TIMEOUT_MS = 6000/);
  assert.match(e, /failed: 'X embed unavailable — read the source on X'/);
  assert.match(e, /WIDGETS_SRC = 'https:\/\/platform\.twitter\.com\/widgets\.js'/);
  assert.doesNotMatch(e, /setInterval|retry\(|2111938893193023829/);
});

test('no third-party assets: the edition references only same-origin files and the two source links / the official widget', () => {
  for (const f of walk(join(root, 'games', '2026-10-19'))) {
    const txt = readFileSync(join(root, 'games', '2026-10-19', f), 'utf8');
    const urls = txt.match(/https?:\/\/[^\s"'`)<>]+/g) || [];
    for (const u of urls) assert.match(u, /^https:\/\/(twitter\.com\/(Variety|TheCinesthetic)\/status\/\d+|platform\.twitter\.com\/widgets\.js)$/, `${f}: ${u}`);
    assert.doesNotMatch(txt, /@font-face|url\(|<img|<audio|<video|fetch\(|XMLHttpRequest|new Image\(/, f);
  }
  assert.deepEqual(readdirSync(join(root, 'games', '2026-10-19')).sort(), ['edition.json', 'game.css', 'index.html', 'js']);
});

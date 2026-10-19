// PUBLIC-mode two-edition release candidate (17 Oct boxing + 18 Oct Fly). Builds into temp dirs; nothing is published.
// The registry entries are pending candidates, not verified releases: these tests check the staged artifact only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { build, validateReleaseRegistry, gameNeighbors } from '../scripts/lib/build-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'tr-public-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const read = (d, p) => readFileSync(join(d, p), 'utf8');
const walk = (d, base = d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n), base) : [join(d, n).slice(base.length + 1)]));
const pub = join(tmp, 'public'); const prev = join(tmp, 'preview');
const ORIGIN = 'https://empty-site-7f987b.netlify.app';
before(async () => {
  await build({ mode: 'public', outDir: pub });
  await build({ mode: 'preview', outDir: prev });
});

const cand = (date, extra = {}) => ({ date, verified: false, status: 'candidate-pending-approval', sourceSha: 'a'.repeat(40), origin: ORIGIN, approval: 'pending: not approved', ...extra });

test('candidate registry validation: pending form only, no release timestamps, full source SHA, https origin', () => {
  assert.doesNotThrow(() => validateReleaseRegistry({ schema: 1, editions: [cand('2026-10-17')] }));
  for (const bad of [
    cand('2026-10-17', { status: 'released' }),
    cand('2026-10-17', { sourceSha: 'abc1234' }),
    cand('2026-10-17', { approval: 'approved by someone' }),
    cand('2026-10-17', { approval: '' }),
    cand('2026-10-17', { releasedAt: '2026-10-18T00:00:00Z' }),
    cand('2026-10-17', { publishedAt: 'x' }),
    cand('2026-10-17', { origin: 'http://x.test' }),
  ]) assert.throws(() => validateReleaseRegistry({ schema: 1, editions: [bad] }), /release registry/);
  assert.throws(() => validateReleaseRegistry({ schema: 1, editions: [{ date: '2026-10-17', verified: false, origin: ORIGIN }] }), /release registry/);
});

test('public manifest: mode public, both candidates listed with pending status and NO timestamps, root = latest edition, no preview editions', () => {
  const m = JSON.parse(read(pub, 'build-manifest.json'));
  assert.equal(m.mode, 'public'); assert.equal(m.root, 'latest-released'); assert.deepEqual(m.previewEditions, []);
  assert.deepEqual(m.releasedEditions.map((e) => [e.date, e.status, e.origin]), [['2026-10-17', 'candidate-pending-approval', ORIGIN], ['2026-10-18', 'candidate-pending-approval', ORIGIN]]);
  assert.deepEqual(JSON.stringify(m).match(/released_?at|publishedAt|releasedAt/gi), null);
});

test('public output: root is byte-identical to the latest edition (Fly); both dated routes, scaffold CSS, 404 and _headers exist; no preview framing', () => {
  assert.equal(read(pub, 'index.html'), read(pub, 'games/2026-10-18/index.html'));
  assert.notEqual(read(pub, 'index.html'), read(pub, 'games/2026-10-17/index.html'));
  for (const f of ['styles.css', '404.html', '_headers', 'assets/site.css', 'games/2026-10-17/index.html', 'games/2026-10-18/index.html']) assert.ok(existsSync(join(pub, f)), f);
  for (const f of walk(pub).filter((x) => /\.(html|js)$/.test(x))) assert.doesNotMatch(read(pub, f), /preview-badge|Preview — not released|Preview \(not released\)/, f);
  for (const f of walk(pub).filter((x) => /\.html$/.test(x) && x !== '404.html')) assert.doesNotMatch(read(pub, f), /name="robots" content="noindex"/, `${f}: public pages are indexable (only the 404 is noindex)`);
  for (const f of ['games/2026-10-17/index.html', 'games/2026-10-18/index.html']) assert.doesNotMatch(read(pub, f), /\{\{\w+\}\}/);
});

test('public nav: selected date aria-current, released neighbors link each other with stable dated routes, skipping nothing that exists and linking nothing that does not', () => {
  const box = read(pub, 'games/2026-10-17/index.html'); const fly = read(pub, 'games/2026-10-18/index.html');
  assert.match(box, /<a class="date-link" href="\/games\/2026-10-17\/" aria-current="page">17 Oct 2026</);
  assert.match(fly, /<a class="date-link" href="\/games\/2026-10-18\/" aria-current="page">18 Oct 2026</);
  assert.match(box, /<a class="gn-link" href="\/games\/2026-10-18\/" data-gn="next">/);
  assert.match(box, /<button type="button" class="gn-link" disabled data-gn="prev">[\s\S]*None earlier/);
  assert.match(fly, /<a class="gn-link" href="\/games\/2026-10-17\/" data-gn="prev">/);
  assert.match(fly, /<button type="button" class="gn-link" disabled data-gn="next">[\s\S]*None later/);
  assert.match(box, /<details class="others">[\s\S]*href="\/games\/2026-10-18\/"/);
  assert.doesNotMatch(box + fly, /href="\/games\/2026-10-1[0-6,9]/);
});

test('neighbor rule skips missing days (fixture only) and never uses a candidate/preview as a destination', () => {
  const e = (d, preview = false) => ({ date: d, preview });
  assert.deepEqual(gameNeighbors([e('2026-10-03'), e('2026-10-17'), e('2026-10-24')], '2026-10-17'), { prev: '2026-10-03', next: '2026-10-24' });
  assert.deepEqual(gameNeighbors([e('2026-10-17'), e('2026-10-18', true)], '2026-10-17'), { prev: null, next: null });
});

test('sharing configuration: public pages carry the stable DATED production URL (never root, draft or preview); preview pages stay link-free', () => {
  const cfg = (html) => JSON.parse(html.match(/id="site-config">([^<]*)</)[1]);
  assert.deepEqual(cfg(read(pub, 'games/2026-10-17/index.html')), { mode: 'public', date: '2026-10-17', preview: false, shareUrl: `${ORIGIN}/games/2026-10-17/` });
  assert.deepEqual(cfg(read(pub, 'games/2026-10-18/index.html')), { mode: 'public', date: '2026-10-18', preview: false, shareUrl: `${ORIGIN}/games/2026-10-18/` });
  assert.equal(cfg(read(pub, 'index.html')).shareUrl, `${ORIGIN}/games/2026-10-18/`, 'root shares the dated route, not the root');
  for (const d of ['2026-10-17', '2026-10-18']) { const c = cfg(read(prev, `games/${d}/index.html`)); assert.equal(c.shareUrl, null); assert.equal(c.preview, true); assert.match(read(prev, `games/${d}/index.html`), /name="robots" content="noindex"/); }
});

test('preview build ignores pending candidates: both editions stay labeled preview, noindex, link-free; root is the latest preview candidate', () => {
  const m = JSON.parse(read(prev, 'build-manifest.json'));
  assert.deepEqual([m.mode, m.root, m.releasedEditions, m.previewEditions], ['preview', 'preview-candidate', [], ['2026-10-17', '2026-10-18', '2026-10-19']]);
});

test('game files are byte-identical in the public artifact: every non-template asset equals its source, and the shipped HTML only differs by the template placeholders', () => {
  for (const d of ['2026-10-17', '2026-10-18']) {
    for (const f of walk(join(root, 'games', d)).filter((x) => x !== 'index.html' && x !== 'edition.json')) assert.equal(read(pub, `games/${d}/${f}`), readFileSync(join(root, 'games', d, f), 'utf8'), `${d}/${f}`);
    const tpl = readFileSync(join(root, 'games', d, 'index.html'), 'utf8');
    const built = read(pub, `games/${d}/index.html`);
    // the body below the injected header is the template verbatim
    const tail = (h) => h.slice(h.indexOf('<main'));
    assert.equal(tail(built), tail(tpl).replace('{{gamenav}}', ''), `${d} main content untouched`);
  }
});

test('game source files are unchanged from the baselines (git, not hashes copied into the test)', async () => {
  const { execFileSync } = await import('node:child_process');
  const diff = (base, d) => execFileSync('git', ['diff', '--stat', base, '--', `games/${d}`], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(diff('b7321bab07dc8fd21df0207d747dbdfa4d8e5acf', '2026-10-17'), '');
  assert.equal(diff('b7321bab07dc8fd21df0207d747dbdfa4d8e5acf', '2026-10-18'), '');
  assert.equal(diff('ef20ccb392005e0aef4325d4ede356cf79d571d9', '2026-10-18'), '');
});

test('unknown date is a genuine 404 page listing the two available editions only', () => {
  const nf = read(pub, '404.html');
  assert.match(nf, /Page not found/);
  assert.match(nf, /href="\/games\/2026-10-17\/"/); assert.match(nf, /href="\/games\/2026-10-18\/"/);
  assert.doesNotMatch(nf, /Preview|2026-10-19/);
});

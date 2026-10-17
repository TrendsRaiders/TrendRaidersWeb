// Release gate, archive preservation (isolated nonpublic fixture) and routing against a Netlify-like static host.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, cpSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { build, validateReleaseRegistry } from '../scripts/lib/build-lib.mjs';
import { serve } from './helpers/static-server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'tr-release-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const good = (date, extra = {}) => ({ date, verified: true, sha: 'abc1234', origin: 'https://games.example.test', verification: 'fixture-only', ...extra });

// Isolated fixture archive: NOT a real release. A fake earlier edition plus the real candidate source.
const gamesDir = join(tmp, 'games');
mkdirSync(join(gamesDir, '2026-01-05'), { recursive: true });
writeFileSync(join(gamesDir, '2026-01-05', 'edition.json'), JSON.stringify({ date: '2026-01-05', title: 'Fixture Game', description: 'fixture' }));
writeFileSync(join(gamesDir, '2026-01-05', 'index.html'), '<!doctype html><html lang="en"><head><title>{{title}}</title><script type="application/json" id="site-config">{{config}}</script></head><body>{{banner}}{{nav}}<main><h1>Fixture Game</h1><script src="/games/2026-01-05/app.js"></script></main></body></html>');
writeFileSync(join(gamesDir, '2026-01-05', 'app.js'), 'window.fixturePlayed = true;');
cpSync(join(root, 'games', '2026-10-17'), join(gamesDir, '2026-10-17'), { recursive: true });

const registry = (editions) => {
  const p = join(tmp, `reg-${editions.map((e) => e.date).join('_') || 'empty'}.json`);
  writeFileSync(p, JSON.stringify({ schema: 1, editions }));
  return p;
};
const read = (d, p) => readFileSync(join(d, p), 'utf8');

test('registry validation rejects unverified or incomplete entries', () => {
  assert.doesNotThrow(() => validateReleaseRegistry({ schema: 1, editions: [good('2026-01-05')] }));
  for (const bad of [
    good('2026-01-05', { verified: false }),
    good('2026-01-05', { verified: 'yes' }),
    good('2026-01-05', { sha: '' }),
    good('2026-01-05', { origin: 'http://insecure.test' }),
    good('2026-01-05', { origin: 'https://x.test/games/' }),
    good('2026-01-05', { verification: '' }),
    good('Jan 5'),
  ]) assert.throws(() => validateReleaseRegistry({ schema: 1, editions: [bad] }), /release registry/);
  assert.throws(() => validateReleaseRegistry({ schema: 1, editions: [good('2026-01-05'), good('2026-01-05')] }), /duplicate/);
});

test('registry entry without edition source fails the build', async () => {
  await assert.rejects(build({ outDir: join(tmp, 'x'), gamesDir, releaseRegistry: registry([good('2026-02-02')]) }), /missing source/);
});

test('fixture archive: released-only navigation, root = latest released, candidate stays hidden in public mode', async () => {
  const dist = join(tmp, 'archive-a');
  const m = await build({ outDir: dist, gamesDir, releaseRegistry: registry([good('2026-01-05')]), previewRegistry: join(root, 'preview', 'registry.json') });
  assert.equal(m.root, 'latest-released');
  assert.ok(existsSync(join(dist, 'games/2026-01-05/app.js')));
  assert.equal(existsSync(join(dist, 'games/2026-10-17')), false, 'candidate not published without release entry');
  const page = read(dist, 'games/2026-01-05/index.html');
  assert.match(page, /aria-current="page">5 Jan 2026</);
  assert.doesNotMatch(page, /2026-10-17|Preview/);
  assert.equal(read(dist, 'index.html'), page);
});

test('fixture archive: older routes are byte-identical after a later edition is released; share link only when released', async () => {
  const before = join(tmp, 'archive-b1');
  const after2 = join(tmp, 'archive-b2');
  await build({ outDir: before, gamesDir, releaseRegistry: registry([good('2026-01-05')]) });
  const m = await build({ outDir: after2, gamesDir, releaseRegistry: registry([good('2026-01-05'), good('2026-10-17')]) });
  assert.equal(m.root, 'latest-released');
  assert.equal(read(after2, 'games/2026-01-05/app.js'), read(before, 'games/2026-01-05/app.js'));
  const old = read(after2, 'games/2026-01-05/index.html');
  assert.match(old, /<a href="\/games\/2026-10-17\/">17 Oct 2026<\/a>/); // nav gains the new date...
  assert.match(old, /"shareUrl":"https:\/\/games\.example\.test\/games\/2026-01-05\/"/);
  const game = read(after2, 'games/2026-10-17/index.html');
  assert.match(game, /"shareUrl":"https:\/\/games\.example\.test\/games\/2026-10-17\/"/);
  assert.doesNotMatch(game, /Preview/);
  assert.equal(read(after2, 'index.html'), game);
});

test('preview build keeps released editions and adds the candidate separately (never as released)', async () => {
  const dist = join(tmp, 'archive-c');
  const m = await build({ mode: 'preview', outDir: dist, gamesDir, releaseRegistry: registry([good('2026-01-05')]), previewRegistry: join(root, 'preview', 'registry.json') });
  assert.deepEqual(m.previewEditions, ['2026-10-17']);
  const game = read(dist, 'games/2026-10-17/index.html');
  assert.match(game, /"shareUrl":null/);
  assert.match(game, /Preview — not released/);
  assert.match(game, /<a href="\/games\/2026-01-05\/">5 Jan 2026<\/a>/);
  assert.doesNotMatch(read(dist, 'games/2026-01-05/index.html'), /aria-current="page">17/);
});

test('static host: direct routes, trailing-slash redirect, honest 404 for unknown dates', async () => {
  const dist = join(tmp, 'archive-d');
  await build({ mode: 'preview', outDir: dist, gamesDir, releaseRegistry: registry([good('2026-01-05')]), previewRegistry: join(root, 'preview', 'registry.json') });
  const host = await serve(dist);
  try {
    const ok = await fetch(`${host.origin}/games/2026-10-17/`);
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /30-Second KO/);
    const redirected = await fetch(`${host.origin}/games/2026-10-17`, { redirect: 'manual' });
    assert.equal(redirected.status, 301);
    const unknown = await fetch(`${host.origin}/games/2026-10-18/`);
    assert.equal(unknown.status, 404);
    const body = await unknown.text();
    assert.match(body, /Page not found/);
    assert.match(body, /href="\/games\/2026-01-05\/"/);
    assert.doesNotMatch(body, /30-Second KO game|<h1>30-Second KO/);
    assert.equal((await fetch(`${host.origin}/games/2026-10-17/js/main.js`)).status, 200);
  } finally { await host.close(); }
});

// ---- r4: Previous/Next from the verified released registry only ----------------------------------
import { gameNeighbors } from '../scripts/lib/build-lib.mjs';
const rel = (...d) => d.map((date) => ({ date, preview: false }));
const prv = (...d) => d.map((date) => ({ date, preview: true }));

test('gameNeighbors: none, current only, sparse, unrelated previews', () => {
  assert.deepEqual(gameNeighbors([], '2026-10-17'), { prev: null, next: null });
  assert.deepEqual(gameNeighbors(prv('2026-10-17'), '2026-10-17'), { prev: null, next: null });
  assert.deepEqual(gameNeighbors(rel('2026-10-17'), '2026-10-17'), { prev: null, next: null }, 'current only: no self link');
  assert.deepEqual(gameNeighbors([...rel('2026-10-03', '2026-10-10', '2026-10-24', '2026-11-30'), ...prv('2026-10-17')], '2026-10-17'),
    { prev: '2026-10-10', next: '2026-10-24' }, 'nearest released neighbors, gaps skipped, candidate never a destination');
  assert.deepEqual(gameNeighbors([...rel('2026-10-10'), ...prv('2026-10-12', '2026-10-17', '2026-10-20')], '2026-10-17'),
    { prev: '2026-10-10', next: null }, 'unrelated previews are never linked');
  assert.deepEqual(gameNeighbors(rel('2026-10-10', '2026-10-24'), '2026-10-10'), { prev: null, next: '2026-10-24' });
  assert.deepEqual(gameNeighbors(rel('2026-10-10', '2026-10-24'), '2026-10-24'), { prev: '2026-10-10', next: null });
});

test('r4: built pages link exact neighbor routes with date text and disable genuine ends (fixtures only)', async () => {
  for (const d of ['2026-10-10', '2026-10-24']) {
    mkdirSync(join(gamesDir, d), { recursive: true });
    writeFileSync(join(gamesDir, d, 'edition.json'), JSON.stringify({ date: d, title: `Fixture ${d}`, description: 'fixture' }));
    writeFileSync(join(gamesDir, d, 'index.html'), '<!doctype html><html lang="en"><head><title>{{title}}</title></head><body>{{nav}}{{gamenav}}<main><h1>Fixture</h1></main></body></html>');
  }
  const previewReg = join(tmp, 'preview-sparse.json');
  writeFileSync(previewReg, JSON.stringify({ schema: 1, editions: [{ date: '2026-10-17' }, { date: '2026-10-20' }] }));
  mkdirSync(join(gamesDir, '2026-10-20'), { recursive: true });
  writeFileSync(join(gamesDir, '2026-10-20', 'edition.json'), JSON.stringify({ date: '2026-10-20', title: 'Unrelated preview', description: 'x' }));
  writeFileSync(join(gamesDir, '2026-10-20', 'index.html'), '<html><body>{{nav}}{{gamenav}}</body></html>');
  const dist = join(tmp, 'archive-nav');
  await build({ mode: 'preview', outDir: dist, gamesDir, releaseRegistry: registry([good('2026-10-10'), good('2026-10-24')]), previewRegistry: previewReg });
  const cand = read(dist, 'games/2026-10-17/index.html');
  assert.match(cand, /<a class="gn-link" href="\/games\/2026-10-10\/" data-gn="prev"><span class="gn-text"><span aria-hidden="true">←<\/span> Previous game<\/span> <small>10 Oct 2026<\/small><\/a>/);
  assert.match(cand, /<a class="gn-link" href="\/games\/2026-10-24\/" data-gn="next"><span class="gn-text">Next game <span aria-hidden="true">→<\/span><\/span> <small>24 Oct 2026<\/small><\/a>/);
  assert.doesNotMatch(cand, /href="\/games\/2026-10-20\/" data-gn/, 'unrelated preview is not a destination');
  const first = read(dist, 'games/2026-10-10/index.html');
  assert.match(first, /<button type="button" class="gn-link" disabled data-gn="prev">/);
  assert.match(first, /No earlier released game/);
  assert.match(first, /<a class="gn-link" href="\/games\/2026-10-24\/" data-gn="next">/, 'later released edition still reachable; candidate 17th is not');
  const last = read(dist, 'games/2026-10-24/index.html');
  assert.match(last, /href="\/games\/2026-10-10\/" data-gn="prev"/);
  assert.match(last, /<button type="button" class="gn-link" disabled data-gn="next">/);
  assert.match(last, /No later released game/);
});

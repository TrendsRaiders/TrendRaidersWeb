import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

before(() => {
  execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')], { stdio: 'pipe' });
});

test('build outputs only public assets', () => {
  assert.deepEqual(readdirSync(dist).sort(), readdirSync(join(root, 'public')).sort());
});

test('index.html has required structure', () => {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<title>[^<]*Trend Raiders[^<]*<\/title>/);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
  assert.match(html, /<h1>Hello, world!<\/h1>/);
  assert.match(html, /<main>/);
});

test('page references no remote assets and local stylesheet exists', () => {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /(src|href)=["']?(https?:)?\/\//);
  assert.ok(existsSync(join(dist, 'styles.css')));
  assert.doesNotMatch(readFileSync(join(dist, 'styles.css'), 'utf8'), /https?:\/\/|@import/);
});

test('netlify config builds to dist without production settings', () => {
  const toml = readFileSync(join(root, 'netlify.toml'), 'utf8');
  assert.match(toml, /command = "npm run build"/);
  assert.match(toml, /publish = "dist"/);
});

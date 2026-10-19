// Fly the Simulation art: original authored sprites, body/core containment, distinct frames, scale rules, no remote assets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as art from '../games/2026-10-18/js/art.js';
import { CFG } from '../games/2026-10-18/js/engine.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'games', '2026-10-18');
const opaque = (def, x, y) => def.rows[y][x] !== '.';

test('every sprite and tile is a clean rectangle that only uses declared colours', () => {
  const defs = { FLY_A: art.FLY_A, FLY_B: art.FLY_B, BANANA: art.BANANA, ICON: art.ICON, ICON_BITTEN: art.ICON_BITTEN, ARROW_UP: art.ARROW_UP, ARROW_DOWN: art.ARROW_DOWN, BURST: art.BURST };
  for (const t of Object.values(art.THEMES)) { defs[`${t.label} bg`] = t.bg; defs[`${t.label} wall`] = t.wall; }
  for (const [name, def] of Object.entries(defs)) {
    const { w, h } = art.validateSprite(def);
    assert.ok(w > 0 && h > 0, name);
    const r = art.rasterize(def);
    for (let i = 3; i < r.data.length; i += 4) assert.ok(r.data[i] === 0 || r.data[i] === 255, `${name}: no alpha blending`);
  }
  for (const t of Object.values(art.THEMES)) { assert.deepEqual([art.validateSprite(t.bg).w, art.validateSprite(t.bg).h], [8, 8]); assert.deepEqual([art.validateSprite(t.wall).w, art.validateSprite(t.wall).h], [8, 8]); }
});

test('the fly is a 17x13 authored sprite; the 9x7 collision-body block is fully opaque body (wings/antennae/legs are decoration)', () => {
  assert.deepEqual([art.validateSprite(art.FLY_A).w, art.validateSprite(art.FLY_A).h], [17, 13]);
  for (const def of [art.FLY_A, art.FLY_B]) {
    const b = art.FLY_BODY;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      assert.ok(opaque(def, x, y), `body pixel ${x},${y}`);
      assert.ok('obsrebs'.includes(def.rows[y][x]), `body pixel ${x},${y} must not be wing/antenna/leg (${def.rows[y][x]})`);
    }
    // wings, antennae and legs exist outside the body block
    const outside = def.rows.flatMap((row, y) => [...row].map((c, x) => [c, x, y])).filter(([c, x, y]) => c !== '.' && (x < b.x || x >= b.x + b.w || y < b.y || y >= b.y + b.h));
    assert.ok(outside.some(([c]) => c === 'w' || c === 'W'), 'wings');
    assert.ok(outside.some(([c]) => c === 'a'), 'antennae');
  }
  assert.notEqual(art.spriteHash(art.FLY_A), art.spriteHash(art.FLY_B), 'two wing frames');
});

test('integer sprite scale always makes the body block contain the collision core, at every named and many other arena sizes', () => {
  const sizes = [[1100, 528], [296, 340], [366, 616], [424, 230], [664, 300], [440, 180], [300, 270], [1100, 380], [200, 400], [900, 900], [320, 180]];
  for (let w = 150; w <= 1200; w += 150) for (let h = 150; h <= 900; h += 150) sizes.push([w, h]);
  for (const [w, h] of sizes) {
    const s = art.spriteScale(w, h);
    assert.ok(Number.isInteger(s) && s >= 1, `${w}x${h}`);
    assert.ok(s * art.FLY_BODY.w >= 2 * CFG.rx * w - 1e-9, `${w}x${h}: body width ${s * art.FLY_BODY.w} vs core ${2 * CFG.rx * w}`);
    assert.ok(s * art.FLY_BODY.h >= 2 * CFG.ry * h - 1e-9, `${w}x${h}: body height ${s * art.FLY_BODY.h} vs core ${2 * CFG.ry * h}`);
    if (s > 1) { // smallest such integer
      assert.ok((s - 1) * art.FLY_BODY.w < 2 * CFG.rx * w || (s - 1) * art.FLY_BODY.h < 2 * CFG.ry * h, `${w}x${h}: scale ${s} is minimal`);
    }
  }
});

test('four scenery palettes are distinct, and wall tiles read differently from the background of their own palette', () => {
  const names = art.THEME_ORDER;
  assert.deepEqual([...names], ['garden', 'wireframe', 'desktop', 'glitch']);
  const hashes = names.map((n) => art.spriteHash(art.THEMES[n].bg));
  assert.equal(new Set(hashes).size, 4);
  assert.equal(new Set(names.map((n) => art.spriteHash(art.THEMES[n].wall))).size, 4);
  for (const n of names) assert.notEqual(art.spriteHash(art.THEMES[n].bg), art.spriteHash(art.THEMES[n].wall));
});

test('banana.png reveal pieces: the bitten icon differs, the crescent is gone, the label font covers every letter', () => {
  assert.notEqual(art.spriteHash(art.ICON), art.spriteHash(art.ICON_BITTEN));
  const yellow = (d) => d.rows.join('').split('').filter((c) => c === 'y').length;
  assert.ok(yellow(art.ICON) > 20 && yellow(art.ICON_BITTEN) === 0, 'banana-shaped hole');
  for (const ch of art.ICON_LABEL) assert.ok(art.GLYPHS[ch], `glyph ${ch}`);
  for (const g of Object.values(art.GLYPHS)) assert.equal(g.length, art.GLYPH_H);
  assert.equal(art.ICON_LABEL, 'banana.png');
  assert.equal(art.labelWidth(), 6 * 4 + 2 + 3 * 4 - 1, 'b a n a n a (4 each) . (2) p n g (4 each) minus the trailing gap');
});

test('arrows are mirror images and the burst is symmetric', () => {
  assert.deepEqual([...art.ARROW_DOWN.rows].reverse(), art.ARROW_UP.rows);
  for (const row of art.BURST.rows) assert.equal(row, [...row].reverse().join(''));
});

test('original assets only: art/render/engine contain no remote URLs, images, fonts or network calls', () => {
  for (const f of ['art.js', 'render.js', 'engine.js']) {
    const src = readFileSync(join(dir, 'js', f), 'utf8');
    assert.doesNotMatch(src, /https?:\/\/|fetch\(|XMLHttpRequest|new Image\(|@font-face/, f);
  }
  const files = readdirSync(join(dir)).concat(readdirSync(join(dir, 'js')));
  assert.deepEqual(files.filter((f) => /\.(png|jpe?g|gif|webp|svg|woff2?|ttf|mp3|ogg|wav)$/.test(f)), [], 'no binary assets are shipped');
  const css = readFileSync(join(dir, 'game.css'), 'utf8');
  assert.doesNotMatch(css, /url\(|@import|https?:/);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /Odyssey logo|<img|\.png"/i);
});

// Bigfoot: Take Two art: every sprite is a well-formed palette grid, frames differ, the creature has the specified
// features, and the 3x5 font covers the sign text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_SPRITES, MONSTER, MONSTER_W, MONSTER_H, GLYPHS, SIGN_TEXT, validateSprite, spriteHash, rasterize, actorScale, labelWidth, PALETTE } from '../games/2026-10-19/js/art.js';

test('every sprite is a rectangular grid that only uses declared colours', () => {
  for (const [name, def] of Object.entries(ALL_SPRITES)) {
    const { w, h } = validateSprite(def);
    assert.ok(w > 0 && h > 0, name);
    const r = rasterize(def);
    assert.equal(r.data.length, w * h * 4);
    for (let i = 3; i < r.data.length; i += 4) assert.ok(r.data[i] === 0 || r.data[i] === 255, `${name}: no antialiased alpha`);
  }
});

test('the creature frames share one size and are all different; fans differ', () => {
  const frames = Object.entries(MONSTER);
  for (const [, def] of frames) assert.deepEqual(validateSprite(def), { w: MONSTER_W, h: MONSTER_H });
  const hashes = new Set(frames.map(([, d]) => spriteHash(d)));
  assert.equal(hashes.size, frames.length, 'stand, both waddle frames, raised paw, awkward and hood-open are distinct');
  assert.notEqual(spriteHash(ALL_SPRITES.FAN_A), spriteHash(ALL_SPRITES.FAN_B));
});

test('the costume reads as artificial: visible zipper, shaggy two-tone teal and oversized mitts, and the feet sit on the last row', () => {
  const stand = MONSTER.stand;
  const flat = stand.rows.join('');
  assert.ok(flat.includes('z') && flat.includes('Z'), 'zipper');
  assert.ok(flat.includes('t') && flat.includes('T'), 'shag');
  assert.ok((flat.match(/m/g) || []).length >= 20, 'oversized mitts');
  assert.match(stand.rows[MONSTER_H - 1], /k{8}/, 'feet stand on the bottom row');
  assert.ok(MONSTER.hood.rows.join('').includes('f'), 'hood-open reveals a plain face');
});

test('the 3x5 font covers the sign text and the creature scale keeps the actor near a quarter of the stage', () => {
  for (const ch of SIGN_TEXT) assert.ok(GLYPHS[ch], `glyph ${ch}`);
  assert.ok(labelWidth('FLAT PACK') <= 38 - 4, 'the sign text fits its board with a margin');
  assert.equal(actorScale(615, 378) >= 4, true);
  assert.equal(actorScale(100, 100), 1);
  assert.ok(Object.values(PALETTE).every((c) => /^#[0-9a-f]{6}$/i.test(c)));
});

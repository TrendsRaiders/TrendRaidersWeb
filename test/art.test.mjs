import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderArena, renderPayoff, frameHash, layoutFor, BOXER_H, PLAYER_POSES, ENEMY_POSES, ARENA_W, ARENA_H, PAYOFF_W, PAYOFF_H, PALETTE } from '../games/2026-10-17/js/art.js';

const paletteRgb = new Set(Object.values(PALETTE).map((h) => `${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)}`));
const colors = (f) => {
  const set = new Set();
  for (let i = 0; i < f.data.length; i += 4) {
    assert.equal(f.data[i + 3], 255, 'fully opaque (no alpha blending/antialiasing)');
    set.add(`${f.data[i]},${f.data[i + 1]},${f.data[i + 2]}`);
  }
  return set;
};

test('arena frame is 256x144 logical pixels, opaque, and uses only the limited palette', () => {
  const f = renderArena();
  assert.deepEqual([f.w, f.h, f.data.length], [ARENA_W, ARENA_H, 256 * 144 * 4]);
  assert.deepEqual([ARENA_W, ARENA_H], [256, 144]);
  const used = colors(f);
  for (const c of used) assert.ok(paletteRgb.has(c), `off-palette color ${c}`);
  assert.ok(used.size <= 48 && used.size >= 8, `limited high-contrast palette (${used.size})`);
});

test('rendering is deterministic', () => {
  assert.equal(frameHash(renderArena({ player: 'punch', enemy: 'strike' })), frameHash(renderArena({ player: 'punch', enemy: 'strike' })));
});

test('every player pose and every enemy pose is visibly distinct', () => {
  const p = PLAYER_POSES.map((pose) => frameHash(renderArena({ player: /** @type {any} */ (pose) })));
  assert.equal(new Set(p).size, PLAYER_POSES.length, `player poses: ${PLAYER_POSES}`);
  const e = ENEMY_POSES.map((enemy) => frameHash(renderArena({ enemy: /** @type {any} */ (enemy) })));
  assert.equal(new Set(e).size, ENEMY_POSES.length, `enemy poses: ${ENEMY_POSES}`);
  assert.ok(PLAYER_POSES.includes('guard') && PLAYER_POSES.includes('punch') && ENEMY_POSES.includes('windup'));
});

test('guard shield, counter burst, warning mark, stool and idle bob each change the frame', () => {
  const base = frameHash(renderArena());
  for (const v of [{ guard: true }, { counter: true }, { enemy: 'windup' }, { win: true }, { bob: 1 }]) {
    assert.notEqual(frameHash(renderArena(/** @type {any} */ (v))), base, JSON.stringify(v));
  }
});

test('result scene: gloves settle on the stool, stamp lands, stages are distinct and final stage has the stamp', () => {
  const stages = [0, 1, 2, 3].map((n) => renderPayoff(n));
  for (const f of stages) assert.deepEqual([f.w, f.h], [PAYOFF_W, PAYOFF_H]);
  assert.equal(new Set(stages.map(frameHash)).size, 4);
  colors(stages[3]);
  const stampRed = [0x8f, 0x1d, 0x33]; // stampShade is used only by the stamp
  const has = (f) => { for (let i = 0; i < f.data.length; i += 4) if (f.data[i] === stampRed[0] && f.data[i + 1] === stampRed[1] && f.data[i + 2] === stampRed[2]) return true; return false; };
  assert.equal(has(stages[2]), false);
  assert.equal(has(stages[3]), true);
});

// ---- r5: responsive full-width ring --------------------------------------------------------------
const SPEC_ARENAS = [[296, 210], [366, 304], [515, 207], [1120, 346], [280, 150], [900, 480]]; // CSS px: 320/390 portrait, 667x375, desktop...
const pxFor = (h) => Math.max(1, Math.round((0.32 * h) / BOXER_H));
const key = (f, x, y) => { const i = (y * f.w + x) * 4; return `${f.data[i]},${f.data[i + 1]},${f.data[i + 2]}`; };

test('r5: renderArena fills any requested size; ropes and floor run edge to edge with no posts or side bars', () => {
  for (const [w, h] of SPEC_ARENAS) {
    const lw = Math.ceil(w / pxFor(h)); const lh = Math.ceil(h / pxFor(h));
    const f = renderArena({}, { w: lw, h: lh });
    assert.deepEqual([f.w, f.h], [lw, lh]);
    const L = layoutFor(lw, lh);
    const rope = key(renderArena({}, { w: lw, h: lh }), 0, L.feet - 48);
    assert.equal(rope, '244,245,251', 'rope color at the left edge');
    assert.equal(key(f, lw - 1, L.feet - 48), rope, 'rope reaches the right edge');
    const post = '196,127,30'; // postShade: only used by the retired corner posts
    for (let y = 0; y < lh; y++) for (const x of [0, 1, 2, lw - 3, lw - 2, lw - 1]) assert.notEqual(key(f, x, y), post, `no pillar at ${x},${y} (${lw}x${lh})`);
    // every column has scenery (wall, floor): no black/void side bars
    for (const x of [0, lw - 1]) { let voids = 0; for (let y = 0; y < lh; y++) if (key(f, x, y) === '11,14,26') voids += 1; assert.equal(voids, 0, `no void pixels in edge column ${x}`); }
  }
});

test('r5: boxers keep their pixel size (never stretched), stay inside the arena with room for every glove, and are 25-40% of arena height', () => {
  for (const [w, h] of SPEC_ARENAS) {
    const px = pxFor(h);
    const frac = (BOXER_H * px) / h;
    if (h <= 480 && h >= 200) assert.ok(frac >= 0.25 && frac <= 0.4, `${w}x${h}: boxer is ${(frac * 100).toFixed(1)}% of height`);
    const lw = Math.ceil(w / px); const lh = Math.ceil(h / px);
    const L = layoutFor(lw, lh);
    assert.ok(L.oy - 12 >= 0 && L.feet + 4 < lh, 'full action poses (raised glove, shadow) fit vertically');
    assert.ok(L.playerX - 8 >= 0 && L.enemyX + 14 + 8 <= lw, 'both boxers fully inside horizontally');
    assert.ok(L.playerX + 14 + 40 < L.enemyX, 'punch extension (38 px) never reaches the other boxer\'s torso');
    // the same pose is drawn pixel-identically at every size: translate the player's sprite and compare
    const a = renderArena({ player: 'punch' }, { w: lw, h: lh });
    const b = renderArena({ player: 'punch' }, { w: lw + 40, h: lh + 10 });
    const La = layoutFor(lw, lh); const Lb = layoutFor(lw + 40, lh + 10);
    for (let y = 8; y < BOXER_H; y += 3) for (let x = -2; x < 56; x += 3) {
      assert.equal(key(a, La.playerX + x, La.oy + y), key(b, Lb.playerX + x, Lb.oy + y), `sprite pixel ${x},${y}`);
    }
  }
});

test('r5: reference-size poses still distinct on the default grid and across a recomposed size', () => {
  const size = { w: 296, h: 210 };
  const hashes = PLAYER_POSES.map((pose) => frameHash(renderArena({ player: /** @type {any} */ (pose) }, size)));
  assert.equal(new Set(hashes).size, PLAYER_POSES.length);
  const e = ENEMY_POSES.map((enemy) => frameHash(renderArena({ enemy: /** @type {any} */ (enemy) }, size)));
  assert.equal(new Set(e).size, ENEMY_POSES.length);
});

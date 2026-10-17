import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderArena, renderPayoff, frameHash, PLAYER_POSES, ENEMY_POSES, ARENA_W, ARENA_H, PAYOFF_W, PAYOFF_H, PALETTE } from '../games/2026-10-17/js/art.js';

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

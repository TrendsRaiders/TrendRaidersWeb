// Original pixel art for 30-Second KO, drawn procedurally into a 256x144 logical pixel buffer
// (and a 128x72 result scene). No external assets. Pure functions: no DOM, so poses are unit-testable.
// All coordinates are integers; the page scales the finished buffer by an integer factor.

export const ARENA_W = 256;
export const ARENA_H = 144;
export const PAYOFF_W = 128;
export const PAYOFF_H = 72;

/** Limited palette (hex). Index by name. */
export const PALETTE = Object.freeze({
  void: '#0b0e1a', wall: '#1d2440', wall2: '#283159', crowd: '#141a33', floor: '#3a2f4d', floor2: '#4b3d63',
  apron: '#2a2140', rope: '#f4f5fb', ropeShade: '#9aa0c8', post: '#ffb454', postShade: '#c47f1e',
  skinA: '#f2c9a0', skinAShade: '#d9a77a', hairA: '#3b2a20', shortsA: '#2f6df0', trimA: '#ffffff',
  skinB: '#d9a77a', skinBShade: '#b5855a', hairB: '#d8d8e0', shortsB: '#111111', trimB: '#ffb454',
  gloveRed: '#e8403a', gloveRedShade: '#a82a26', gloveRedHi: '#ff9a94',
  gloveWhite: '#f2f2f5', gloveWhiteShade: '#9a9aa8', gloveWhiteHi: '#ffffff',
  cuff: '#ffffff', eye: '#101010', mouth: '#7a2a2a', shield: '#7bd88f', shieldShade: '#2f9d56',
  warn: '#ffd08a', alert: '#ff4d6d', star: '#ffe066', shadow: '#241c33', black: '#000000',
  wood: '#a0693a', woodShade: '#6e4524', watch: '#fff6e0', watchRim: '#ffb454', watchRimShade: '#c47f1e', hand: '#101010',
  stamp: '#d62f4b', stampShade: '#8f1d33', stampLight: '#ffffff',
});
const NAMES = Object.keys(PALETTE);
const RGB = Object.fromEntries(NAMES.map((n) => {
  const h = PALETTE[/** @type {keyof typeof PALETTE} */ (n)];
  return [n, [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]];
}));

export class Frame {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  px(x, y, name) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const c = RGB[name];
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; this.data[i + 3] = 255;
  }
  rect(x, y, w, h, name) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, name);
  }
  /** rows: array of strings; map: char -> palette name ('.' transparent). */
  bitmap(x, y, rows, map) {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const n = map[row[i]];
        if (n) this.px(x + i, y + j, n);
      }
    });
  }
  /** Stepped thick line (t x t brush) for arms. */
  line(x0, y0, x1, y1, t, name) {
    let dx = Math.abs(x1 - x0); let dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1; const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.rect(x0 - (t >> 1), y0 - (t >> 1), t, t, name);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  disc(cx, cy, r, name) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r) this.px(cx + x, cy + y, name);
  }
  ring(cx, cy, r, name) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = x * x + y * y;
      if (d <= r * r + r && d > (r - 2) * (r - 2) + (r - 2)) this.px(cx + x, cy + y, name);
    }
  }
}

const flipH = (rows) => rows.map((r) => [...r].reverse().join(''));
/** Rotate 90 degrees clockwise. */
const rotCW = (rows) => {
  const h = rows.length; const w = rows[0].length;
  const out = [];
  for (let x = 0; x < w; x++) { let s = ''; for (let y = h - 1; y >= 0; y--) s += rows[y][x]; out.push(s); }
  return out;
};

// ---- bitmaps (facing right unless noted) ------------------------------------------------------
const HEAD = [
  '...hhhhhh...',
  '..hhhhhhhh..',
  '.hhhhhhhhhh.',
  '.hhsssssssss',
  '.hssssssesss',
  '.sssssssssss',
  '.sssssssmmss',
  '..sssssssss.',
  '...SSSSSSS..',
];
const GLOVE = [
  '..ggggg..',
  '.gllgggg.',
  'gglgggggG',
  'gggggggGG',
  'gggggggGG',
  'gggggggGG',
  '.gggggGG.',
  '..ccccc..',
  '..ccccc..',
];
const SHIELD = [
  '.sssssssss.',
  'sSSSSSSSSSs',
  'sSssssssssS',
  'sSssssssssS',
  'sSssssssssS',
  'sSssssssssS',
  '.sSsssssSs.',
  '.sSsssssSs.',
  '..sSsssSs..',
  '...sSsSs...',
  '....sSs....',
  '.....s.....',
];
const BANG = ['.aa.', '.aa.', '.aa.', '.aa.', '.aa.', '....', '.aa.', '.aa.'];
const BURST = [
  '...a...',
  '.a.a.a.',
  '..aaa..',
  'aaaaaaa',
  '..aaa..',
  '.a.a.a.',
  '...a...',
];
const STAR = ['.a.', 'aaa', '.a.'];

function gloveMap(kind) {
  return kind === 'red'
    ? { g: 'gloveRed', G: 'gloveRedShade', l: 'gloveRedHi', c: 'cuff' }
    : { g: 'gloveWhite', G: 'gloveWhiteShade', l: 'gloveWhiteHi', c: 'cuff' };
}

// ---- poses --------------------------------------------------------------------------------------
// Glove centers relative to the torso's left edge (ox) and the head top (oy), for a boxer facing right.
const POSES = {
  idle: { front: [21, 18], back: [9, 20], dx: 0, dy: 0 },
  guard: { front: [17, 7], back: [13, 10], dx: 0, dy: 0 },
  startup: { front: [7, 16], back: [10, 12], dx: -1, dy: 0 },
  punch: { front: [38, 13], back: [8, 14], dx: 3, dy: 0 },
  recover: { front: [24, 17], back: [10, 17], dx: 1, dy: 0 },
  stun: { front: [14, 27], back: [6, 26], dx: -4, dy: 2 },
  windup: { front: [3, -6], back: [11, 12], dx: -2, dy: 0 },
  strike: { front: [38, 14], back: [8, 16], dx: 3, dy: 1 },
  slump: { front: [14, 24], back: [8, 24], dx: 0, dy: 1 },
};
export const PLAYER_POSES = ['idle', 'guard', 'startup', 'punch', 'recover', 'stun'];
export const ENEMY_POSES = ['idle', 'windup', 'strike', 'recovery'];
const ENEMY_POSE_MAP = { idle: 'idle', windup: 'windup', strike: 'strike', recovery: 'recover' };

const SKINS = {
  a: { s: 'skinA', S: 'skinAShade', h: 'hairA', e: 'eye', m: 'mouth', shorts: 'shortsA', trim: 'trimA', glove: 'red' },
  b: { s: 'skinB', S: 'skinBShade', h: 'hairB', e: 'eye', m: 'mouth', shorts: 'shortsB', trim: 'trimB', glove: 'white' },
};

/**
 * Draw a boxer. facing: 1 = right, -1 = left (mirrored).
 * @param {Frame} f @param {{ ox:number, oy:number, facing:1|-1, skin:'a'|'b', pose:keyof typeof POSES }} o
 */
function boxer(f, { ox, oy, facing, skin, pose }) {
  const sk = SKINS[skin];
  const p = POSES[pose];
  const mx = (dx) => (facing === 1 ? ox + dx : ox + 13 - dx); // mirror x offsets within the 14px torso
  const bx = ox + p.dx * facing; // body x shifts forward/back along facing
  const by = oy + p.dy;
  f.rect(bx - 2, by + 55, 20, 3, 'shadow');
  // legs + shoes
  f.rect(bx + 2, by + 38, 4, 16, sk.s); f.rect(bx + 8, by + 38, 4, 16, sk.s);
  f.rect(bx + 1, by + 54, 6, 2, 'black'); f.rect(bx + 7, by + 54, 6, 2, 'black');
  // shorts with trim
  f.rect(bx + 1, by + 28, 12, 11, sk.shorts);
  f.rect(bx + 1, by + 28, 12, 2, sk.trim);
  f.rect(bx + 6, by + 30, 2, 9, 'black');
  // torso
  f.rect(bx + 1, by + 11, 12, 17, sk.s);
  f.rect(bx + 1, by + 25, 12, 3, sk.S);
  f.rect(bx + 6, by + 13, 2, 8, sk.S);
  // neck + head (mirrored when facing left)
  f.rect(bx + 5, by + 9, 4, 3, sk.S);
  const head = facing === 1 ? HEAD : flipH(HEAD);
  f.bitmap(bx + 1, by, head, { h: sk.h, s: sk.s, S: sk.S, e: sk.e, m: sk.m });
  // arms (stepped thick lines) and gloves
  const shoulderF = [mx(facing === 1 ? 11 : 11) + (bx - ox), by + 14];
  const shoulderB = [mx(3) + (bx - ox), by + 14];
  const gm = gloveMap(sk.glove);
  const place = (rel, shoulder, back) => {
    const gx = mx(rel[0]) + (bx - ox) + (facing === 1 ? 0 : 0);
    const gy = oy + rel[1] + p.dy;
    f.line(shoulder[0], shoulder[1], gx, gy, 3, back ? sk.S : sk.s);
    // orient glove: cuff toward the shoulder; rotate for horizontal reach
    let rows = GLOVE;
    const horizontal = Math.abs(gx - shoulder[0]) > Math.abs(gy - shoulder[1]);
    if (horizontal) rows = facing === 1 ? rotCW(GLOVE) : flipH(rotCW(GLOVE));
    f.bitmap(gx - 4, gy - 4, rows, gm);
  };
  place(p.back, shoulderB, true);
  place(p.front, shoulderF, false);
}

export const BOXER_H = 56;

/**
 * Responsive layout in logical pixels: the ring always spans the full width; boxers keep their pixel size and are
 * positioned for the aspect ratio (never stretched, never cropped).
 */
export function layoutFor(w, h) {
  const feet = Math.round(h * 0.82);
  const gap = Math.max(98, Math.min(170, Math.round(w * 0.2)));
  const cx = Math.round(w / 2);
  const oy = feet - BOXER_H;
  return { feet, oy, floorTop: feet - 10, playerX: cx - Math.round(gap / 2) - 14, enemyX: cx + Math.round(gap / 2), gap };
}

function arenaBackdrop(f, L) {
  const { w, h } = { w: f.w, h: f.h };
  f.rect(0, 0, w, h, 'void');
  f.rect(0, 0, w, L.floorTop, 'wall');
  // blocky crowd silhouette and banner blocks (decorative, no lettering), full width
  const crowdBase = L.feet - 52;
  for (let x = 0; x < w; x += 8) {
    const ch = 8 + ((x * 7) % 5) * 2;
    f.rect(x, crowdBase - ch, 8, ch, 'crowd');
    f.rect(x + 2, crowdBase - ch - 3, 4, 4, 'crowd');
  }
  for (let x = 12, i = 0; x < w; x += 36, i++) f.rect(x, Math.max(6, crowdBase - 48), 20, 12, i % 2 ? 'wall2' : 'wall');
  // floor and apron, full width
  f.rect(0, L.floorTop, w, h - L.floorTop, 'floor');
  for (let x = 0; x < w; x += 16) f.rect(x, L.feet + 8, 8, h - L.feet - 8, 'floor2');
  f.rect(0, L.feet + 16, w, h - L.feet - 16, 'apron');
  // flat ropes edge to edge (no posts, no side bars)
  for (const y of [L.feet - 48, L.feet - 34, L.feet - 20]) {
    f.rect(0, y, w, 2, 'rope'); f.rect(0, y + 2, w, 1, 'ropeShade');
  }
}

/**
 * @typedef {{ player: keyof typeof POSES, enemy: 'idle'|'windup'|'strike'|'recovery', guard: boolean,
 *   counter: boolean, bob: number, win: boolean }} ArenaView
 */
/** @param {Partial<ArenaView>} [v] @param {{ w: number, h: number }} [size] logical pixels (default: the 256x144 reference) */
export function renderArena(v = {}, size = { w: ARENA_W, h: ARENA_H }) {
  const view = { player: 'idle', enemy: 'idle', guard: false, counter: false, bob: 0, win: false, ...v };
  const f = new Frame(size.w, size.h);
  const L = layoutFor(size.w, size.h);
  arenaBackdrop(f, L);
  const bob = view.bob ? 1 : 0;
  boxer(f, { ox: L.playerX, oy: L.oy + (view.player === 'idle' ? bob : 0), facing: 1, skin: 'a', pose: /** @type {keyof typeof POSES} */ (view.player) });
  boxer(f, { ox: L.enemyX, oy: L.oy + (view.enemy === 'idle' ? 1 - bob : 0), facing: -1, skin: 'b', pose: /** @type {keyof typeof POSES} */ (ENEMY_POSE_MAP[view.enemy]) });
  if (view.guard) f.bitmap(L.playerX + 26, L.oy - 10, SHIELD, { s: 'shield', S: 'shieldShade' });
  if (view.player === 'stun') for (const [dx, dy] of [[4, -10], [14, -14], [24, -10]]) f.bitmap(L.playerX + dx, L.oy + dy, STAR, { a: 'star' });
  if (view.enemy === 'windup') f.bitmap(L.enemyX + 30, L.oy - 16, BANG, { a: 'alert' });
  if (view.counter) f.bitmap(L.enemyX + 22, L.oy - 18, BURST, { a: 'star' });
  if (view.win) {
    const sx = L.enemyX - 34; const sy = L.oy + 46;
    f.rect(sx, sy, 24, 3, 'wood'); f.rect(sx + 2, sy + 3, 2, 8, 'woodShade'); f.rect(sx + 20, sy + 3, 2, 8, 'woodShade');
  }
  return f;
}

/**
 * Result scene: Jack's gloves settle on a stool; a stopwatch is stamped.
 * stage 0: gloves raised; 1: lowering; 2: resting on stool; 3: stamp lands (final).
 * @param {number} [stage]
 */
export function renderPayoff(stage = 3) {
  const f = new Frame(PAYOFF_W, PAYOFF_H);
  f.rect(0, 0, PAYOFF_W, PAYOFF_H, 'wall');
  f.rect(0, 58, PAYOFF_W, 14, 'floor');
  // stool
  f.rect(8, 44, 40, 5, 'wood'); f.rect(8, 49, 40, 1, 'woodShade');
  f.rect(12, 50, 4, 16, 'woodShade'); f.rect(40, 50, 4, 16, 'woodShade'); f.rect(14, 58, 28, 2, 'woodShade');
  // gloves settle (horizontal glove bitmaps resting on the seat)
  const lift = [14, 8, 0, 0][Math.max(0, Math.min(3, stage))];
  const gm = gloveMap('white');
  const g = rotCW(GLOVE);
  f.bitmap(12, 35 - lift, g, gm);
  f.bitmap(28, 35 - lift, flipH(g), gm);
  // oversized stopwatch
  f.rect(86, 4, 10, 5, 'watchRim'); f.rect(88, 9, 6, 3, 'watchRimShade');
  f.disc(91, 38, 25, 'watchRimShade'); f.disc(91, 38, 24, 'watchRim'); f.disc(91, 38, 20, 'watch');
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6; const x = Math.round(91 + 17 * Math.sin(a)); const y = Math.round(38 - 17 * Math.cos(a));
    f.rect(x - 1, y - 1, i % 3 === 0 ? 3 : 2, i % 3 === 0 ? 3 : 2, 'hand');
  }
  f.line(91, 38, 91, 24, 3, 'hand'); f.line(91, 38, 101, 44, 3, 'hand'); f.rect(90, 37, 3, 3, 'stamp');
  if (stage >= 3) {
    // stamp bar (lettering is rendered as DOM text beside the scene)
    f.rect(56, 52, 70, 14, 'stampShade'); f.rect(54, 50, 70, 14, 'stamp');
    f.rect(56, 52, 66, 2, 'stampLight'); f.rect(56, 60, 66, 2, 'stampLight');
    for (let x = 60; x < 120; x += 12) f.bitmap(x, 55, STAR, { a: 'stampLight' });
  }
  return f;
}

/** Stable hash of a frame (FNV-1a) for tests. */
export function frameHash(f) {
  let h = 0x811c9dc5;
  for (let i = 0; i < f.data.length; i++) { h ^= f.data[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

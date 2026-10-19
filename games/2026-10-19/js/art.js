// Bigfoot: Take Two, original hand-authored pixel art. Pure data plus a tiny rasterizer (no DOM, no network).
// Every sprite is a grid of palette characters ('.' = transparent) that render.js scales by whole-number factors with
// nearest-neighbour sampling. The creature is an invented, obviously artificial teal costume seen from the front: it is
// not the historical film's profile, silhouette or composition. No third-party assets, fonts or images.

/** @typedef {{ rows: string[], colors: Record<string,string> }} SpriteDef */

export const PALETTE = Object.freeze({
  outline: '#10222b', teal: '#2aa89a', shag: '#1b7a76', mitt: '#5fe0cc', white: '#ffffff', zip: '#e4ebf0', teeth: '#8a98a3', mouth: '#b0304a',
  skin: '#f0c9a0', bun: '#e8b86a', crust: '#c98a3e', lettuce: '#5fbf4a', ham: '#e87d8a', cheese: '#ffd24a',
  card: '#c99a5b', cardDark: '#8c6633', fern: '#3f9a4a', fernDark: '#25663a', cloud: '#fff4dc',
  skyTop: '#f2a65a', skyMid: '#f7c27c', skyLow: '#fbd9a0', floor: '#6f4a2b', plank: '#5a3b22',
  tape: '#ffe14a', black: '#14141f', marker: '#ff2f8f', metal: '#9aa6b1', metalDark: '#4b5560', fur: '#7b5a3c',
});
const P = PALETTE;
const MON = { k: P.outline, T: P.teal, t: P.shag, m: P.mitt, w: P.white, z: P.zip, Z: P.teeth, r: P.mouth, f: P.skin };

/** Mirror a left-half row into a symmetric full row. */
const mirror = (half) => half + [...half].reverse().join('');

/** 26x30 symmetric front view: shaggy head, googly eyes, zipper down the middle, torso, hips and two legs. */
const BASE_HALF = [
  '.......k..kkk',
  '.....kkTkkTTT',
  '....kTTTTTTTT',
  '...kTTTTTTTTT',
  '...kTTTTTTTTT',
  '..kTTTwwwTTTT',
  '..kTTTwwkTTTT',
  '..kTTTwwwTTTT',
  '..kTtTTTTTTTT',
  '..kTTTTTkkkkk',
  '..kTTTTTkrrrr',
  '...kTTTTTkkkk',
  '....kTtTTTTTT',
  '...kTTTTtTTTT',
  '...kTtTTTTTTz',
  '...kTTTTTtTTZ',
  '...kTTtTTTTTz',
  '...kTTTTTTtTZ',
  '...kTtTTTTTTz',
  '...kTTTTtTTTZ',
  '...kTTTTTTTTz',
  '...kTTtTTTTTZ',
  '....kTTTTTTTz',
  '.....kkTTTTTk',
  '......kTTTTk.',
  '......kTtTTk.',
  '......kTTTTk.',
  '.....kTTTTTk.',
  '....kTTTTTTk.',
  '....kkkkkkkk.',
];
export const MONSTER_W = 30; // 2 columns of margin each side for the oversized mitts
export const MONSTER_H = 30;
const BASE = BASE_HALF.map((h) => `..${mirror(h)}..`);

/** Paste patches over rows. '.' leaves a cell alone, '~' clears it to transparent. */
function patch(rows, layers) {
  const grid = rows.map((r) => [...r]);
  for (const { x, y, art } of layers) {
    art.forEach((line, j) => [...line].forEach((ch, i) => {
      if (ch === '.') return;
      const row = grid[y + j];
      if (row && x + i >= 0 && x + i < row.length) row[x + i] = ch === '~' ? '.' : ch;
    }));
  }
  return grid.map((r) => r.join(''));
}
const clear = (x, y, w, h) => ({ x, y, art: Array.from({ length: h }, () => '~'.repeat(w)) });

// Left hanging arm + mitt (cols 0..5) and right hanging arm + mitt (cols 24..29). Mitts are oversized 6x4 blocks.
const L_ARM = ['..kTk.', '..kTk.', '.kTTk.', '.kTTk.', 'kkTTk.', 'kmmmmk', 'kmmmmk', 'kmmmmk', '.kkkk.'];
const R_ARM = ['.kTk..', '.kTk..', '.kTTk.', '.kTTk.', '.kTTkk', 'kmmmmk', 'kmmmmk', 'kmmmmk', '.kkkk.'];
const armL = (y) => ({ x: 0, y, art: L_ARM });
const armR = (y) => ({ x: 24, y, art: R_ARM });
const RAISED = [
  clear(24, 12, 6, 12),
  { x: 26, y: 6, art: ['kTTk', 'kTTk', 'kTTk', 'kTTk', 'kTTk', 'kTTk', 'kTTk', 'kTTk', 'kTTk', 'kTTk'] },
  { x: 24, y: 0, art: ['.kkkk.', 'kmmmmk', 'kmmmmk', 'kmmmmk', '.kmmk.', '..kk..'] },
];
/** Awkward photo: wide open mouth, squeezed-shut eyes (flat bars), mitts out to the sides. */
const AWKWARD = [
  { x: 9, y: 5, art: ['kkkk', 'TTTT', 'kkkk'] },
  { x: 17, y: 5, art: ['kkkk', 'TTTT', 'kkkk'] },
  { x: 10, y: 9, art: ['kkkkkkkkkk', 'krrrrrrrrk', 'krrrrrrrrk', 'krrrrrrrrk', '.kkkkkkkk.'] },
];
/** Hood thrown back: a plain, smiling crew member's face where the mask was (generic, no likeness). */
const HOOD_OPEN = [
  { x: 8, y: 3, art: Array.from({ length: 9 }, () => 'ffffffffffffff') },
  { x: 11, y: 5, art: ['kk', 'kk'] },
  { x: 18, y: 5, art: ['kk', 'kk'] },
  { x: 10, y: 8, art: ['k........k'.padStart(11, '.').slice(0, 10)] },
  { x: 11, y: 9, art: ['kkkkkkkk'] },
];

/** @type {Record<string, SpriteDef>} */
export const MONSTER = {
  stand: { colors: MON, rows: patch(BASE, [armL(13), armR(13)]) },
  // waddle: opposite feet lifted one row, opposite arms swung a row up/down
  walkA: { colors: MON, rows: patch(BASE, [armL(12), armR(14), clear(4, 27, 9, 3), { x: 6, y: 27, art: ['kTTTTk', 'kkkkkk'] }]) },
  walkB: { colors: MON, rows: patch(BASE, [armL(14), armR(12), clear(16, 27, 9, 3), { x: 18, y: 27, art: ['kTTTTk', 'kkkkkk'] }]) },
  pose: { colors: MON, rows: patch(BASE, [armL(13), ...RAISED]) },
  awkward: { colors: MON, rows: patch(BASE, [armL(12), armR(14), ...AWKWARD]) },
  hood: { colors: MON, rows: patch(BASE, [armL(13), armR(13), ...HOOD_OPEN]) },
};

// ---- props ------------------------------------------------------------------------------------------------------
const CARD = { c: P.card, d: P.cardDark, g: P.fern, G: P.fernDark, k: P.outline, m: P.metal, M: P.metalDark, w: P.white, y: P.tape, b: P.black };

/** Cardboard fern cut-out (14x12): fronds on a folded cardboard foot. */
export const FERN = /** @type {SpriteDef} */ ({
  colors: CARD,
  rows: [
    '.......g......',
    '..g....g...g..',
    '..gg..ggg.gg..',
    '...gggGgggg...',
    '.g.ggGgGggg.g.',
    '.ggggGggGgggg.',
    '..ggGgggGgg...',
    '....gGggGg....',
    '.....gGGg.....',
    '.....kccdk....',
    '....kccccdk...',
    '....kkkkkkk...',
  ],
});

/** Cardboard tree flat (18x36): paper canopy, trunk, a visible brace and the cardboard edge. */
export const TREE = /** @type {SpriteDef} */ ({
  colors: CARD,
  rows: [
    '........kk........',
    '......kkggkk......',
    '....kkggggggkk....',
    '...kggGgggGgggk...',
    '..kgggggGgggggGk..',
    '.kgGgggggggGggggk.',
    '.kggggGgggggggggk.',
    '..kkggggGggGgggkk.',
    '...kggGgggggggGk..',
    '..kggggggGgggggGk.',
    '.kgGggGggggggGgggk',
    '.kggggggGgggggggk.',
    '..kkkggggGggggkkk.',
    '.....kkgggggkk....',
    '.......kkkkk......',
    '.......kccdk......',
    '.......kccdk......',
    '.......kccdk......',
    '.......kccdk......',
    '.......kccdk......',
    '.......kccdk......',
    '.......kccdk......',
    '.......kccdk......',
    '.......kccdk......',
    '.......kccdk......',
    '.......kccdk......',
    '.......kccdk......',
    '.......kccdk......',
    '.......kccdk......',
    '......kccccdk.....',
    '.....kkkkkkkkk....',
  ],
});

/** Toy camera (14x9): lens, flash and shutter button. Used in the photo frames. */
export const CAMERA = /** @type {SpriteDef} */ ({
  colors: CARD,
  rows: [
    '....kkk.......',
    'kkkkkddkkkkkkk',
    'kmmmmmmmmmmmmk',
    'kmkkkkkmmmywmk',
    'kmkwwwkmmmywmk',
    'kmkwkwkmmmmmmk',
    'kmkkkkkmmmmmmk',
    'kMMMMMMMMMMMMk',
    'kkkkkkkkkkkkkk',
  ],
});

/** Clapperboard (14x11): striped clapper over a slate. */
export const CLAPPER = /** @type {SpriteDef} */ ({
  colors: CARD,
  rows: [
    'kkkkkkkkkkkkkk',
    'kbwwbbwwbbwwbk',
    'kkkkkkkkkkkkkk',
    'kbbwwbbwwbbwwk',
    'kkkkkkkkkkkkkk',
    'kbbbbbbbbbbbbk',
    'kbwwwbwwwbwwbk',
    'kbbbbbbbbbbbbk',
    'kbwwbwwwbwwwbk',
    'kbbbbbbbbbbbbk',
    'kkkkkkkkkkkkkk',
  ],
});

/** Boom mic (24x22): a fuzzy windshield on a pole angled in from the upper left. */
export const BOOM = /** @type {SpriteDef} */ ({
  colors: { k: P.outline, m: P.metal, M: P.metalDark, f: P.fur, F: '#a98258' },
  rows: [
    'kkkkkkkk................',
    'kMMMMMMkk...............',
    'kkkkkkkMkk..............',
    '.......kMMkk............',
    '.........kMMkk..........',
    '...........kMMkk........',
    '.............kMMkk......',
    '...............kMMkk....',
    '.................kMMkkkk',
    '..................kkFfFk',
    '.................kFfFfFk',
    '................kFfFfFfk',
    '................kfFfFfFk',
    '................kFfFfFfk',
    '.................kfFfFk.',
    '..................kkkk..',
  ].map((r) => r.padEnd(24, '.')).slice(0, 16),
});

/** Desk fan (14x16), two blade frames. A cardboard-sign "wind machine" with a clear mesh guard. */
const FAN_COLORS = { k: P.outline, m: P.metal, M: P.metalDark, b: '#dff1ff', B: '#8ec3f0' };
export const FAN_A = /** @type {SpriteDef} */ ({
  colors: FAN_COLORS,
  rows: [
    '....kkkkkkk...',
    '...kmmmmmmmk..',
    '..kmbbmmmmbmk.',
    '.kmmbbBmmbbmmk',
    '.kmmmmBkBmmmmk',
    '.kmmmmmkmmmmmk',
    '.kmbBmmkmmbBmk',
    '.kmbbmmmmmbbmk',
    '..kmmmmmmmmmk.',
    '...kmmmmmmmk..',
    '....kkkkkkk...',
    '......kMk.....',
    '......kMk.....',
    '......kMk.....',
    '....kkMMMkk...',
    '...kkkkkkkkk..',
  ],
});
export const FAN_B = /** @type {SpriteDef} */ ({
  colors: FAN_COLORS,
  rows: [
    ...FAN_A.rows.slice(0, 2),
    '..kmmmmbbmmmk.',
    '.kmmmmmBbbmmmk',
    '.kmbbBmkmmmmmk',
    '.kmmbbmkmmbbmk',
    '.kmmmmmkmBbbmk',
    '.kmmmmmmmbbBmk',
    ...FAN_A.rows.slice(8),
  ],
});

/** Sandwich (14x9): crusty bun, lettuce, ham and cheese. */
export const SANDWICH = /** @type {SpriteDef} */ ({
  colors: { k: P.outline, b: P.bun, c: P.crust, l: P.lettuce, g: P.ham, y: P.cheese },
  rows: [
    '...kkkkkkkkkk.',
    '..kbbcbbbbcbbk',
    '.kbbbbbcbbbbbk',
    '.kkkkkkkkkkkkk',
    'kllllllllllllk',
    'kggggggggggggk',
    'kyyyyyyyyyyyyk',
    'kcbbbbbbbbbbck',
    '.kkkkkkkkkkkk.',
  ],
});

// ---- 3x5 label font for the set sign and clapperboard -----------------------------------------------------------------
export const GLYPH_H = 5;
export const GLYPHS = Object.freeze({
  F: ['XXX', 'X..', 'XX.', 'X..', 'X..'],
  O: ['XXX', 'X.X', 'X.X', 'X.X', 'XXX'],
  R: ['XX.', 'X.X', 'XX.', 'X.X', 'X.X'],
  E: ['XXX', 'X..', 'XX.', 'X..', 'XXX'],
  S: ['.XX', 'X..', '.X.', '..X', 'XX.'],
  T: ['XXX', '.X.', '.X.', '.X.', '.X.'],
  A: ['.X.', 'X.X', 'XXX', 'X.X', 'X.X'],
  L: ['X..', 'X..', 'X..', 'X..', 'XXX'],
  P: ['XX.', 'X.X', 'XX.', 'X..', 'X..'],
  C: ['.XX', 'X..', 'X..', 'X..', '.XX'],
  K: ['X.X', 'X.X', 'XX.', 'X.X', 'X.X'],
  '-': ['...', '...', 'XXX', '...', '...'],
  ' ': ['.', '.', '.', '.', '.'],
});
export const SIGN_TEXT = 'FOREST - FLAT PACK';
/** Width in logical pixels of a string in the 3x5 font (1 px gap between glyphs). */
export function labelWidth(text = SIGN_TEXT) {
  return [...text].reduce((w, ch) => w + (GLYPHS[ch] ? GLYPHS[ch][0].length + 1 : 0), -1);
}

/** Verify a definition is a well-formed rectangle that only uses declared colour characters. */
export function validateSprite(def) {
  const w = def.rows[0].length;
  for (const row of def.rows) {
    if (row.length !== w) throw new Error(`ragged sprite row "${row}" (expected ${w})`);
    for (const ch of row) if (ch !== '.' && !def.colors[ch]) throw new Error(`undeclared colour "${ch}"`);
  }
  return { w, h: def.rows.length };
}

/** Rasterize to opaque-or-transparent RGBA (no antialiasing, no alpha blending). */
export function rasterize(def) {
  const { w, h } = validateSprite(def);
  const data = new Uint8ClampedArray(w * h * 4);
  def.rows.forEach((row, j) => {
    for (let i = 0; i < w; i++) {
      const ch = row[i];
      if (ch === '.') continue;
      const hex = def.colors[ch];
      const o = (j * w + i) * 4;
      data[o] = parseInt(hex.slice(1, 3), 16); data[o + 1] = parseInt(hex.slice(3, 5), 16); data[o + 2] = parseInt(hex.slice(5, 7), 16); data[o + 3] = 255;
    }
  });
  return { w, h, data };
}

/** Stable content hash (FNV-1a over the RGBA bytes) used by tests to prove sprites differ. */
export function spriteHash(def) {
  let h = 0x811c9dc5;
  for (const b of rasterize(def).data) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Whole-number sprite scale for the performer: aim for about `fraction` of the stage height, never below 1. */
export function actorScale(stageH, stageW, fraction = 0.28) {
  const byH = Math.floor((stageH * fraction) / MONSTER_H);
  const byW = Math.floor((stageW * 0.38) / MONSTER_W);
  return Math.max(1, Math.min(byH, byW));
}

export const ALL_SPRITES = Object.freeze({ ...MONSTER, FERN, TREE, CAMERA, CLAPPER, BOOM, FAN_A, FAN_B, SANDWICH });

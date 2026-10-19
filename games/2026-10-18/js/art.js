// Fly the Simulation: original hand-authored pixel sprites, scenery tiles and the banana.png reveal pieces.
// Pure data + a tiny rasterizer (no DOM, no network): every sprite is a grid of palette characters. '.' is transparent.
// render.js scales them by whole-number factors with nearest-neighbour sampling; nothing is stretched.

/** @typedef {{ rows: string[], colors: Record<string,string> }} SpriteDef */

const FLY_COLORS = { o: '#fdfdf7', b: '#2f3250', s: '#6a70a0', r: '#ff3b3b', e: '#ffffff', w: '#dff1ff', W: '#8ec3f0', a: '#fdfdf7', l: '#fdfdf7' };

/**
 * Cartoon fly facing right, 17x13. Wings (w/W), antennae (a) and legs (l) are decoration only; the collision core is
 * always inside `FLY_BODY` (the outlined 9x7 body block), which is fully opaque.
 */
export const FLY_BODY = Object.freeze({ x: 4, y: 4, w: 9, h: 7 });
export const FLY_A = /** @type {SpriteDef} */ ({
  colors: FLY_COLORS,
  rows: [
    '....wwwww........',
    '...wWWWWWw.......',
    '...wWWWWWw...a.a.',
    '....wwwww....a.a.',
    '....ooooooooo....',
    '....obbbbbbbo....',
    '....obbbbrreo....',
    '....obbbbrrro....',
    '....obsbsbbbo....',
    '....obbbbbbbo....',
    '....ooooooooo....',
    '...l.l..l.l......',
    '..l..l..l..l.....',
  ],
});
export const FLY_B = /** @type {SpriteDef} */ ({
  colors: FLY_COLORS,
  rows: [
    '.................',
    '.................',
    '.............a.a.',
    '..wwwWWWWwww.a.a.',
    '....ooooooooo....',
    '....obbbbbbbo....',
    '....obbbbrreo....',
    '....obbbbrrro....',
    '....obsbsbbbo....',
    '....obbbbbbbo....',
    '....ooooooooo....',
    '....l.l.l.l......',
    '...l..l.l..l.....',
  ],
});

export const BANANA = /** @type {SpriteDef} */ ({
  colors: { k: '#3b2a10', y: '#ffd93a', b: '#8a5a1e', h: '#fff3a0' },
  rows: [
    '..............bb',
    '............kkbk',
    '...........kyyk.',
    '..........kyyyk.',
    '.........kyyyhk.',
    '........kyyyyyk.',
    '.......kyyyyyk..',
    '..kk..kyyyyyk...',
    '.kyykkyyyyyk....',
    'kyyyyyyyyyk.....',
    'kyyyyyyyyk......',
    '.kyyyyyykk......',
    '..kkkkkk........',
  ],
});

/** Wall-gap warning arrows (7x7) and the contact burst (9x9). */
export const ARROW_UP = /** @type {SpriteDef} */ ({
  colors: { a: '#ffe14a', k: '#14141f' },
  rows: ['kkkakkk', 'kkaaakk', 'kaaaaak', 'aaaaaaa', 'kkaaakk', 'kkaaakk', 'kkaaakk'],
});
export const ARROW_DOWN = /** @type {SpriteDef} */ ({ colors: ARROW_UP.colors, rows: [...ARROW_UP.rows].reverse() });
export const BURST = /** @type {SpriteDef} */ ({
  colors: { y: '#ffe14a', Y: '#ffffff' },
  rows: ['....y....', '.y..y..y.', '..y.y.y..', '...yyy...', 'yyyyYyyyy', '...yyy...', '..y.y.y..', '.y..y..y.', '....y....'],
});

/** Scenery tiles (8x8). Four palettes: garden -> wireframe -> desktop tiles -> glitched garden. Decoration only. */
export const THEMES = Object.freeze({
  garden: {
    label: 'Garden',
    edge: '#fff6c8', shade: '#143d1a',
    bg: { colors: { a: '#bfe5a0', b: '#a9d487', p: '#ff9ec7' }, rows: ['aaaaaaaa', 'aabaaaaa', 'aaaaaaba', 'aaaaaapa', 'abaaaaaa', 'aaaaabaa', 'aaaaaaaa', 'aaaabaaa'] },
    wall: { colors: { g: '#2e7d39', G: '#53b05a', d: '#1f5a29' }, rows: ['gggGgggg', 'gGggggGg', 'gggggggg', 'ddgddddg', 'gggGgggg', 'gGggggGg', 'gggggggg', 'dddgdddd'] },
  },
  wireframe: {
    label: 'Wireframe',
    edge: '#ffffff', shade: '#000000',
    bg: { colors: { n: '#0d1a2d', g: '#1d4468' }, rows: ['gggggggg', 'gnnnnnnn', 'gnnnnnnn', 'gnnnnnnn', 'gnnnnnnn', 'gnnnnnnn', 'gnnnnnnn', 'gnnnnnnn'] },
    wall: { colors: { k: '#164a78', c: '#7fefff' }, rows: ['cccccccc', 'ckkkckkk', 'ckkkckkk', 'ckkkckkk', 'cccccccc', 'ckkkckkk', 'ckkkckkk', 'ckkkckkk'] },
  },
  desktop: {
    label: 'Desktop tiles',
    edge: '#ffffff', shade: '#1a1a24',
    bg: { colors: { t: '#2b8a8f', u: '#35a3a7' }, rows: ['uuuutttt', 'uuuutttt', 'uuuutttt', 'uuuutttt', 'ttttuuuu', 'ttttuuuu', 'ttttuuuu', 'ttttuuuu'] },
    wall: { colors: { b: '#1e2f9c', l: '#dcdce6', g: '#aaaab8', d: '#5a5a6a' }, rows: ['bbbbbbbb', 'bbbbbbbb', 'bbbbbbbb', 'llllllll', 'gggggggg', 'gggggggg', 'gggggggg', 'dddddddd'] },
  },
  glitch: {
    label: 'Garden with pixel seams',
    edge: '#ffffff', shade: '#143d1a',
    bg: { colors: { a: '#bfe5a0', b: '#a9d487', m: '#ff2fb9', c: '#2ff0ff' }, rows: ['aaaaaaaa', 'aabaaaaa', 'mmmmmmmm', 'caaabaaa', 'aaaaaaba', 'abaacccc', 'aaaaaaaa', 'aaaabaaa'] },
    wall: { colors: { g: '#2e7d39', G: '#53b05a', d: '#1f5a29', m: '#ff2fb9', c: '#2ff0ff' }, rows: ['gggGgggg', 'mmmmmmmm', 'gggggggg', 'gGgggcgg', 'cccccggg', 'gggGgggg', 'mmmmmmmm', 'dddgdddd'] },
  },
});
export const THEME_ORDER = Object.freeze(['garden', 'wireframe', 'desktop', 'glitch']);

/** Reveal pieces: the miniature game window, the banana.png desktop icon (intact and bitten) and a 3x5 label font. */
export const ICON_W = 18;
export const ICON_H = 18;
const ICON_COLORS = { k: '#14141f', w: '#f4f5fb', s: '#7fc4ff', y: '#ffd93a', b: '#8a5a1e', f: '#c9ccdd' };
/** banana.png: a white picture file with a sky-blue picture and a yellow crescent (picture interior is 12x10). */
const PICTURE = [
  'ssssssssssss',
  'sssssssssbss',
  'ssssssssyyss',
  'sssssssyyyss',
  'ssyssyyyyyss',
  'syyyyyyyyyss',
  'syyyyyyyysss',
  'ssyyyyyyssss',
  'sssssyyyssss',
  'ssssssssssss',
];
export const ICON = /** @type {SpriteDef} */ ({
  colors: ICON_COLORS,
  rows: [
    'kkkkkkkkkkkkkkkkkk',
    'kwwwwwwwwwwwwwwwwk',
    'kwkkkkkkkkkkkkkkwk',
    ...PICTURE.map((r) => `kwk${r}kwk`),
    'kwkkkkkkkkkkkkkkwk',
    'kwwwwwwwwwwwwwwwwk',
    'kwwwwwwwwwwwwwwwwk',
    'kwwwwwwwwwwwwwwwwk',
    'kkkkkkkkkkkkkkkkkk',
  ],
});
/** The same file after the bite: the crescent is gone (a banana-shaped hole) and a scallop is missing from the edge. */
const BITE = { 9: 16, 10: 15, 11: 15, 12: 15, 13: 16 };
export const ICON_BITTEN = /** @type {SpriteDef} */ ({
  colors: ICON_COLORS,
  rows: ICON.rows.map((row, j) => row.split('').map((ch, i) => {
    if (j >= 3 && j <= 12 && (ch === 'y' || ch === 'b')) return '.';
    if (BITE[j] !== undefined && i >= BITE[j]) return '.';
    return ch;
  }).join('')),
});

export const GLYPH_W = 3;
export const GLYPH_H = 5;
/** 3x5 label font, only the letters banana.png needs. Advance is width + 1 (the dot is 1 wide). */
export const GLYPHS = Object.freeze({
  b: ['X..', 'XX.', 'X.X', 'X.X', 'XX.'],
  a: ['XX.', '..X', '.XX', 'X.X', '.XX'],
  n: ['XX.', 'X.X', 'X.X', 'X.X', 'X.X'],
  '.': ['.', '.', '.', '.', 'X'],
  p: ['XX.', 'X.X', 'XX.', 'X..', 'X..'],
  g: ['.XX', 'X.X', '.XX', '..X', 'XX.'],
});
export const ICON_LABEL = 'banana.png';
export function labelWidth(text = ICON_LABEL) {
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

/** Stable content hash (FNV-1a over the RGBA bytes) used by tests to prove sprites/frames differ. */
export function spriteHash(def) {
  let h = 0x811c9dc5;
  for (const b of rasterize(def).data) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Whole-number sprite scale: the smallest integer whose fly body block contains the collision core. */
export function spriteScale(arenaW, arenaH, cfg = { rx: 0.018, ry: 0.025 }) {
  const coreW = 2 * cfg.rx * arenaW;
  const coreH = 2 * cfg.ry * arenaH;
  return Math.max(1, Math.ceil(Math.max(coreW / FLY_BODY.w, coreH / FLY_BODY.h) - 1e-9));
}

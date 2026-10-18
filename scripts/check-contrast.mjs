// Deterministic WCAG contrast check for the major CSS color pairings (text 4.5:1, UI boundaries 3:1).
// Pairs are listed by hand and variable-based colors are read from site.css; translucent overlays are
// approximated by their worst-case opaque backdrop. This is not a full audit of every rendered pixel.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/build-lib.mjs';

const css = readFileSync(join(ROOT, 'site', 'site.css'), 'utf8');
const v = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`missing --${name}`);
  return m[1];
};
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const bg = v('bg'); const panel = v('panel'); const fg = v('fg'); const muted = v('muted');
const accent = v('accent'); const line = v('line'); const focus = v('focus'); const ok = v('ok');
const ARENA = '#1d2440';

/** @type {[string, string, string, number][]} */
export const PAIRS = [
  ['body text on page', fg, bg, 4.5],
  ['muted text on page', muted, bg, 4.5],
  ['muted text on panel', muted, panel, 4.5],
  ['text on panel/buttons', fg, panel, 4.5],
  ['links on page', '#ffd08a', bg, 4.5],
  ['brand link on page', accent, bg, 4.5],
  ['primary button text', '#1a1400', accent, 4.5],
  ['current nav entry text', '#1a1400', accent, 4.5],
  ['preview banner text', '#1a1400', '#ffe066', 4.5],
  ['Guard held (pressed) label', fg, '#1f5a36', 4.5],
  ['Punch active label', fg, '#5a2a2a', 4.5],
  ['counter badge text (r5 flat badge)', '#1a1400', accent, 4.5],
  ['cue text on cue strip', '#ffffff', panel, 4.5],
  ['WIND-UP label on cue strip', '#ffd08a', panel, 4.5],
  ['WIND-UP bar outline on cue strip', '#ffd08a', panel, 3],
  ['cue strip border on page', line, bg, 3],
  ['countdown number on its box', '#ffffff', '#0b0e1a', 4.5],
  ['instruction text on page', fg, bg, 4.5],
  ['cue / countdown text on dark arena', '#ffffff', ARENA, 4.5],
  ['Guard sub-label on panel', muted, panel, 4.5],
  ['share textarea', '#000000', '#ffffff', 4.5],
  ['health numbers on page', fg, bg, 4.5],
  ['arena placard text', '#ffd08a', '#000000', 4.5],
  ['intro subheading on panel', accent, panel, 4.5],
  ['fallback art YOU label', '#ffffff', '#2f6df0', 4.5],
  ['fallback art JACK label', '#000000', '#d8d8e0', 4.5],
  ['disabled Previous/Next label and note', muted, panel, 4.5],
  ['disabled Previous/Next note on page', muted, bg, 4.5],
  ['source card border on page', line, bg, 3],
  ['nav link border on page', line, bg, 3],
  ['panel border on page', line, bg, 3],
  ['panel border on panel', line, panel, 3],
  ['control border on page', fg, bg, 3],
  ['Guard held border on its fill', fg, '#1f5a36', 3],
  ['focus ring on page', focus, bg, 3],
  ['focus ring on panel', focus, panel, 3],
  ['health bar border vs page', fg, bg, 3],
  ['player bar fill vs bar track', ok, '#000000', 3],
  ['enemy bar fill vs bar track', accent, '#000000', 3],
  ['arena frame vs page', line, bg, 3],
];

// ---- Fly the Simulation (2026-10-18): text/UI pairs from game.css and sprite/scenery pairs read from art.js ----
import { THEMES, FLY_A } from '../games/2026-10-18/js/art.js';
const HOT = '#ffe14a'; const TAG = '#14141f'; const FLY_ARENA = '#0d1a2d';
PAIRS.push(
  ['fly: NEXT GAP tag text', TAG, HOT, 4.5],
  ['fly: OLD tag text', '#ffffff', TAG, 4.5],
  ['fly: WORLD UPDATED tag text', TAG, '#ffffff', 4.5],
  ['fly: tag borders vs bright scenery', TAG, '#bfe5a0', 3],
  ['fly: tag border (white) vs dark scenery', '#ffffff', FLY_ARENA, 3],
  ['fly: strip cue text on page', HOT, bg, 4.5],
  ['fly: Seams label on page', fg, bg, 4.5],
  ['fly: progress tick outline vs page', fg, bg, 3],
  ['fly: filled progress tick vs page', accent, bg, 3],
  ['fly: held steering label', '#1a1400', accent, 4.5],
  ['fly: steering border on page', fg, bg, 3],
  ['fly: disabled steering label on panel', muted, panel, 4.5],
  ['fly: utility label on panel', fg, panel, 4.5],
  ['fly: utility border vs page', line, bg, 3],
  ['fly: overlay text on panel', fg, panel, 4.5],
  ['fly: overlay border vs dark arena', fg, FLY_ARENA, 3],
  ['fly: Resume-room note on panel', HOT, panel, 4.5],
  ['fly: copy textarea', '#000000', '#ffffff', 4.5],
  ['fly: focus ring vs arena', focus, FLY_ARENA, 3],
);
// the fly must stand out from every scenery colour: body OR white outline reaches 3:1 against each background tile colour
for (const [name, t] of Object.entries(THEMES)) {
  const body = FLY_A.colors.b; const outline = FLY_A.colors.o;
  for (const [ch, col] of Object.entries(t.bg.colors)) {
    PAIRS.push([`fly sprite vs ${name} scenery "${ch}" (body or outline)`, ratio(body, col) >= ratio(outline, col) ? body : outline, col, 3]);
  }
  // wall body vs the scenery: the wall fill/line colour that is most visible against the scenery's lightest and darkest tiles
  const wallCols = [...Object.values(t.wall.colors), t.shade, t.edge]; // fills plus the 1px outline and gap lips drawn at the wall boundary
  for (const [ch, col] of Object.entries(t.bg.colors)) {
    const best = wallCols.reduce((a, c) => (ratio(c, col) > ratio(a, col) ? c : a), wallCols[0]);
    PAIRS.push([`fly wall vs ${name} scenery "${ch}" (strongest wall colour)`, best, col, 3]);
  }
}

export function run() {
  return PAIRS.map(([name, a, b, min]) => ({ name, fg: a, bg: b, min, ratio: ratio(a, b), pass: ratio(a, b) >= min }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = run();
  for (const r of rows) console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.ratio.toFixed(2)} (>=${r.min}) ${r.name}`);
  if (rows.some((r) => !r.pass)) process.exit(1);
}

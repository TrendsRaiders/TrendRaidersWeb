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
  ['counter badge text', '#000000', '#ffffff', 4.5],
  ['wind-up label on its box', '#ffd08a', '#000000', 4.5],
  ['cue / countdown text on dark arena', '#ffffff', ARENA, 4.5],
  ['Guard sub-label on panel', muted, panel, 4.5],
  ['share textarea', '#000000', '#ffffff', 4.5],
  ['health numbers on page', fg, bg, 4.5],
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

export function run() {
  return PAIRS.map(([name, a, b, min]) => ({ name, fg: a, bg: b, min, ratio: ratio(a, b), pass: ratio(a, b) >= min }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = run();
  for (const r of rows) console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.ratio.toFixed(2)} (>=${r.min}) ${r.name}`);
  if (rows.some((r) => !r.pass)) process.exit(1);
}

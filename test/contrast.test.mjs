import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, ratio } from '../scripts/check-contrast.mjs';

test('ratio helper matches known WCAG values', () => {
  assert.equal(ratio('#000000', '#ffffff').toFixed(1), '21.0');
  assert.equal(ratio('#777777', '#ffffff').toFixed(2), '4.48');
});

test('major text pairs meet 4.5:1 and UI boundaries/focus meet 3:1 (including Guard held)', () => {
  const rows = run();
  assert.ok(rows.some((r) => /Guard held/.test(r.name)));
  for (const r of rows) assert.ok(r.pass, `${r.name}: ${r.ratio.toFixed(2)} < ${r.min}`);
});

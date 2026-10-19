// Bigfoot: Take Two embed and share logic with injected fakes: exact 6000 ms timeout, one attempt, late callbacks never
// replace the fallback, and honest share outcomes. No network, no DOM library.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmbed, LOAD_TIMEOUT_MS, MSG, TWEET_ID } from '../games/2026-10-19/js/embed.js';
import { buildShareText, shareResult } from '../games/2026-10-19/js/share.js';

/** Minimal fake DOM/window: just what createEmbed touches. */
function rig({ api = 'ready' } = {}) {
  const timers = [];
  const el = () => ({ dataset: {}, textContent: '', className: '', children: [], appendChild(c) { this.children.push(c); c.parent = this; }, remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; }, clientWidth: 400 });
  const area = el(); const status = el(); const mount = el();
  const scripts = [];
  const doc = {
    getElementById: () => null,
    head: { appendChild: (s) => scripts.push(s) },
    createElement: () => { const e = el(); e.listeners = {}; e.addEventListener = (t, f) => { e.listeners[t] = f; }; return e; },
  };
  const calls = [];
  let settle;
  const win = {
    setTimeout: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].live = false; },
    twttr: api === 'ready' ? { ready: (cb) => cb(), widgets: { createTweet: (id, holder, opts) => { calls.push({ id, holder, opts }); return new Promise((res) => { settle = res; }); } } } : undefined,
  };
  return { area, status, mount, doc, win, timers, calls, scripts, settle: (v) => settle(v) };
}

test('constants: the Variety post id and a 6000 ms timeout', () => {
  assert.equal(TWEET_ID, '2111896526234505466');
  assert.equal(LOAD_TIMEOUT_MS, 6000);
  assert.equal(MSG.failed, 'X embed unavailable — read the source on X');
});

test('start() makes exactly one attempt with a 6000 ms timer and never retries', async () => {
  const r = rig();
  const e = createEmbed({ area: r.area, status: r.status, mount: r.mount, doc: r.doc, win: r.win });
  e.start(); e.start(); e.start();
  assert.equal(e.attempts, 1);
  assert.deepEqual(r.timers.map((t) => t.ms), [6000]);
  assert.equal(r.area.dataset.embedState, 'loading');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].id, '2111896526234505466');
  assert.equal(r.calls[0].opts.dnt, true);
});

test('timeout: fallback text appears at the timer, the holder is removed, and a LATE success changes nothing', async () => {
  const r = rig();
  const e = createEmbed({ area: r.area, status: r.status, mount: r.mount, doc: r.doc, win: r.win });
  e.start();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(r.mount.children.length, 1);
  r.timers[0].fn(); // 6000 ms elapsed
  assert.equal(e.state, 'failed');
  assert.equal(r.status.textContent, 'X embed unavailable — read the source on X');
  assert.equal(r.mount.children.length, 0, 'a late widget has no node in the page to render into');
  r.settle({ iframe: true }); // late success
  await Promise.resolve(); await Promise.resolve();
  assert.equal(e.state, 'failed');
  assert.equal(r.status.textContent, 'X embed unavailable — read the source on X');
  assert.equal(r.calls.length, 1, 'no retry');
});

test('success before the timeout is final and cancels the timer; a later timer callback changes nothing', async () => {
  const r = rig();
  const e = createEmbed({ area: r.area, status: r.status, mount: r.mount, doc: r.doc, win: r.win });
  e.start();
  await Promise.resolve(); await Promise.resolve();
  r.settle({ iframe: true });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(e.state, 'loaded');
  assert.equal(r.timers[0].live, false);
  r.timers[0].fn();
  assert.equal(e.state, 'loaded');
});

test('provider script error shows the fallback without retry', async () => {
  const r = rig({ api: 'none' });
  const e = createEmbed({ area: r.area, status: r.status, mount: r.mount, doc: r.doc, win: r.win });
  e.start();
  assert.equal(r.scripts.length, 1);
  r.scripts[0].listeners.error();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(e.state, 'failed');
  assert.equal(r.scripts.length, 1);
});

test('share text: actual count, edition date, honest win/loss wording, link only when verified', () => {
  assert.equal(buildShareText({ won: true, usable: 4, shots: 5 }, 'https://x.test/games/2026-10-19/'), 'Bigfoot: Take Two — I got 4/5 usable shots. A legend is born. It needs a sandwich. (2026-10-19) https://x.test/games/2026-10-19/');
  assert.match(buildShareText({ won: true, usable: 4, shots: 4 }), /I got 4\/4 usable shots\. A legend is born\. It needs a sandwich\. \(2026-10-19, preview build: not a released link\)$/);
  const loss = buildShareText({ won: false, usable: 2, shots: 4 });
  assert.match(loss, /Back to rehearsal\. The trees are on hourly rates\./);
  assert.doesNotMatch(loss, /legend|sandwich/i);
  assert.doesNotMatch(buildShareText({ won: true, usable: 4, shots: 5 }), /https?:/, 'a preview has no link');
});

test('shareResult: shared, cancelled (no state change), copy fallback, manual fallback', async () => {
  assert.equal(await shareResult('t', { share: async () => {} }), 'shared');
  assert.equal(await shareResult('t', { share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } }), 'cancelled');
  let copied = '';
  assert.equal(await shareResult('t', { clipboard: { writeText: async (v) => { copied = v; } } }), 'copied'); assert.equal(copied, 't');
  assert.equal(await shareResult('t', { share: async () => { throw new Error('nope'); }, clipboard: { writeText: async () => {} } }), 'copied');
  assert.equal(await shareResult('t', { clipboard: { writeText: async () => { throw new Error('denied'); } } }), 'manual');
  assert.equal(await shareResult('t', {}), 'manual');
});

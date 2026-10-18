// Fly the Simulation controller: screens, clock, inputs, pause/focus rules, result and sharing. Course rules live in
// engine.js, drawing in render.js. States: intro -> running <-> paused -> won/lost; Restart/Retry/Play again -> intro.
import { Sim, CFG } from './engine.js';
import { createRenderer, REVEAL_MS } from './render.js';
import { createEmbed } from './embed.js';
import { buildShareText, copyResult } from './share.js';

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const button = (id) => /** @type {HTMLButtonElement} */ (document.getElementById(id));
const config = JSON.parse($('site-config').textContent || '{}');
const shareUrl = typeof config.shareUrl === 'string' ? config.shareUrl : null;

const game = $('game');
const region = $('play-region');
const arena = $('arena');
const canvas = /** @type {HTMLCanvasElement} */ ($('scene'));
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const renderer = createRenderer(canvas);

/** @type {'intro'|'running'|'paused'|'won'|'lost'} */
let state = 'intro';
let armed = false; // Running, but the clock waits for the opening key/pointer to be released
const opening = new Set();
let sim = new Sim();
let eventCursor = 0;
let last = 0;
let raf = 0;
let revealStart = /** @type {number|null} */ (null);
let revealing = false;
let revealDone = false; // Skip, completion and reduced motion all land on the same static final frame
let revealRect = /** @type {{x:number,y:number,w:number,h:number}|null} */ (null);
let boundsW = 0;
let boundsH = 0;
let recentUtilPointer = -Infinity;
let liveFlip = false;

/** Held steering sources. Keys by e.code, pointers by pointerId; each maps to 'up' | 'down'. */
const keyHeld = new Map();
const ptrHeld = new Map();
const physDown = new Set();
let lastActivationKey = { code: '', at: -Infinity };

function announce(msg) {
  liveFlip = !liveFlip;
  $('live').textContent = msg + (liveFlip ? '' : ' ');
}
const setAttr = (el, name, value) => { if (el.getAttribute(name) !== String(value)) el.setAttribute(name, String(value)); };

// ---- input -----------------------------------------------------------------------------------
function syncInput() {
  const live = state === 'running' && !armed;
  const dirs = [...keyHeld.values(), ...ptrHeld.values()];
  const up = live && dirs.includes('up');
  const down = live && dirs.includes('down');
  sim.setHeld(up, down);
  button('btn-up').dataset.held = String(live && dirs.includes('up'));
  button('btn-down').dataset.held = String(live && dirs.includes('down'));
  game.dataset.held = up && down ? 'cancel' : up ? 'up' : down ? 'down' : 'none';
}
function clearInputs() {
  keyHeld.clear();
  ptrHeld.clear();
  syncInput();
}
const keyDir = (key) => {
  const k = key.length === 1 ? key.toLowerCase() : key;
  return k === 'ArrowUp' || k === 'w' ? 'up' : k === 'ArrowDown' || k === 's' ? 'down' : null;
};
const inRegion = () => region.contains(document.activeElement);

function onKeyDown(e) {
  physDown.add(e.code);
  const t = /** @type {Element|null} */ (e.target);
  if (t && t.closest && t.closest('#panel-intro, #panel-paused') && (e.key === 'Enter' || e.key === ' ')) lastActivationKey = { code: e.code, at: performance.now() };
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') {
    if (state === 'running') { e.preventDefault(); pause('escape', true); }
    return;
  }
  if (state !== 'running' || !inRegion()) return; // never intercept keys while reading News or using links
  const dir = keyDir(e.key);
  if (dir) {
    e.preventDefault(); // no page scroll while the play region owns gameplay focus
    if (armed || (e.repeat && !keyHeld.has(e.code))) return; // a held-over key needs a fresh press
    keyHeld.set(e.code, dir);
    syncInput();
    return;
  }
  const steerBtn = t && t.closest ? t.closest('.ctl') : null;
  if ((e.key === 'Enter' || e.key === ' ') && steerBtn) {
    e.preventDefault(); // keyboard activation of a steering button = hold while the key is down (no click)
    if (armed || (e.repeat && !keyHeld.has(e.code))) return;
    keyHeld.set(e.code, /** @type {HTMLElement} */ (steerBtn).dataset.dir);
    syncInput();
    return;
  }
  if (e.key === ' ' || e.key === 'PageUp' || e.key === 'PageDown' || e.key === 'Home' || e.key === 'End') e.preventDefault();
}
function onKeyUp(e) {
  physDown.delete(e.code);
  if (keyHeld.delete(e.code)) syncInput();
  if (opening.delete(e.code)) checkRelease();
  const t = /** @type {Element|null} */ (e.target);
  if ((e.key === 'Enter' || e.key === ' ') && state === 'running' && t && t.closest && t.closest('.ctl')) e.preventDefault();
}

function bindSteering() {
  for (const el of document.querySelectorAll('.ctl')) {
    const btn = /** @type {HTMLButtonElement} */ (el);
    const dir = btn.dataset.dir;
    btn.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      if (state !== 'running' || armed || btn.disabled) return;
      try { btn.setPointerCapture(e.pointerId); } catch { /* a lost capture still releases below */ }
      ptrHeld.set(e.pointerId, dir);
      syncInput();
    });
    const release = (/** @type {any} */ e) => { if (ptrHeld.delete(e.pointerId)) syncInput(); };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(type, release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => e.preventDefault()); // steering never acts through click
  }
  // Backstop: a pointer released anywhere (capture failure, finger slid away) can never leave steering latched.
  for (const type of ['pointerup', 'pointercancel']) {
    document.addEventListener(type, (/** @type {any} */ e) => {
      if (ptrHeld.delete(e.pointerId)) syncInput();
      if (opening.delete(`p${e.pointerId}`)) checkRelease();
    }, true);
  }
  arena.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---- state, panels, focus ------------------------------------------------------------------------
function setState(next) {
  state = next;
  game.dataset.state = next;
  const live = next === 'running';
  button('btn-up').disabled = !live;
  button('btn-down').disabled = !live;
  button('btn-pause').disabled = next === 'intro' || next === 'won' || next === 'lost'; // stays focusable while Paused (a Tab-out pause must not drop focus)
  button('btn-restart').disabled = next === 'intro';
  $('panel-intro').hidden = next !== 'intro';
  $('panel-paused').hidden = next !== 'paused';
  $('panel-result').hidden = next !== 'won' && next !== 'lost';
  syncInput();
  ensureLoop();
}

function ensureVisible() {
  const r = arena.getBoundingClientRect();
  if (r.top < 0 || r.bottom > window.innerHeight) game.scrollIntoView({ block: 'start', behavior: 'auto' });
}

function focusArena() { arena.focus({ preventScroll: true }); }

/** Fresh Intro: all course state reset, nothing moves, Start focused on retry/restart. */
function toIntro({ focusStart = true } = {}) {
  cancelFrame();
  sim = new Sim();
  eventCursor = 0;
  armed = false;
  opening.clear();
  revealStart = null; revealing = false; revealDone = false; revealRect = null;
  clearInputs();
  resetResultPanel();
  setState('intro');
  render();
  if (focusStart) {
    ensureVisible();
    $('btn-start').focus({ preventScroll: true });
    announce('Ready. Reach the banana. Follow the dashed gap when the world rebuilds. Press Start.');
  }
}

/** Which keys/pointers are still down for the activation that just clicked Start/Resume (the clock waits for them). */
function captureOpening(e) {
  opening.clear();
  const fromKeyboard = e && e.detail === 0 && physDown.has(lastActivationKey.code) && performance.now() - lastActivationKey.at < 2000;
  if (fromKeyboard) opening.add(lastActivationKey.code);
}
function checkRelease() {
  if (!armed || opening.size > 0) return;
  armed = false;
  sim.begin();
  clearInputs();
  last = performance.now();
  setAttr(game, 'data-armed', 'false');
  ensureLoop();
}
function enterRunning(e, message) {
  ensureVisible();
  clearInputs();
  armed = true;
  setAttr(game, 'data-armed', 'true');
  captureOpening(e);
  setState('running');
  focusArena();
  announce(message);
  checkRelease();
}

function startGame(e) {
  if (state !== 'intro' || document.hidden) return;
  e.preventDefault();
  e.stopPropagation(); // the activation is consumed: it never doubles as steering
  enterRunning(e, 'Started. Follow the dashed gap when the world rebuilds.');
}
function resumeGame(e) {
  if (state !== 'paused' || document.hidden) return;
  e.preventDefault();
  e.stopPropagation();
  enterRunning(e, 'Resumed.');
}

/** @param {string} reason @param {boolean} explicit */
function pause(reason, explicit) {
  if (state !== 'running') return;
  cancelFrame();
  armed = false;
  opening.clear();
  setAttr(game, 'data-armed', 'false');
  clearInputs();
  game.dataset.pausedBy = reason;
  setState('paused');
  const r = arena.getBoundingClientRect();
  const fits = r.top >= -0.5 && r.bottom <= window.innerHeight + 0.5 && r.height >= 180;
  $('room-note').hidden = fits;
  announce('Paused.');
  const ae = document.activeElement;
  if (reason !== 'focus' && (explicit || !ae || ae === document.body || region.contains(ae))) button('btn-resume').focus({ preventScroll: true });
  render();
}

// ---- frame loop --------------------------------------------------------------------------------
function cancelFrame() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
function ensureLoop() {
  if (raf) return;
  if ((state === 'running' && !armed) || (state === 'won' && revealing)) raf = requestAnimationFrame(frame);
}
function frame() {
  raf = 0;
  const now = performance.now();
  if (state === 'running' && !armed) {
    const gap = now - last;
    last = now;
    if (gap > CFG.maxFrameGapUs / 1000) { pause('gap', false); return; } // never jump through a hazard
    sim.advance(Math.max(0, gap) / 1000);
    flushEvents();
    render();
    if (sim.over) { finish(); return; }
  } else if (state === 'won' && revealing) {
    render();
    if (now - /** @type {number} */ (revealStart) >= REVEAL_MS) endReveal();
  }
  ensureLoop();
}

function flushEvents() {
  while (eventCursor < sim.events.length) {
    const ev = sim.events[eventCursor++];
    if (ev.type === 'preview') announce('World rebuilding. Follow the dashed gap.');
    else if (ev.type === 'commit') announce('World updated.');
  }
}

// ---- rendering ---------------------------------------------------------------------------------
function placeTag(el, cx, top) {
  const { W } = renderer.size;
  const w = el.offsetWidth;
  const left = Math.max(2, Math.min(W - w - 2, cx - w / 2));
  el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}
function updateTags() {
  const { W, H } = renderer.size;
  const S = renderer.scale;
  const tags = { old: $('tag-old'), next: $('tag-next'), upd: $('tag-updated') };
  /** @type {any} */ let pv = null;
  /** @type {any} */ let up = null;
  if (state !== 'intro' && state !== 'won') {
    for (const v of sim.seamViews()) {
      if (!v.visible) continue;
      if (v.previewing) pv = v;
      if (v.commitAgeUs >= 0 && v.commitAgeUs < 1_000_000) up = v;
    }
  }
  tags.old.hidden = tags.next.hidden = !pv;
  tags.upd.hidden = !up;
  if (pv) {
    const lip = Math.max(2, S) + 4;
    const hOld = tags.old.offsetHeight; const hNext = tags.next.offsetHeight;
    const oldFirst = pv.newCenter > pv.oldCenter; // old opening above the new one
    const oldTop = oldFirst ? (pv.oldCenter + CFG.gapHalf) * H + lip : (pv.oldCenter - CFG.gapHalf) * H - lip - hOld;
    const nextTop = oldFirst ? (pv.newCenter - CFG.gapHalf) * H - lip - hNext : (pv.newCenter + CFG.gapHalf) * H + lip;
    placeTag(tags.old, pv.x * W, oldTop);
    placeTag(tags.next, pv.x * W, nextTop);
  }
  if (up) {
    const h = tags.upd.offsetHeight; const w = tags.upd.offsetWidth;
    const left = Math.min((up.x + CFG.wallHalf) * W + 6, W - w - 2);
    tags.upd.style.transform = `translate(${Math.round(left)}px, ${Math.round((up.newCenter < 0.5 ? 0.64 : 0.36) * H - h / 2)}px)`;
  }
  const cs = $('cue-text');
  const kind = pv ? 'rebuild' : up ? 'updated' : '';
  if (cs.dataset.kind !== kind) {
    cs.dataset.kind = kind;
    cs.replaceChildren();
    if (kind) {
      const s = document.createElement('span'); s.className = 'cs'; s.textContent = kind === 'rebuild' ? 'REBUILDING' : 'UPDATED';
      const l = document.createElement('span'); l.className = 'cl'; l.textContent = kind === 'rebuild' ? 'REBUILDING — follow the dashed gap' : 'WORLD UPDATED';
      cs.append(s, l);
    }
  }
}

function render() {
  const rev = state === 'won' && revealStart !== null ? (revealDone || reduced() ? REVEAL_MS : Math.min(REVEAL_MS, performance.now() - revealStart)) : null;
  renderer.draw({ sim, reduced: reduced(), revealMs: rev, revealRect });
  updateTags();
  const n = sim.cleared;
  setText($('seam-count'), n);
  [...$('ticks').children].forEach((li, i) => setAttr(li, 'data-done', String(i < n)));
  setAttr(game, 'data-t-us', sim.tUs);
  setAttr(game, 'data-fly-y', sim.y.toFixed(6));
  setAttr(game, 'data-cleared', n);
  setAttr(canvas, 'data-scale', renderer.scale);
}
const textCache = new Map();
function setText(el, v) { const s = String(v); if (textCache.get(el) !== s) { textCache.set(el, s); el.textContent = s; } }

// ---- geometry: pause on a REAL arena change, ignore redundant events ----------------------------------
function onGeometry() {
  const r = arena.getBoundingClientRect();
  if (Math.abs(r.width - boundsW) < 0.5 && Math.abs(r.height - boundsH) < 0.5) return;
  const first = boundsW === 0;
  boundsW = r.width; boundsH = r.height;
  renderer.resize(r.width, r.height);
  if (!first && state === 'running') pause('layout', false);
  if (state === 'won' || state === 'lost') placeResult();
  render();
}
function onVisibility() {
  if (state !== 'running') return;
  const r = arena.getBoundingClientRect();
  const vis = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0)) * Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
  if (vis < 0.5 * r.width * r.height) pause('offscreen', false);
}

// ---- result ---------------------------------------------------------------------------------------
function resetResultPanel() {
  for (const id of ['result-copy', 'btn-again', 'btn-skip', 'btn-copy', 'copy-note', 'copy-text']) $(id).hidden = true;
  $('btn-retry').hidden = false;
  $('copy-note').textContent = '';
  delete game.dataset.outcome; delete game.dataset.hitSeam; delete game.dataset.hitY; delete game.dataset.pausedBy;
}
function shortLandscape() { return window.matchMedia('(orientation: landscape) and (max-height: 500px)').matches; }
function placeResult() {
  const panel = $('panel-result');
  const r = arena.getBoundingClientRect();
  let pos = 'bottom';
  if (shortLandscape() || (r.height < 300 && r.width / r.height > 1.6)) pos = 'right';
  else if (state === 'lost' && sim.collision && sim.collision.flyY > 0.5) pos = 'top';
  panel.dataset.pos = pos;
  if (state === 'won') {
    const c = panel.getBoundingClientRect();
    if (pos === 'right') revealRect = { x: 0, y: 0, w: Math.max(40, c.left - r.left - 8), h: r.height };
    else if (pos === 'top') revealRect = { x: 0, y: c.bottom - r.top + 8, w: r.width, h: Math.max(40, r.height - (c.bottom - r.top) - 8) };
    else revealRect = { x: 0, y: 0, w: r.width, h: Math.max(40, c.top - r.top - 8) };
  }
}
function finish() {
  cancelFrame();
  clearInputs();
  flushEvents();
  armed = false;
  const won = sim.status === 'won';
  setState(won ? 'won' : 'lost');
  game.dataset.outcome = won ? 'won' : 'lost';
  const heading = $('result-heading');
  if (won) {
    heading.textContent = 'You escaped the simulation.';
    $('result-copy').hidden = false;
    $('btn-retry').hidden = true;
    button('btn-again').hidden = false;
    button('btn-copy').hidden = false;
    revealStart = performance.now();
    revealing = !reduced();
    revealDone = !revealing;
    button('btn-skip').hidden = !revealing;
    canvas.setAttribute('aria-label', 'Reveal: the banana was a desktop icon labelled banana.png. A tiny fly climbed out of a miniature game window and took a bite, leaving a banana-shaped hole.');
  } else {
    heading.textContent = 'Bonk. Still in beta.';
    if (sim.collision) { game.dataset.hitSeam = String(sim.collision.seam); game.dataset.hitY = sim.collision.flyY.toFixed(6); }
    $('result-copy').hidden = true;
    $('btn-retry').hidden = false;
  }
  placeResult();
  render();
  announce(won ? 'You escaped the simulation. The banana was a desktop icon. World: fake. Lunch: real enough.' : 'Bonk. Still in beta. Retry is available.');
  heading.focus({ preventScroll: true });
  ensureLoop();
}
function endReveal() {
  if (!revealing) return;
  revealing = false;
  revealDone = true;
  button('btn-skip').hidden = true;
  if (document.activeElement === $('btn-skip')) button('btn-again').focus({ preventScroll: true });
  render();
}
async function onCopy() {
  const text = buildShareText(shareUrl);
  const note = $('copy-note');
  const ta = /** @type {HTMLTextAreaElement} */ ($('copy-text'));
  note.hidden = false;
  if ((await copyResult(text)) === 'copied') {
    ta.hidden = true;
    note.textContent = 'Copied to clipboard.';
    announce('Result copied to clipboard.');
  } else {
    ta.value = text;
    ta.hidden = false;
    ta.focus({ preventScroll: true });
    ta.select();
    note.textContent = 'Copy failed. Select the text below and copy it yourself.';
    announce('Copy failed. The result text is selected below for you to copy.');
  }
}

// ---- wiring --------------------------------------------------------------------------------------
function init() {
  bindSteering();
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('pointerdown', (e) => {
    const t = /** @type {Element|null} */ (e.target);
    if (t && t.closest && t.closest('#utils')) recentUtilPointer = performance.now();
  }, true);

  $('btn-start').addEventListener('click', startGame);
  $('btn-resume').addEventListener('click', resumeGame);
  $('btn-restart-paused').addEventListener('click', () => toIntro());
  $('btn-retry').addEventListener('click', () => toIntro());
  $('btn-again').addEventListener('click', () => toIntro());
  $('btn-skip').addEventListener('click', endReveal);
  $('btn-copy').addEventListener('click', onCopy);
  $('btn-pause').addEventListener('click', () => pause('button', true));
  $('btn-restart').addEventListener('click', () => toIntro());

  // Gameplay focus leaving the play region pauses (keeps the focus where the user put it).
  region.addEventListener('focusout', (e) => {
    if (state !== 'running') return;
    const next = /** @type {Node|null} */ (e.relatedTarget);
    if (next && region.contains(next)) return;
    if (next && $('utils').contains(next) && performance.now() - recentUtilPointer < 1000) return; // a tap on Pause/Restart acts on click
    pause('focus', false);
  });
  window.addEventListener('blur', () => { physDown.clear(); pause('blur', false); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { physDown.clear(); pause('hidden', false); } });
  window.addEventListener('pagehide', () => { clearInputs(); pause('hidden', false); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) toIntro({ focusStart: false }); });
  window.addEventListener('scroll', onVisibility, { passive: true });
  window.addEventListener('resize', onGeometry);
  window.addEventListener('orientationchange', onGeometry);
  if (typeof ResizeObserver === 'function') new ResizeObserver(onGeometry).observe(arena);
  if (typeof IntersectionObserver === 'function') new IntersectionObserver(onVisibility, { threshold: [0, 0.25, 0.5, 0.75, 1] }).observe(arena);

  onGeometry();
  toIntro({ focusStart: false }); // first entry: browser focus stays predictable, Start is first in the arena tab order
  createEmbed({ area: $('embed-area'), status: $('embed-status'), mount: $('embed-mount') }).start();
}
init();

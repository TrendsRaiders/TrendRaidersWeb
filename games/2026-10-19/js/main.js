// Bigfoot: Take Two controller: screens, active clock, the single POSE input path per device action, pause/focus rules,
// results, reveal and sharing. Rules live in engine.js, drawing in render.js. States: intro -> rolling -> walking ->
// shot_result -> (rolling ...) -> won | lost, with `paused` overlaying any active state; Restart/Retry always return to intro.
import { Take, ActiveClock, CFG, SHOTS, RESULT_TEXT, footX, targetSpan } from './engine.js';
import { createRenderer, REVEAL_MS } from './render.js';
import { createEmbed } from './embed.js';
import { buildShareText, shareResult } from './share.js';

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const button = (id) => /** @type {HTMLButtonElement} */ (document.getElementById(id));
const config = JSON.parse($('site-config').textContent || '{}');
const shareUrl = typeof config.shareUrl === 'string' ? config.shareUrl : null;
const isPreview = config.preview === true;

const game = $('game');
const region = $('play-region');
const arena = $('arena');
const canvas = /** @type {HTMLCanvasElement} */ ($('scene'));
const pose = button('btn-pose');
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const renderer = createRenderer(canvas);

let take = new Take();
const clock = new ActiveClock();
let paused = false;
let raf = 0;
/** Keys that were already down when Start/Resume was activated: they can never act as a POSE. */
const opening = new Set();
const physDown = new Set();
let lastActivationKey = { code: '', at: -Infinity };
let suppressClick = false; // a pointerdown already scored; its synthesized click must not score again
let lastKeyPoseAt = -Infinity;
let eventCursor = 0;
let liveFlip = false;
let boundsW = 0;
let boundsH = 0;
let sound = false;
let audio = /** @type {AudioContext|null} */ (null);
// reveal (win payoff): its own clock, advanced only by foreground frames, so hidden time never plays it
let revealMs = 0;
let revealing = false;
let revealDone = false;
let revealStamp = 0;
let revealRect = /** @type {{x:number,y:number,w:number,h:number}|null} */ (null);
let revealed = false;

const isActive = () => take.state === 'rolling' || take.state === 'walking' || take.state === 'shot_result';
const setAttr = (el, name, value) => { if (el.getAttribute(name) !== String(value)) el.setAttribute(name, String(value)); };
function announce(msg) {
  liveFlip = !liveFlip;
  $('live').textContent = msg + (liveFlip ? '' : ' ');
}

// ---- optional synthesized sound (off by default; never required to play) ---------------------------------------
function blip(freq, ms) {
  if (!sound) return;
  try {
    audio = audio || new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.value = 0.04;
    osc.connect(gain); gain.connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + ms / 1000);
  } catch { /* no audio available: silently stay silent */ }
}

// ---- state, panels, focus -----------------------------------------------------------------------------------
const visualState = () => (paused ? 'paused' : take.state);

function setState() {
  const vs = visualState();
  game.dataset.state = vs;
  game.dataset.engineState = take.state;
  const live = vs === 'rolling' || vs === 'walking' || vs === 'shot_result';
  // POSE is a real disabled button where it can never act (keeps focus order honest) and aria-disabled during the
  // stationary rolling lead-in and the result window, so focus is not dropped between shots.
  pose.disabled = !live;
  if (live && vs !== 'walking') pose.setAttribute('aria-disabled', 'true'); else pose.removeAttribute('aria-disabled');
  button('btn-pause').disabled = !(live || vs === 'paused');
  button('btn-pause').setAttribute('aria-pressed', String(paused));
  button('btn-restart').disabled = take.state === 'intro';
  $('panel-intro').hidden = vs !== 'intro';
  $('panel-paused').hidden = vs !== 'paused';
  $('panel-result').hidden = !(take.state === 'won' || take.state === 'lost') || paused;
}

function ensureVisible() {
  const r = arena.getBoundingClientRect();
  if (r.top < 0 || r.bottom > window.innerHeight) game.scrollIntoView({ block: 'start', behavior: 'auto' });
}

function resetResultPanel() {
  for (const id of ['btn-replay', 'btn-share', 'btn-skip', 'share-note', 'share-text']) $(id).hidden = true;
  $('contact').replaceChildren();
  $('result-copy').textContent = '';
  $('share-note').textContent = '';
  delete game.dataset.outcome;
  delete game.dataset.pausedBy;
  canvas.setAttribute('aria-label', 'Pixel stage: a homemade teal monster waddles toward a taped mark on a cardboard forest set');
}

/** Fresh intro: all counters and clocks reset, nothing moves; Start is focused on retry/restart/entry. */
function toIntro({ focusStart = true } = {}) {
  cancelFrame();
  take = new Take();
  clock.reset();
  eventCursor = 0;
  paused = false;
  opening.clear();
  suppressClick = false;
  revealing = false; revealDone = false; revealMs = 0; revealRect = null; revealed = false;
  resetResultPanel();
  setState();
  syncUI();
  render();
  if (focusStart) {
    ensureVisible();
    $('btn-start').focus({ preventScroll: true });
    announce('Ready. Get 4 of 5 usable shots. Press Start.');
  }
}

/** Which keys are still down for the keyboard activation that just clicked Start/Resume (they can never pose). */
function captureOpening(e) {
  opening.clear();
  const fromKeyboard = e && e.detail === 0 && physDown.has(lastActivationKey.code) && performance.now() - lastActivationKey.at < 2000;
  if (fromKeyboard) opening.add(lastActivationKey.code);
}

function startGame(e) {
  if (take.state !== 'intro' || document.hidden) return;
  e.preventDefault();
  e.stopPropagation(); // the activation is consumed: it never doubles as a POSE
  ensureVisible();
  captureOpening(e);
  take.begin();
  clock.reset();
  clock.rebase(performance.now());
  eventCursor = 0;
  setState();
  syncUI();
  render();
  pose.focus({ preventScroll: true });
  announce('Started. Shot 1 of 5. Rolling.');
  ensureLoop();
}

function resumeGame(e) {
  if (!paused || document.hidden) return;
  if (e) { e.preventDefault(); e.stopPropagation(); captureOpening(e); } else opening.clear();
  paused = false;
  delete game.dataset.pausedBy;
  clock.rebase(performance.now());
  setState();
  syncUI();
  render();
  pose.focus({ preventScroll: true });
  announce('Resumed.');
  ensureLoop();
}

/** @param {string} reason */
function pause(reason) {
  if (paused || !isActive()) return;
  cancelFrame();
  clock.stop();
  paused = true;
  opening.clear();
  suppressClick = false;
  game.dataset.pausedBy = reason;
  setState();
  const r = arena.getBoundingClientRect();
  $('room-note').hidden = r.top >= -0.5 && r.bottom <= window.innerHeight + 0.5 && r.height >= 160;
  announce('Paused.');
  const ae = document.activeElement;
  if (reason === 'button' || reason === 'escape' || !ae || ae === document.body || game.contains(ae)) button('btn-resume').focus({ preventScroll: true });
  syncUI();
  render();
}

// ---- the one POSE path ----------------------------------------------------------------------------------------
/** One fresh activation at "now". Ignored unless the attempt is live; the engine ignores anything but a walking shot. */
function handlePose() {
  if (paused || !isActive() || clock.lastStampMs === null) return;
  const now = performance.now();
  if ((now - clock.lastStampMs) * 1000 > CFG.maxFrameGapUs) { pause('stall'); return; } // never score across a stall
  const r = take.poseAt(clock.toActive(now));
  if (!r) return; // rolling lead-in, result window, or already consumed: ignored, never queued
  blip(r.kind === 'usable' ? 880 : 180, 90);
  flushEvents();
  syncUI();
  render();
  ensureLoop();
}

function onKeyDown(e) {
  physDown.add(e.code);
  const t = /** @type {Element|null} */ (e.target);
  if (t && t.closest && t.closest('#panel-intro, #panel-paused') && (e.key === 'Enter' || e.key === ' ')) lastActivationKey = { code: e.code, at: performance.now() };
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const inGame = !!t && !!t.closest && !!t.closest('#game');
  if (e.key === 'Escape') {
    if (!inGame) return; // never hijack Escape elsewhere on the page
    if (paused) { e.preventDefault(); resumeGame(null); } else if (isActive()) { e.preventDefault(); pause('escape'); }
    return;
  }
  if (e.key !== ' ' && e.key !== 'Enter') return;
  // only the stage and the POSE button own gameplay keys; navigation, footer, News and other buttons are untouched
  if (!t || (t !== arena && t !== pose)) return;
  e.preventDefault();
  if (e.repeat || opening.has(e.code) || paused || !isActive()) return; // holding never repeats; held-over keys never pose
  lastKeyPoseAt = performance.now();
  handlePose();
}
function onKeyUp(e) {
  physDown.delete(e.code);
  opening.delete(e.code);
  const t = /** @type {Element|null} */ (e.target);
  if ((e.key === 'Enter' || e.key === ' ') && (t === pose || t === arena)) e.preventDefault(); // no synthesized click after a key pose
}

function bindInput() {
  pose.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    suppressClick = true; // this press scores here, so its synthesized click must not
    handlePose();
  });
  pose.addEventListener('click', (e) => {
    e.preventDefault();
    if (suppressClick && e.detail > 0) { suppressClick = false; return; }
    suppressClick = false;
    if (e.detail === 0 && performance.now() - lastKeyPoseAt < 400) return; // keyboard already scored this activation
    handlePose(); // assistive technology / synthetic click: a separate, single path
  });
  pose.addEventListener('contextmenu', (e) => e.preventDefault());
  arena.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const t = /** @type {Element} */ (e.target);
    if (t.closest('.overlay, button')) return; // panels and their buttons are never the tap surface
    e.preventDefault();
    if (document.activeElement !== arena) arena.focus({ preventScroll: true });
    handlePose();
  });
  arena.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---- frame loop -------------------------------------------------------------------------------------------------
function cancelFrame() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
function ensureLoop() {
  if (raf) return;
  if ((isActive() && !paused) || (take.state === 'won' && revealing)) raf = requestAnimationFrame(frame);
}
function frame() {
  raf = 0;
  const now = performance.now();
  if (isActive() && !paused) {
    const f = clock.frame(now);
    if (!f.ok) { pause('stall'); return; } // a long foreground gap never silently fails a shot
    take.advanceTo(f.activeUs);
    flushEvents();
    syncUI();
    render();
    if (take.over) { finish(); return; }
  } else if (take.state === 'won' && revealing) {
    const gap = now - revealStamp;
    revealStamp = now;
    revealMs += gap > CFG.maxFrameGapUs / 1000 ? 0 : gap; // hidden/stalled time never advances the reveal
    render();
    if (revealMs >= REVEAL_MS) endReveal();
  }
  ensureLoop();
}

function flushEvents() {
  while (eventCursor < take.events.length) {
    const ev = take.events[eventCursor++];
    if (ev.type === 'shot' && ev.result) {
      announce(`Shot ${ev.result.shot}: ${RESULT_TEXT[ev.result.kind]}. Usable ${take.usable} of ${CFG.usableGoal}.`);
    }
  }
}

// ---- rendering -------------------------------------------------------------------------------------------------
const cache = new Map();
function setText(el, v) { const s = String(v); if (cache.get(el) !== s) { cache.set(el, s); el.textContent = s; } }

function syncUI() {
  const vs = visualState();
  setText($('shot-n'), take.shot);
  setText($('usable-n'), take.usable);
  const cue = $('cue');
  let label = '';
  let kind = '';
  const eng = take.state;
  if (vs !== 'paused') {
    if (eng === 'rolling') { label = 'ROLLING'; kind = 'rolling'; }
    else if (eng === 'shot_result' && take.result) {
      const ok = take.result.kind === 'usable';
      label = `${ok ? '✓' : '✗'} ${RESULT_TEXT[take.result.kind]}`;
      kind = ok ? 'ok' : 'bad';
    }
  }
  setText(cue, label);
  cue.hidden = !label;
  setAttr(cue, 'data-kind', kind);
  setAttr(game, 'data-t-us', take.totalUs);
  setAttr(game, 'data-phase-us', take.phaseUs);
  setAttr(game, 'data-shot', take.shot);
  setAttr(game, 'data-usable', take.usable);
  setAttr(game, 'data-misses', take.misses);
  setAttr(game, 'data-result', take.result ? take.result.kind : '');
  const i = Math.min(SHOTS.length, take.shot) - 1;
  const span = targetSpan(i);
  setAttr(game, 'data-target', `${span.left.toFixed(5)},${span.centre.toFixed(5)},${span.right.toFixed(5)}`);
  setAttr(game, 'data-foot-x', footX(eng === 'walking' ? take.phaseUs : 0).toFixed(5));
  if (eng === 'rolling' || eng === 'walking') { /* the live lead-in/crossing */ }
  setState();
}

function render() {
  const rev = take.state === 'won' && revealed ? (revealDone || reduced() ? REVEAL_MS : Math.min(REVEAL_MS, revealMs)) : null;
  const info = renderer.draw({
    state: take.state, shot: take.shot, phaseUs: take.phaseUs, result: take.result, reduced: reduced(), revealMs: rev, revealRect,
  });
  setAttr(canvas, 'data-scale', renderer.scale);
  const g = renderer.geometry;
  setAttr(arena, 'data-floor-y', g.floorY); setAttr(arena, 'data-band-top', g.bandTop); setAttr(arena, 'data-band-h', g.bandH);
  return info;
}

// ---- geometry: preserve state on resize, pause rather than restart if the stage becomes unreadable -----------
function onGeometry() {
  const r = arena.getBoundingClientRect();
  if (Math.abs(r.width - boundsW) < 0.5 && Math.abs(r.height - boundsH) < 0.5) return;
  const first = boundsW === 0;
  boundsW = r.width; boundsH = r.height;
  renderer.resize(r.width, r.height);
  if (!first && isActive() && (r.height < 140 || r.width < 240)) pause('layout');
  if (take.over) placeResult();
  render();
}
function onRotate() {
  if (isActive()) pause('rotate'); // a rotation pauses; no held input survives it
  onGeometry();
}

// ---- results ------------------------------------------------------------------------------------------------------
const shortLandscape = () => window.matchMedia('(orientation: landscape) and (max-height: 500px)').matches;
function placeResult() {
  const panel = $('panel-result');
  const r = arena.getBoundingClientRect();
  panel.dataset.pos = shortLandscape() || (r.height < 300 && r.width / r.height > 1.6) ? 'right' : 'bottom';
  if (take.state === 'won') {
    const c = panel.getBoundingClientRect();
    revealRect = panel.dataset.pos === 'right'
      ? { x: 0, y: 0, w: Math.max(40, c.left - r.left - 8), h: r.height }
      : { x: 0, y: 0, w: r.width, h: Math.max(40, c.top - r.top - 8) };
  }
}

function buildContact() {
  const items = [];
  for (let i = 0; i < CFG.shots; i++) {
    const p = take.photos[i];
    const kind = p ? p.kind : 'unused';
    const li = document.createElement('li');
    li.dataset.kind = kind;
    const c = document.createElement('canvas');
    c.width = 36; c.height = 30; c.setAttribute('aria-hidden', 'true');
    renderer.thumb(c, kind);
    const t = document.createElement('span');
    t.className = 'cs-text';
    const mark = kind === 'usable' ? '✓' : kind === 'unused' ? '–' : '✗';
    t.textContent = `${i + 1} ${mark}`;
    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = ` Shot ${i + 1}: ${p ? RESULT_TEXT[p.kind] : 'not taken'}`;
    li.append(c, t, sr);
    items.push(li);
  }
  $('contact').replaceChildren(...items);
}

function finish() {
  cancelFrame();
  flushEvents();
  const won = take.state === 'won';
  setState();
  game.dataset.outcome = won ? 'won' : 'lost';
  buildContact();
  $('result-heading').textContent = won ? 'That’s a wrap' : 'Out of takes';
  $('result-copy').textContent = won ? 'Usable take! A legend is born. It needs a sandwich.' : 'Back to rehearsal. The trees are on hourly rates.';
  button('btn-share').hidden = !won;
  button('btn-share').textContent = isPreview ? 'Share (preview)' : 'Share';
  button('btn-replay').hidden = !won;
  if (won) {
    revealed = true;
    revealMs = 0;
    revealStamp = performance.now();
    revealing = !reduced();
    revealDone = !revealing;
    button('btn-skip').hidden = !revealing;
    canvas.setAttribute('aria-label', 'Reveal: the set widens. A fan and a boom mic are in view, the monster opens its costume hood and accepts a sandwich beside a sign reading FOREST — FLAT PACK.');
  }
  placeResult();
  syncUI();
  render();
  announce(won ? `That’s a wrap. ${take.usable} of ${take.photos.length} usable shots. Usable take! A legend is born. It needs a sandwich.` : 'Out of takes. Back to rehearsal. The trees are on hourly rates. Retry is available.');
  $('result-heading').focus({ preventScroll: true });
  ensureLoop();
}
function endReveal() {
  if (!revealing) return;
  revealing = false;
  revealDone = true;
  button('btn-skip').hidden = true;
  if (document.activeElement === $('btn-skip')) button('btn-replay').focus({ preventScroll: true });
  render();
}
function replayReveal() {
  if (take.state !== 'won') return; // never changes the result or counters, never starts a fresh attempt
  revealed = true;
  revealMs = 0;
  revealStamp = performance.now();
  revealing = !reduced();
  revealDone = !revealing;
  button('btn-skip').hidden = !revealing;
  render();
  ensureLoop();
}
async function onShare() {
  const text = buildShareText({ won: take.state === 'won', usable: take.usable, shots: take.photos.length }, shareUrl);
  const note = $('share-note');
  const ta = /** @type {HTMLTextAreaElement} */ ($('share-text'));
  note.hidden = false;
  const outcome = await shareResult(text);
  if (outcome === 'manual') {
    ta.value = text; ta.hidden = false; ta.focus({ preventScroll: true }); ta.select();
    note.textContent = 'Copy failed. Select the text below and copy it yourself.';
    announce('Copy failed. The result text is selected below for you to copy.');
    return;
  }
  ta.hidden = true;
  note.textContent = outcome === 'shared' ? 'Shared.' : outcome === 'copied' ? 'Copied to clipboard.' : 'Share cancelled. Your result is unchanged.';
  announce(note.textContent);
}

// ---- wiring --------------------------------------------------------------------------------------------------------
function init() {
  bindInput();
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  $('btn-start').addEventListener('click', startGame);
  $('btn-resume').addEventListener('click', resumeGame);
  $('btn-restart-paused').addEventListener('click', () => toIntro());
  $('btn-retry').addEventListener('click', () => toIntro());
  $('btn-replay').addEventListener('click', replayReveal);
  $('btn-skip').addEventListener('click', endReveal);
  $('btn-share').addEventListener('click', onShare);
  $('btn-pause').addEventListener('click', (e) => { if (paused) resumeGame(e); else pause('button'); });
  $('btn-restart').addEventListener('click', () => toIntro());
  $('btn-sound').addEventListener('click', () => {
    sound = !sound;
    button('btn-sound').setAttribute('aria-pressed', String(sound));
    /** @type {Element} */ ($('btn-sound').querySelector('.u-txt')).textContent = sound ? 'Sound: on' : 'Sound: off';
    if (sound) blip(660, 80);
  });

  window.addEventListener('blur', () => { physDown.clear(); pause('blur'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { physDown.clear(); pause('hidden'); } });
  window.addEventListener('pagehide', () => { cancelFrame(); pause('hidden'); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) toIntro({ focusStart: false }); });
  window.addEventListener('resize', onGeometry);
  window.addEventListener('orientationchange', onRotate);
  const portrait = window.matchMedia('(orientation: portrait)');
  if (portrait.addEventListener) portrait.addEventListener('change', onRotate);
  if (typeof ResizeObserver === 'function') new ResizeObserver(onGeometry).observe(arena);

  onGeometry();
  toIntro({ focusStart: false });
  $('btn-start').focus({ preventScroll: true }); // route entry: Start is focused without scrolling the page away from the game
  createEmbed({ area: $('embed-area'), status: $('embed-status'), mount: $('embed-mount') }).start();
}
init();

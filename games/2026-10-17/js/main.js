// 30-Second KO controller: screens, clock, inputs, modals, sharing. Combat rules live in engine.js.
import { Sim, formatHundredths } from './engine.js';
import { ModalStack } from './modal.js';
import { buildShareText, shareResult } from './share.js';
import { renderArena, renderPayoff, BOXER_H, PAYOFF_W, PAYOFF_H } from './art.js';
import { createEmbed } from './embed.js';

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const config = JSON.parse($('site-config').textContent || '{}');
const shareUrl = typeof config.shareUrl === 'string' ? config.shareUrl : null; // set only for verified released editions
const BEST_KEY = 'trendraiders:thirty-second-ko:best-hundredths';

const app = $('app');
const region = $('play-region');
const arena = $('arena');
const guardBtn = $('btn-guard');
const punchBtn = $('btn-punch');
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** @type {'intro'|'countdown'|'playing'|'paused'|'result'} */
let state = 'intro';
let sim = new Sim();
let eventCursor = 0;
let clock = { base: 0, since: 0, running: false };
let countdown = { start: 0 };
let raf = 0;
let pendingPauseDialog = false;
/** @type {HTMLElement|null} */
let pendingOpener = null;
let pointerIsDown = false;
let lastActivation = -Infinity;
let cueUntil = 0;
let soundOn = false;
/** @type {AudioContext|null} */
let audio = null;
/** @type {import('./engine.js').SimResult|null} */
let lastResult = null;
const guardKeys = new Set();
const guardPointers = new Set();
const cache = new Map();

const modals = new ModalStack({
  page: $('page'),
  fallback: () => (state === 'intro' ? $('btn-start') : state === 'result' ? $('btn-retry') : arena),
  onChange: () => clearInputs(),
});

// ---- pixel art ----------------------------------------------------------------------------
const artCanvas = /** @type {HTMLCanvasElement} */ ($('art'));
const stage = $('stage');
/** @type {CanvasRenderingContext2D|null} */
let artCtx = null;
try { artCtx = artCanvas.getContext('2d'); } catch { artCtx = null; }
if (!artCtx) app.dataset.art = 'fallback'; // simple-shape fallback; cues and controls stay intact
const fallbackEl = $('art-fallback');
fallbackEl.hidden = !!artCtx;
let artKey = '';
let payoffTimers = [];

function paint(canvas, frame) {
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.putImageData(new ImageData(frame.data, frame.w, frame.h), 0, 0);
}
/**
 * The arena is whatever size CSS gives it. Sprites keep whole-number pixel size (`px`, chosen so a boxer is roughly
 * 25-40% of the arena height); the logical canvas is the arena size divided by px, rounded UP, and clipped by the
 * arena, so there are never side bars and nothing is stretched.
 */
function fitArena() {
  const box = arena.getBoundingClientRect(); // fractional CSS sizes (svh) are rounded up so the art always covers the arena
  const W = box.width; const H = box.height;
  if (!W || !H) return;
  const px = Math.max(1, Math.round((0.32 * H) / BOXER_H));
  const lw = Math.ceil(W / px); const lh = Math.ceil(H / px);
  if (artCanvas.width !== lw) artCanvas.width = lw;
  if (artCanvas.height !== lh) artCanvas.height = lh;
  artCanvas.style.width = `${lw * px}px`;
  artCanvas.style.height = `${lh * px}px`;
  artCanvas.dataset.px = String(px);
  artKey = '';
  drawArena(sim.now);
}
function fitPayoff() {
  const w = $('payoff').clientWidth || PAYOFF_W;
  const scale = Math.max(1, Math.min(3, Math.floor(w / PAYOFF_W)));
  const c = $('payoff-art');
  c.style.width = `${PAYOFF_W * scale}px`;
  c.style.height = `${PAYOFF_H * scale}px`;
  c.dataset.scale = String(scale);
}
function playerPose(t) {
  if (sim.stunned(t)) return 'stun';
  if (sim.actionActive(t) && sim.action) {
    const e = t - sim.action.start;
    return e < 100 ? 'startup' : e < 250 ? 'punch' : 'recover';
  }
  return sim.guardEffective(t) ? 'guard' : 'idle';
}
function drawArena(t) {
  const view = {
    player: playerPose(t),
    enemy: sim.aiView(t).phase,
    guard: sim.guardEffective(t),
    counter: sim.counterOpen(t),
    bob: !reduceMotion() && state === 'playing' ? Math.floor(performance.now() / 500) % 2 : 0,
    win: sim.result?.outcome === 'win',
  };
  artCanvas.dataset.playerPose = view.player;
  artCanvas.dataset.enemyPose = view.enemy;
  artCanvas.dataset.guard = view.guard ? 'on' : 'off';
  if (!artCtx) {
    $('fb-player').dataset.pose = view.player;
    $('fb-enemy').dataset.pose = view.enemy;
    return;
  }
  const key = `${view.player}|${view.enemy}|${view.guard}|${view.counter}|${view.bob}|${view.win}|${artCanvas.width}x${artCanvas.height}`;
  if (key === artKey) return;
  artKey = key;
  paint(artCanvas, renderArena(/** @type {any} */ (view), { w: artCanvas.width, h: artCanvas.height }));
}
function drawPayoff(stageNo) { paint(/** @type {HTMLCanvasElement} */ ($('payoff-art')), renderPayoff(stageNo)); }
function clearPayoffTimers() { payoffTimers.forEach((id) => clearTimeout(id)); payoffTimers = []; }

// ---- helpers ----------------------------------------------------------------------------
function setText(el, v) {
  const s = String(v);
  if (cache.get(el) !== s) { cache.set(el, s); el.textContent = s; }
}
let liveFlip = false;
function announce(msg) {
  liveFlip = !liveFlip;
  $('live').textContent = msg + (liveFlip ? '' : ' ');
}
function beep(freq, ms) {
  if (!soundOn || !audio) return;
  try {
    const o = audio.createOscillator();
    const g = audio.createGain();
    g.gain.value = 0.05;
    o.frequency.value = freq;
    o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + ms / 1000);
  } catch { /* sound is optional */ }
}
function simNow() {
  return clock.running ? clock.base + (performance.now() - clock.since) : clock.base;
}
function startRun() { clock.since = performance.now(); clock.running = true; }
function stopRun() { clock.base = simNow(); clock.running = false; }

function setState(next) {
  state = next;
  app.dataset.state = next;
  $('game').dataset.state = next;
  const playing = next === 'playing';
  /** @type {HTMLButtonElement} */ ($('btn-pause')).disabled = !(playing || next === 'countdown');
  const inert = next !== 'playing';
  guardBtn.setAttribute('aria-disabled', String(inert));
  punchBtn.setAttribute('aria-disabled', String(inert));
  arena.tabIndex = playing || next === 'countdown' ? 0 : -1;
  $('panel-intro').hidden = next !== 'intro'; // removed from layout and the accessibility tree outside Intro
  ensureLoop();
}

// ---- inputs -----------------------------------------------------------------------------
function heldGuard() { return guardKeys.size > 0 || guardPointers.size > 0; }

function clearInputs() {
  guardKeys.clear();
  guardPointers.clear();
  sim.clearInputs();
  guardBtn.setAttribute('aria-pressed', 'false');
}
function syncGuard() {
  const held = heldGuard();
  guardBtn.setAttribute('aria-pressed', String(held));
  if (state === 'playing') { sim.setGuard(simNow(), held); afterSim(); }
}
function requestPunch() {
  app.dataset.punchRequests = String(Number(app.dataset.punchRequests) + 1);
  if (state !== 'playing') return;
  if (sim.punch(simNow())) beep(220, 60);
  afterSim();
}
function inPlayRegion() { return region.contains(document.activeElement); }

function onKeyDown(e) {
  if (e.key === 'Escape') {
    if (modals.isOpen) {
      const top = modals.top;
      e.preventDefault();
      if (top === $('dlg-about')) closeAbout();
      else if (top === $('dlg-share')) modals.close($('dlg-share'));
      return; // Escape never resumes a Pause dialog
    }
    if (state === 'playing' || state === 'countdown') { e.preventDefault(); pauseGame(); }
    return;
  }
  if (modals.isOpen) return;
  if ((state !== 'playing' && state !== 'countdown') || !inPlayRegion()) return;
  const target = e.target;
  const onPunchBtn = target === punchBtn && e.key === 'Enter';
  const onGuardBtn = target === guardBtn && e.key === 'Enter';
  const isPunch = e.key === ' ' || e.key.toLowerCase() === 'j' || onPunchBtn;
  const isGuard = e.key.toLowerCase() === 'k' || e.key === 'Shift' || onGuardBtn;
  if (!isPunch && !isGuard) return;
  e.preventDefault(); // no scrolling / native button activation while handling game input
  lastActivation = performance.now();
  if (e.repeat || state !== 'playing') return; // one fresh press per attempt; countdown ignores input
  if (isPunch) requestPunch();
  else { guardKeys.add(e.code); syncGuard(); }
}
function onKeyUp(e) {
  if (guardKeys.delete(e.code)) syncGuard();
  if ((e.key === ' ' || e.key === 'Enter') && (e.target === punchBtn || e.target === guardBtn) && state === 'playing') {
    e.preventDefault(); // keeps native keyup-activation from firing a second punch
  }
}

function bindControls() {
  guardBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    lastActivation = performance.now();
    if (state !== 'playing') return;
    try { guardBtn.setPointerCapture(e.pointerId); } catch { /* fine: lost capture still releases */ }
    guardPointers.add(e.pointerId);
    syncGuard();
  });
  const release = (e) => { lastActivation = performance.now(); if (guardPointers.delete(e.pointerId)) syncGuard(); };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) guardBtn.addEventListener(type, release);
  punchBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); lastActivation = performance.now(); requestPunch(); });
  // Screen-reader style activation (click without a pointer/keyboard handler having fired).
  for (const btn of [guardBtn, punchBtn]) {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (performance.now() - lastActivation < 600) return;
      if (btn === punchBtn) requestPunch();
    });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  arena.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---- game flow --------------------------------------------------------------------------
function newGame() {
  clearPayoffTimers();
  artKey = '';
  sim = new Sim();
  eventCursor = 0;
  clock = { base: 0, since: 0, running: false };
  clearInputs();
  cueUntil = 0;
  delete app.dataset.outcome;
  setText($('cue'), '');
  render();
}

function showCountdown(n) {
  const el = $('countdown');
  el.hidden = false;
  setText(el, n);
}

/** Explicit Play/Resume/Retry/Restart: bring the whole play panel into view (instant, never animated) before 3-2-1. */
function positionPanel() {
  const g = $('game');
  const r = g.getBoundingClientRect();
  const fits = r.top >= 0 && r.bottom <= window.innerHeight;
  if (!fits || window.innerWidth < 900) g.scrollIntoView({ block: 'start', behavior: 'auto' });
}
const sizeKey = () => `${window.innerWidth}x${window.innerHeight}`;
let layoutKey = sizeKey();

function startCountdown() {
  setState('countdown');
  countdown = { start: performance.now() };
  showCountdown(3);
  arena.focus({ preventScroll: true });
  positionPanel();
  layoutKey = sizeKey();
  announce('Get ready.');
}

function beginPlaying() {
  $('countdown').hidden = true;
  clearInputs();
  setState('playing');
  startRun();
  arena.focus({ preventScroll: true });
  announce('Fight!');
}

function pauseGame({ dialog = true, opener = /** @type {HTMLElement|null} */ (document.activeElement) } = {}) {
  if (state !== 'playing' && state !== 'countdown') return;
  if (state === 'playing') {
    sim.advance(simNow());
    stopRun();
    if (sim.over) { finish(); return; }
  }
  clearInputs();
  $('countdown').hidden = true;
  setState('paused');
  announce('Paused.');
  if (!dialog) { pendingPauseDialog = true; pendingOpener = opener; return; }
  modals.open($('dlg-pause'), { opener, initial: () => $('btn-resume') });
}

/** Opens the Pause dialog that a focus-leave pause deferred, so the initiating click still lands. */
function flushPauseDialog() {
  if (!pendingPauseDialog) return;
  pendingPauseDialog = false;
  if (state === 'paused' && !modals.has($('dlg-pause'))) {
    modals.open($('dlg-pause'), { opener: pendingOpener, initial: () => $('btn-resume') });
  }
}

function autoPause() {
  if (state === 'playing' || state === 'countdown') pauseGame();
}

/**
 * Entry/reset: every first entry, route return, Restart (play or Pause) and Retry (any outcome) land here. The round is
 * reset immediately, the clock and AI do NOT start, and nothing but the Start button can begin it.
 */
function resetToIntro({ position = true } = {}) {
  modals.closeAll();
  pendingPauseDialog = false;
  stopRun();
  $('countdown').hidden = true;
  newGame();
  setState('intro');
  if (position) positionPanel();
  $('btn-start').focus({ preventScroll: true });
  announce('Ready? Block the hit. Punch on COUNTER. Press Start round.');
}

/** Start round (click, touch or native Enter/Space on the button): position, clear held input, then the existing 3-2-1. */
function startRound() {
  if (state !== 'intro' || document.hidden) return;
  positionPanel();
  clearInputs();
  newGame();
  startCountdown();
}

function resume() {
  modals.close($('dlg-pause'));
  startCountdown();
}

function restart() {
  resetToIntro();
}

function exitToLanding() {
  modals.closeAll();
  pendingPauseDialog = false;
  stopRun();
  clearInputs();
  window.location.assign('/');
}

function openAbout(opener) {
  if (state === 'playing' || state === 'countdown') pauseGame({ opener });
  flushPauseDialog();
  modals.open($('dlg-about'), { opener, initial: () => $('about-heading') });
}
function closeAbout() { modals.close($('dlg-about')); }

// ---- events, rendering, result -----------------------------------------------------------
function afterSim() {
  flushEvents();
  render();
  if (sim.over && state === 'playing') finish();
}

function cue(text, ms = 900) {
  setText($('cue'), text);
  cueUntil = performance.now() + ms;
}

function flushEvents() {
  while (eventCursor < sim.events.length) {
    const e = sim.events[eventCursor++];
    if (e.type === 'windup') { announce('Jack is winding up. Guard!'); beep(330, 80); }
    else if (e.type === 'strike' && e.result === 'block') { cue('BLOCK −4'); announce('Blocked. Counter now!'); beep(150, 90); }
    else if (e.type === 'strike') { cue('HIT YOU −22'); announce('You were hit and stunned.'); beep(100, 140); }
    else if (e.type === 'impact' && e.counter) { cue('COUNTER −20'); announce('Counter! Jack loses 20.'); beep(520, 120); }
    else if (e.type === 'impact') { cue('HIT JACK −3'); announce('Hit. Jack loses 3.'); beep(380, 60); }
    else if (e.type === 'cancel') announce('Your punch was canceled.');
  }
}

function render() {
  setText($('hp-player'), sim.playerHp);
  setText($('hp-enemy'), sim.enemyHp);
  $('bar-player').style.width = `${sim.playerHp}%`;
  $('bar-enemy').style.width = `${sim.enemyHp}%`;
  setText($('time-left'), sim.remainingSeconds);
  const t = sim.now;
  const view = sim.aiView(t);
  const wind = view.phase === 'windup';
  $('windup-wrap').hidden = !wind;
  if (wind) $('windup-fill').style.transform = `scaleX(${view.progress.toFixed(3)})`;
  $('counter-badge').hidden = !sim.counterOpen(t);
  drawArena(t);
  if (cueUntil && performance.now() > cueUntil) { cueUntil = 0; setText($('cue'), ''); }
}

function ensureLoop() {
  if (raf || (state !== 'playing' && state !== 'countdown')) return;
  raf = requestAnimationFrame(frame);
}
function frame() {
  raf = 0;
  if (state === 'countdown') {
    const n = 3 - Math.floor((performance.now() - countdown.start) / 1000);
    if (n <= 0) beginPlaying(); else showCountdown(n);
  } else if (state === 'playing') {
    sim.advance(simNow());
    afterSim();
  }
  ensureLoop();
}

function storedBest() {
  try { const v = Number(localStorage.getItem(BEST_KEY)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; }
}
function storeBest(h) {
  try { localStorage.setItem(BEST_KEY, String(h)); } catch { /* storage denied: play continues */ }
}

function finish() {
  stopRun();
  clearInputs();
  flushEvents();
  render();
  const r = sim.result;
  if (!r) return;
  lastResult = r;
  $('countdown').hidden = true;
  app.dataset.outcome = r.outcome;
  setState('result');

  const timeText = formatHundredths(r.hundredths);
  let head; let time; let title;
  if (r.outcome === 'win') {
    title = 'You win'; head = 'KO! You beat the 30-second headline.'; time = `KO time: ${timeText}s`;
  } else if (r.outcome === 'loss') {
    title = 'You lose'; head = 'KO — caught swinging. Block, then counter.'; time = `Knocked out at ${timeText}s`;
  } else if (r.reason === 'double-ko') {
    title = 'Draw'; head = 'Double KO — it’s a draw.'; time = `Both down at ${timeText}s`;
  } else {
    title = 'Draw'; head = '30 seconds. No KO — rematch?'; time = '30 seconds — no KO';
  }
  setText($('result-heading'), title);
  setText($('result-headline'), head);
  setText($('result-time'), time);
  setText($('result-health'), `Remaining health — You: ${r.playerHp} HP · Jack: ${r.enemyHp} HP`);

  const payoff = $('payoff');
  payoff.hidden = r.outcome !== 'win';
  payoff.classList.remove('anim');
  const skip = $('btn-skip-anim');
  skip.hidden = true;
  if (r.outcome === 'win') {
    setText($('payoff-time'), `${timeText}s`);
    fitPayoff();
    if (reduceMotion()) drawPayoff(3);
    else {
      payoff.classList.add('anim');
      skip.hidden = false;
      drawPayoff(0);
      [[330, 1], [660, 2], [900, 3]].forEach(([ms, n]) => payoffTimers.push(setTimeout(() => drawPayoff(n), ms)));
      payoffTimers.push(setTimeout(() => endPayoffAnim(), 1100));
    }
  }
  const best = $('result-best');
  best.hidden = true;
  if (r.outcome === 'win') {
    const prev = storedBest();
    if (prev === null || r.hundredths < prev) storeBest(r.hundredths);
    const b = storedBest();
    if (b !== null) { best.hidden = false; best.textContent = `Best KO time on this device: ${formatHundredths(b)}s`; }
  }
  const linked = !!shareUrl;
  $('btn-share').textContent = linked ? 'Share result' : 'Copy result';
  $('share-note').textContent = linked ? '' : 'Link sharing is off: this edition is not released yet, so the copied text has no link.';
  announce(`${title}. ${head} ${time}.`);
  $('result-heading').focus();
}

function endPayoffAnim() {
  clearPayoffTimers();
  drawPayoff(3);
  const payoff = $('payoff');
  const skip = $('btn-skip-anim');
  payoff.classList.remove('anim');
  if (document.activeElement === skip) $('btn-retry').focus();
  skip.hidden = true;
}

async function onShare() {
  if (!lastResult) return;
  const text = buildShareText({
    outcome: lastResult.outcome,
    timeText: formatHundredths(lastResult.hundredths),
    url: shareUrl,
  });
  const outcome = await shareResult({ text, linkAllowed: !!shareUrl });
  if (outcome === 'canceled') return; // result stays unchanged
  if (outcome === 'manual') {
    const ta = /** @type {HTMLTextAreaElement} */ ($('share-text'));
    ta.value = text;
    modals.open($('dlg-share'), { opener: $('btn-share'), initial: () => $('share-heading') });
    ta.select();
    return;
  }
  announce(outcome === 'shared' ? 'Result shared.' : 'Result copied to clipboard.');
  $('share-note').textContent = outcome === 'shared' ? 'Shared.' : 'Copied to clipboard.';
}

// ---- wiring -----------------------------------------------------------------------------
function init() {
  bindControls();
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);

  $('btn-start').addEventListener('click', startRound);
  $('btn-retry').addEventListener('click', () => resetToIntro());
  $('btn-restart-play').addEventListener('click', () => resetToIntro());
  $('btn-pause').addEventListener('click', () => pauseGame());
  $('btn-resume').addEventListener('click', resume);
  $('btn-restart').addEventListener('click', restart);
  $('btn-exit').addEventListener('click', exitToLanding);
  $('btn-share').addEventListener('click', onShare);
  $('btn-share-close').addEventListener('click', () => modals.close($('dlg-share')));
  $('btn-skip-anim').addEventListener('click', endPayoffAnim);
  $('btn-about-close').addEventListener('click', closeAbout);
  $('btn-about').addEventListener('click', () => openAbout($('btn-about')));
  $('btn-sound').addEventListener('click', () => {
    soundOn = !soundOn;
    if (soundOn && !audio) { try { audio = new (window.AudioContext || /** @type {any} */ (window).webkitAudioContext)(); } catch { audio = null; } }
    $('btn-sound').setAttribute('aria-pressed', String(soundOn));
    $('btn-sound').textContent = soundOn ? 'Sound: on' : 'Sound: off';
  });

  // Focus leaving the play region during play pauses; the Pause dialog opens once the click settles.
  region.addEventListener('focusout', (e) => {
    if (state !== 'playing' || modals.isOpen) return;
    const next = /** @type {Node|null} */ (e.relatedTarget);
    if (next && region.contains(next)) return;
    pauseGame({ dialog: false, opener: /** @type {HTMLElement|null} */ (next) });
    if (!pointerIsDown) setTimeout(flushPauseDialog, 0);
  });
  document.addEventListener('pointerdown', () => { pointerIsDown = true; }, true);
  document.addEventListener('pointerup', () => { pointerIsDown = false; setTimeout(flushPauseDialog, 50); }, true);
  document.addEventListener('pointercancel', () => { pointerIsDown = false; setTimeout(flushPauseDialog, 0); }, true);
  document.addEventListener('click', () => setTimeout(flushPauseDialog, 0));

  window.addEventListener('blur', autoPause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
  // One automatic official-widget attempt per mount; it never touches play, focus or input state.
  const embed = createEmbed({ area: $('embed-area'), status: $('embed-status'), mount: $('embed-mount'), retryButton: $('btn-retry-embed') });
  $('btn-retry-embed').addEventListener('click', () => embed.retry());
  window.addEventListener('pagehide', () => { clearInputs(); stopRun(); embed.suspend(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) { resetToIntro({ position: false }); embed.resume(); } });

  fitArena();
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { fitArena(); if ($('payoff').clientWidth) fitPayoff(); }).observe(arena);
  // Rotation/resize: clear input and pause an active round (health/time preserved) before the layout recomposes.
  const onResize = () => {
    const key = sizeKey();
    if (key !== layoutKey && (state === 'playing' || state === 'countdown')) pauseGame();
    layoutKey = key;
    fitArena(); fitPayoff();
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  newGame();
  setState('intro');
  $('btn-start').focus({ preventScroll: true });
  announce('Ready? Block the hit. Punch on COUNTER. Press Start round.');
  embed.start();
}

init();

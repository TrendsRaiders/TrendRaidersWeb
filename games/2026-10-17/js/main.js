// 30-Second KO controller: screens, clock, inputs, modals, sharing. Combat rules live in engine.js.
import { Sim, formatHundredths } from './engine.js';
import { ModalStack } from './modal.js';
import { buildShareText, shareResult } from './share.js';

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
  fallback: () => (state === 'intro' ? $('btn-play') : state === 'result' ? $('btn-retry') : arena),
  onChange: () => clearInputs(),
});

// ---- helpers ----------------------------------------------------------------------------
function setText(el, v) {
  const s = String(v);
  if (cache.get(el) !== s) { cache.set(el, s); el.textContent = s; }
}
function setAttr(el, name, v) {
  const s = String(v);
  const k = `${name}`;
  const key = el.id + ':' + k;
  if (cache.get(key) !== s) { cache.set(key, s); el.setAttribute(name, s); }
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
  const playing = next === 'playing';
  /** @type {HTMLButtonElement} */ ($('btn-pause')).disabled = !(playing || next === 'countdown');
  const inert = next !== 'playing';
  guardBtn.setAttribute('aria-disabled', String(inert));
  punchBtn.setAttribute('aria-disabled', String(inert));
  arena.tabIndex = playing || next === 'countdown' ? 0 : -1;
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

function startCountdown() {
  setState('countdown');
  countdown = { start: performance.now() };
  showCountdown(3);
  arena.focus();
  announce('Get ready.');
}

function beginPlaying() {
  $('countdown').hidden = true;
  clearInputs();
  setState('playing');
  startRun();
  arena.focus();
  $('game').scrollIntoView({ block: 'nearest' });
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

function resume() {
  modals.close($('dlg-pause'));
  startCountdown();
}

function restart() {
  modals.closeAll();
  newGame();
  startCountdown();
}

function goIntro() {
  modals.closeAll();
  pendingPauseDialog = false;
  stopRun();
  $('countdown').hidden = true;
  newGame();
  setState('intro');
  $('intro-heading').focus();
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
    else if (e.type === 'strike' && e.result === 'block') { cue('BLOCK! You −4'); announce('Blocked. Counter now!'); beep(150, 90); }
    else if (e.type === 'strike') { cue('HIT! You −22'); announce('You were hit and stunned.'); beep(100, 140); }
    else if (e.type === 'impact' && e.counter) { cue('COUNTER! Jack −20'); announce('Counter! Jack loses 20.'); beep(520, 120); }
    else if (e.type === 'impact') { cue('HIT! Jack −3'); announce('Hit. Jack loses 3.'); beep(380, 60); }
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
  setAttr($('fig-enemy'), 'data-pose', view.phase);
  const wind = view.phase === 'windup';
  $('windup-wrap').hidden = !wind;
  if (wind) $('windup-fill').style.transform = `scaleX(${view.progress.toFixed(3)})`;
  $('counter-badge').hidden = !sim.counterOpen(t);
  const fig = $('fig-player');
  setAttr(fig, 'data-pose', sim.actionActive(t) ? 'punch' : sim.stunned(t) ? 'stun' : 'idle');
  setAttr(fig, 'data-guard', sim.guardEffective(t) ? 'on' : 'off');
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
    if (!reduceMotion()) {
      payoff.classList.add('anim');
      skip.hidden = false;
      setTimeout(() => endPayoffAnim(), 1100);
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

  $('btn-play').addEventListener('click', () => { newGame(); startCountdown(); });
  $('btn-retry').addEventListener('click', () => { newGame(); startCountdown(); });
  $('btn-pause').addEventListener('click', () => pauseGame());
  $('btn-resume').addEventListener('click', resume);
  $('btn-restart').addEventListener('click', restart);
  $('btn-exit').addEventListener('click', goIntro);
  $('btn-share').addEventListener('click', onShare);
  $('btn-share-close').addEventListener('click', () => modals.close($('dlg-share')));
  $('btn-skip-anim').addEventListener('click', endPayoffAnim);
  $('btn-about-close').addEventListener('click', closeAbout);
  document.querySelectorAll('[data-open-about], #btn-about').forEach((b) => {
    b.addEventListener('click', () => openAbout(/** @type {HTMLElement} */ (b)));
  });
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
  window.addEventListener('pagehide', () => { clearInputs(); stopRun(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) goIntro(); });

  newGame();
  setState('intro');
}

init();

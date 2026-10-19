// Automatic official X (Twitter) embedded post for the news source. One attempt starts when the edition page mounts
// (start()); the provider script is loaded once and reused by Retry. Never moves focus, never touches gameplay,
// never retries on its own, and ignores callbacks from superseded attempts.

export const TWEET_ID = '2111278238253342868';
export const WIDGETS_SRC = 'https://platform.twitter.com/widgets.js';
export const LOAD_TIMEOUT_MS = 10000;
const SCRIPT_ID = 'x-widgets-script';
export const MSG = {
  loading: 'Loading source post from X…',
  loaded: 'Source post loaded from X.',
  failed: 'Post unavailable or blocked. You can still open the source on X.',
};

/**
 * @param {{ area: HTMLElement, status: HTMLElement, mount: HTMLElement, retryButton: HTMLElement,
 *   doc?: Document, win?: any, timeoutMs?: number }} o
 */
export function createEmbed({ area, status, mount, retryButton, doc = document, win = window, timeoutMs = LOAD_TIMEOUT_MS }) {
  /** @type {'idle'|'loading'|'loaded'|'failed'} */
  let state = 'idle';
  let timer = 0;
  let attempt = 0;
  let renderedFor = 0;
  let suspended = false;
  /** @type {Promise<any>|null} */
  let providerPromise = null;

  function set(next, message) {
    state = next;
    area.dataset.embedState = next;
    status.textContent = message;
    retryButton.hidden = next !== 'failed';
  }
  function clearTimer() { if (timer) { win.clearTimeout(timer); timer = 0; } }
  function fail() {
    clearTimer();
    if (state === 'loaded') return;
    set('failed', MSG.failed);
  }
  function succeed() {
    clearTimer();
    set('loaded', MSG.loaded);
  }
  const api = () => {
    const tw = win.twttr;
    return tw && tw.widgets && typeof tw.widgets.createTweet === 'function' ? tw : null;
  };

  /** The single provider script loader: reused while pending or loaded, replaced only after it failed. */
  function provider() {
    const ready = api();
    if (ready) return Promise.resolve(ready);
    if (providerPromise) return providerPromise;
    providerPromise = new Promise((resolve, reject) => {
      const old = doc.getElementById(SCRIPT_ID);
      if (old) old.remove();
      const script = doc.createElement('script');
      script.id = SCRIPT_ID;
      script.async = true;
      script.src = WIDGETS_SRC;
      script.charset = 'utf-8';
      const dead = () => { providerPromise = null; script.remove(); reject(new Error('provider unavailable')); };
      script.addEventListener('load', () => { const tw = api(); if (tw) resolve(tw); else dead(); });
      script.addEventListener('error', dead);
      doc.head.appendChild(script);
    });
    return providerPromise;
  }

  // Each attempt renders into its own holder; starting a new attempt detaches the previous holder, so a superseded
  // attempt can never show (or hide) anything and only the current attempt may change the state.
  function render(mine, twttr) {
    if (mine !== attempt || suspended || state === 'loaded' || renderedFor === mine) return;
    renderedFor = mine;
    const holder = doc.createElement('div');
    holder.className = 'embed-holder';
    mount.appendChild(holder);
    const width = Math.round(Math.min(550, Math.max(250, mount.clientWidth || 300)));
    const run = () => {
      let p;
      try {
        p = Promise.resolve(twttr.widgets.createTweet(TWEET_ID, holder, { conversation: 'none', dnt: true, theme: 'dark', align: 'center', width }));
      } catch { if (mine === attempt && !suspended) fail(); return; }
      p.then((el) => { if (mine !== attempt || suspended) return; if (el) succeed(); else fail(); },
        () => { if (mine === attempt && !suspended) fail(); });
    };
    if (typeof twttr.ready === 'function') twttr.ready(run); else run();
  }

  function begin() {
    attempt += 1;
    const mine = attempt;
    mount.textContent = '';
    set('loading', MSG.loading);
    clearTimer();
    timer = win.setTimeout(() => { if (mine === attempt && !suspended) fail(); }, timeoutMs);
    provider().then((tw) => render(mine, tw), () => { if (mine === attempt && !suspended) fail(); });
  }

  return {
    get state() { return state; },
    /** The one automatic attempt, called when the edition page mounts. */
    start() { if (state === 'idle') begin(); },
    /** Explicit Try loading again (only offered after a failure/timeout). */
    retry() { if (state === 'failed') begin(); },
    /** Page hidden/left: stale callbacks are ignored from now on. */
    suspend() { suspended = true; clearTimer(); },
    /** Returning to a restored page: at most one new attempt unless the post is already displayed. */
    resume() { suspended = false; if (state === 'loading' || state === 'failed') begin(); },
  };
}

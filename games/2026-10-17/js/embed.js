// Click-to-load official X (Twitter) embedded post for the news source. Nothing contacts X until load() is called.
// Uses the supported widgets.js API (twttr.widgets.createTweet). Never moves focus, never auto-retries.

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
 * @param {{ area: HTMLElement, status: HTMLElement, mount: HTMLElement, button: HTMLElement,
 *   doc?: Document, win?: any, timeoutMs?: number }} o
 */
export function createEmbed({ area, status, mount, button, doc = document, win = window, timeoutMs = LOAD_TIMEOUT_MS }) {
  /** @type {'idle'|'loading'|'loaded'|'failed'} */
  let state = 'idle';
  let timer = 0;
  let renderedFor = 0;
  let attempt = 0;
  let scriptFailed = false;
  let scriptLoaded = false;

  function set(next, message, label, disabled) {
    state = next;
    area.dataset.embedState = next;
    status.textContent = message;
    button.textContent = label;
    button.setAttribute('aria-disabled', String(disabled));
  }
  function clearTimer() { if (timer) { win.clearTimeout(timer); timer = 0; } }
  function fail() {
    clearTimer();
    if (state === 'loaded') return;
    set('failed', MSG.failed, 'Try loading again', false);
  }
  function succeed() {
    clearTimer();
    set('loaded', MSG.loaded, 'Source post loaded', true);
  }

  // Each attempt renders into its own holder. A retry detaches the previous holder, so content that a superseded
  // attempt appends later is never displayed, and only the current attempt may change the state.
  function render() {
    const mine = attempt;
    if (renderedFor === mine || state === 'loaded') return;
    const twttr = win.twttr;
    if (!twttr || !twttr.widgets || typeof twttr.widgets.createTweet !== 'function') { fail(); return; }
    renderedFor = mine;
    const holder = doc.createElement('div');
    holder.className = 'embed-holder';
    mount.appendChild(holder);
    const width = Math.round(Math.min(550, Math.max(250, mount.clientWidth || 300)));
    const run = () => {
      let p;
      try {
        p = Promise.resolve(twttr.widgets.createTweet(TWEET_ID, holder, { conversation: 'none', dnt: true, theme: 'dark', align: 'center', width }));
      } catch { if (mine === attempt) fail(); return; }
      // The same attempt's late success may replace its own timeout fallback; superseded attempts are ignored.
      p.then((el) => { if (mine !== attempt) return; if (el) succeed(); else fail(); },
        () => { if (mine === attempt) fail(); });
    };
    if (typeof twttr.ready === 'function') twttr.ready(run); else run();
  }

  function addScript() {
    let script = /** @type {HTMLScriptElement|null} */ (doc.getElementById(SCRIPT_ID));
    // A script that errored, or loaded without providing the widget API, is replaced on an explicit retry.
    if (script && (scriptFailed || scriptLoaded)) { script.remove(); script = null; scriptFailed = false; scriptLoaded = false; }
    if (script) return; // a slow attempt is still pending; its load handler will render
    script = doc.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = WIDGETS_SRC;
    script.charset = 'utf-8';
    script.addEventListener('load', () => { scriptLoaded = true; if (state !== 'idle') render(); });
    script.addEventListener('error', () => { scriptFailed = true; if (state === 'loading') fail(); });
    doc.head.appendChild(script);
  }

  return {
    get state() { return state; },
    /** Explicit user action only (first Load or Try loading again). */
    load() {
      if (state === 'loading' || state === 'loaded') return;
      mount.textContent = '';
      attempt += 1; // an explicit retry supersedes any attempt that never settled
      set('loading', MSG.loading, 'Loading…', true);
      clearTimer();
      timer = win.setTimeout(fail, timeoutMs);
      if (win.twttr && win.twttr.widgets) render(); else addScript();
    },
  };
}

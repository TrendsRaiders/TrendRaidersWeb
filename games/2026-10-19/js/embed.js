// Bigfoot: Take Two, the single automatic official X (Twitter) embed of the Variety post. Derived from the reviewed Fly
// edition's embed.js (kept separate so that edition's artifacts stay unchanged). Differences: the timeout is 6 s, the
// visible failure text is the spec wording, and the result of a LATE callback never replaces a settled outcome: after a
// timeout or error the holder is removed from the page so a late createTweet cannot inject layout.
// One attempt starts when the page mounts (start()); it never moves focus, never touches gameplay and never retries.

export const TWEET_ID = '2111896526234505466';
export const WIDGETS_SRC = 'https://platform.twitter.com/widgets.js';
export const LOAD_TIMEOUT_MS = 6000;
const SCRIPT_ID = 'x-widgets-script';
export const MSG = {
  loading: 'Loading the official post from X…',
  loaded: 'Official X post loaded.',
  failed: 'X embed unavailable — read the source on X',
};

/**
 * @param {{ area: HTMLElement, status: HTMLElement, mount: HTMLElement, tweetId?: string,
 *   doc?: Document, win?: any, timeoutMs?: number }} o
 */
export function createEmbed({ area, status, mount, tweetId = TWEET_ID, doc = document, win = window, timeoutMs = LOAD_TIMEOUT_MS }) {
  /** @type {'idle'|'loading'|'loaded'|'failed'} */
  let state = 'idle';
  let timer = 0;
  let attempts = 0;
  let rendered = false;
  /** @type {HTMLElement|null} */
  let holder = null;

  function set(next, message) {
    state = next;
    area.dataset.embedState = next;
    status.textContent = message;
  }
  function clearTimer() { if (timer) { win.clearTimeout(timer); timer = 0; } }
  function fail() {
    clearTimer();
    if (state !== 'loading') return; // settled outcomes (loaded or failed) are final
    set('failed', MSG.failed);
    if (holder) { holder.remove(); holder = null; } // a late widget renders into a detached node
  }
  function succeed() {
    if (state !== 'loading') return; // a late success after the fallback must not replace it
    clearTimer();
    set('loaded', MSG.loaded);
  }
  const api = () => {
    const tw = win.twttr;
    return tw && tw.widgets && typeof tw.widgets.createTweet === 'function' ? tw : null;
  };

  function provider() {
    const ready = api();
    if (ready) return Promise.resolve(ready);
    return new Promise((resolve, reject) => {
      const old = doc.getElementById(SCRIPT_ID);
      if (old) old.remove();
      const script = doc.createElement('script');
      script.id = SCRIPT_ID;
      script.async = true;
      script.src = WIDGETS_SRC;
      script.charset = 'utf-8';
      const dead = () => { script.remove(); reject(new Error('provider unavailable')); };
      script.addEventListener('load', () => { const tw = api(); if (tw) resolve(tw); else dead(); });
      script.addEventListener('error', dead);
      doc.head.appendChild(script);
    });
  }

  function render(twttr) {
    if (rendered || state !== 'loading') return;
    rendered = true;
    holder = doc.createElement('div');
    holder.className = 'embed-holder';
    mount.appendChild(holder);
    const target = holder;
    const width = Math.round(Math.min(550, Math.max(250, mount.clientWidth || 300)));
    const run = () => {
      let p;
      try {
        p = Promise.resolve(twttr.widgets.createTweet(tweetId, target, { conversation: 'none', dnt: true, theme: 'dark', align: 'center', width }));
      } catch { fail(); return; }
      p.then((el) => { if (el) succeed(); else fail(); }, fail);
    };
    if (typeof twttr.ready === 'function') twttr.ready(run); else run();
  }

  return {
    get state() { return state; },
    get attempts() { return attempts; },
    /** The one automatic attempt per page load; later calls do nothing. */
    start() {
      if (state !== 'idle') return;
      attempts += 1;
      set('loading', MSG.loading);
      timer = win.setTimeout(fail, timeoutMs);
      provider().then(render, fail);
    },
  };
}

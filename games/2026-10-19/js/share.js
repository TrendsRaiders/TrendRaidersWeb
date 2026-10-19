// Optional, user-initiated result sharing: Web Share when available, otherwise plain-text copy. Nothing is posted
// automatically. A link is appended only when the build config carries a verified edition URL; preview builds carry none
// and say so in the text.
export const EDITION = '2026-10-19';

/**
 * @param {{ won: boolean, usable: number, shots: number }} r
 * @param {string|null} [url] verified edition URL, or null in a preview
 */
export function buildShareText({ won, usable, shots }, url = null) {
  const head = won
    ? `Bigfoot: Take Two — I got ${usable}/${shots} usable shots. A legend is born. It needs a sandwich.`
    : `Bigfoot: Take Two — I got ${usable}/${shots} usable shots. Back to rehearsal. The trees are on hourly rates.`;
  return url ? `${head} (${EDITION}) ${url}` : `${head} (${EDITION}, preview build: not a released link)`;
}

/**
 * 'shared' when the system share sheet completed, 'cancelled' when the user dismissed it, 'copied' when the clipboard
 * accepted the text, otherwise 'manual' (the caller must show selectable text). Never claims success it did not get.
 * @param {string} text
 * @param {{ share?: (d: {text: string}) => Promise<void>, clipboard?: { writeText?: (t: string) => Promise<void> } }|undefined} [nav]
 */
export async function shareResult(text, nav = globalThis.navigator) {
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ text });
      return 'shared';
    } catch (e) {
      if (e && /** @type {any} */ (e).name === 'AbortError') return 'cancelled';
      // any other failure falls through to copy
    }
  }
  try {
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      await nav.clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    // denied or unavailable -> manual
  }
  return 'manual';
}

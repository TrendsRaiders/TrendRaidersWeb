// Result sharing: exact copy, optional released-edition link, Web Share -> clipboard -> selectable text.

/**
 * @param {{ outcome: 'win'|'loss'|'draw', timeText?: string, url?: string|null }} p
 * The link is appended only when the edition is verified released (url non-null).
 */
export function buildShareText({ outcome, timeText = '', url = null }) {
  const link = url ? ` ${url}` : '';
  if (outcome === 'win') return `I scored a KO in ${timeText}s in 30-Second KO. Can you beat my time?${link}`;
  return `Can you land a KO in 30 seconds? Try 30-Second KO:${link}`.replace(/:$/, '.');
}

/**
 * Explicit user action only. Returns one of:
 * 'shared' | 'canceled' | 'copied' | 'manual' (caller must show selectable fallback text).
 * Web Share is used only when a released link exists; otherwise the result is copied link-free.
 * @param {{ text: string, linkAllowed: boolean, nav?: any }} p
 */
export async function shareResult({ text, linkAllowed, nav = globalThis.navigator }) {
  if (linkAllowed && nav && typeof nav.share === 'function') {
    try {
      await nav.share({ text });
      return 'shared';
    } catch (err) {
      if (/** @type {any} */ (err)?.name === 'AbortError') return 'canceled';
      // other failures fall through to the clipboard
    }
  }
  try {
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      await nav.clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    // denied -> manual
  }
  return 'manual';
}

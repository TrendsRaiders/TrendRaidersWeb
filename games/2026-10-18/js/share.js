// Optional, user-initiated plain-text result copy. Preview builds have no URL; a stable canonical link is appended only
// when the build config carries a verified-release URL.
export const SHARE_TEXT = 'I escaped the simulation. The banana was a desktop icon. — Fly the Simulation, 2026-10-18';

/** @param {string|null} [url] */
export function buildShareText(url = null) {
  return url ? `${SHARE_TEXT} ${url}` : SHARE_TEXT;
}

/**
 * 'copied' when the clipboard accepted the text, otherwise 'manual' (the caller must show selectable text).
 * Never claims success it did not get.
 * @param {string} text
 * @param {{ clipboard?: { writeText?: (t: string) => Promise<void> } }|undefined} [nav]
 */
export async function copyResult(text, nav = globalThis.navigator) {
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

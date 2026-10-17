// Static site builder. Modes:
//   public  - only editions in the verified release registry get routes/navigation (default; production gate).
//   preview - additionally exposes preview-registry candidates with conspicuous "not released" framing.
import { cp, rm, mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Validate the release registry. Every entry needs explicit verification evidence; nothing is inferred. */
export function validateReleaseRegistry(reg) {
  if (!reg || reg.schema !== 1 || !Array.isArray(reg.editions)) throw new Error('release registry: expected {schema:1, editions:[]}');
  const seen = new Set();
  for (const e of reg.editions) {
    if (!DATE_RE.test(e.date || '')) throw new Error(`release registry: bad date ${JSON.stringify(e.date)}`);
    if (seen.has(e.date)) throw new Error(`release registry: duplicate ${e.date}`);
    seen.add(e.date);
    if (e.verified !== true) throw new Error(`release registry: ${e.date} is not verified:true`);
    if (!/^[0-9a-f]{7,64}$/.test(e.sha || '')) throw new Error(`release registry: ${e.date} needs the verified build sha`);
    if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(e.origin || '')) throw new Error(`release registry: ${e.date} needs an https origin without path`);
    if (!e.verification || typeof e.verification !== 'string') throw new Error(`release registry: ${e.date} needs a verification/authorization reference`);
  }
  return reg;
}

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }

/**
 * Content Security Policy for every page. Derived from the actual provider behavior (see docs/thirty-second-ko.md):
 * the click-to-load X embed needs scripts and frames from platform.twitter.com only. No 'unsafe-inline',
 * no wildcards. widgets.js's own inline CSP self-test <style> is intentionally left blocked (render still works).
 */
export const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' https://platform.twitter.com",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  'frame-src https://platform.twitter.com',
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
];
export const CSP = CSP_DIRECTIVES.join('; ');
const cspMeta = () => `<meta http-equiv="Content-Security-Policy" content="${esc(CSP)}">`;
const HEADERS_FILE = `/*\n  Content-Security-Policy: ${CSP}; frame-ancestors 'none'\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n`;

const longDate = (date) => shortDate(date);

/**
 * Previous/Next from verified RELEASED editions only (strictly earlier / later by UTC date). The selected
 * edition, even a preview candidate, only anchors the comparison and is never a destination.
 */
export function gameNeighbors(entries, currentDate) {
  const released = entries.filter((e) => !e.preview).map((e) => e.date).sort();
  const prev = released.filter((d) => d < currentDate).pop() ?? null;
  const next = released.find((d) => d > currentDate) ?? null;
  return { prev, next };
}

function renderGameNav(entries, currentDate) {
  const { prev, next } = gameNeighbors(entries, currentDate);
  const item = (kind, date) => {
    const arrow = kind === 'prev' ? '←' : '→';
    const label = kind === 'prev' ? 'Previous game' : 'Next game';
    const text = kind === 'prev' ? `<span aria-hidden="true">${arrow}</span> ${label}` : `${label} <span aria-hidden="true">${arrow}</span>`;
    if (date) {
      return `<div class="gn-item ${kind}"><a class="gn-link" href="/games/${date}/" data-gn="${kind}"><span class="gn-text">${text}</span> <small>${esc(longDate(date))}</small></a></div>`;
    }
    const note = kind === 'prev' ? 'No earlier released game' : 'No later released game';
    return `<div class="gn-item ${kind}"><button type="button" class="gn-link" disabled data-gn="${kind}"><span class="gn-text">${text}</span></button><span class="gn-note">${note}</span></div>`;
  };
  return `<nav class="game-nav" aria-label="Game navigation"><div class="gn-row">${item('prev', prev)}${item('next', next)}</div></nav>`;
}

function renderNav(entries, currentDate) {
  const items = entries.length
    ? entries.map((e) => {
      const label = e.preview ? `${shortDate(e.date)} — Preview (not released)` : shortDate(e.date);
      const cur = e.date === currentDate ? ' aria-current="page"' : '';
      return `<li><a href="/games/${e.date}/"${cur}>${esc(label)}</a></li>`;
    }).join('')
    : '<li class="empty">No game editions are released yet.</li>';
  return `<nav class="site-nav" aria-label="Game editions"><ul><li><a class="brand" href="/">Trend Raiders</a></li>${items}</ul></nav>`;
}

function fill(tpl, vars) {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{{${k}}}`).join(v);
  return out;
}

function notFoundPage(entries, mode) {
  const list = entries.length
    ? `<p>Available editions:</p><ul>${entries.map((e) => `<li><a href="/games/${e.date}/">${esc(shortDate(e.date))}${e.preview ? ' — Preview (not released)' : ''}</a></li>`).join('')}</ul>`
    : '<p>No game editions are released yet.</p>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found | Trend Raiders</title>${cspMeta()}<meta name="robots" content="noindex">
<link rel="icon" href="data:,"><link rel="stylesheet" href="/assets/site.css"></head>
<body>${mode === 'preview' ? '<p class="preview-banner">Preview — not released</p>' : ''}${renderNav(entries, null)}
<main id="main"><div class="not-found"><h1>Page not found</h1><p>There is no game edition at this address.</p>${list}<p><a href="/">Go to the home page</a></p></div></main></body></html>
`;
}

async function listFiles(dir, base = dir) {
  const out = [];
  for (const name of (await readdir(dir)).sort()) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) out.push(...await listFiles(p, base));
    else out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

/** Local git attribution (never from hosting env). Dirty or unknown trees are not exact-SHA artifacts. */
export function gitSource(cwd = ROOT) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const commit = git('rev-parse', 'HEAD').trim();
    const dirty = git('status', '--porcelain', '--untracked-files=all').trim().length > 0;
    return {
      commit, dirty, exactShaArtifact: !dirty,
      note: dirty ? 'UNCOMMITTED: built from a working tree with changes; not an exact-SHA artifact.' : 'Clean working tree at commit.',
    };
  } catch {
    return { commit: null, dirty: true, exactShaArtifact: false, note: 'UNCOMMITTED/UNKNOWN: git metadata unavailable; not an exact-SHA artifact.' };
  }
}

async function writeManifest(outDir, meta, o = {}) {
  const files = [];
  for (const path of await listFiles(outDir)) {
    const buf = await readFile(join(outDir, path));
    files.push({ path, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') });
  }
  const tree = createHash('sha256').update(files.map((f) => `${f.sha256}  ${f.path}\n`).join('')).digest('hex');
  // `source` is attribution only; it is deliberately outside treeSha256, which hashes output files.
  const manifest = { schema: 1, ...meta, source: o.source ?? gitSource(), treeSha256: tree, files };
  await writeFile(join(outDir, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/**
 * @param {{ mode?: 'public'|'preview', outDir?: string, gamesDir?: string, releaseRegistry?: string,
 *   previewRegistry?: string, publicDir?: string, siteDir?: string, source?: object }} [o]
 */
export async function build(o = {}) {
  const mode = o.mode ?? 'public';
  if (mode !== 'public' && mode !== 'preview') throw new Error(`unknown mode ${mode}`);
  const outDir = o.outDir ?? join(ROOT, 'dist');
  const gamesDir = o.gamesDir ?? join(ROOT, 'games');
  const publicDir = o.publicDir ?? join(ROOT, 'public');
  const siteDir = o.siteDir ?? join(ROOT, 'site');
  const released = validateReleaseRegistry(await readJson(o.releaseRegistry ?? join(ROOT, 'releases', 'registry.json'))).editions;
  const releasedDates = new Set(released.map((e) => e.date));

  /** @type {{date:string, preview:boolean, origin?:string}[]} */
  const entries = released.map((e) => ({ date: e.date, preview: false, origin: e.origin }));
  if (mode === 'preview') {
    const pv = await readJson(o.previewRegistry ?? join(ROOT, 'preview', 'registry.json'));
    for (const e of pv.editions || []) {
      if (!DATE_RE.test(e.date || '')) throw new Error(`preview registry: bad date ${JSON.stringify(e.date)}`);
      if (!releasedDates.has(e.date)) entries.push({ date: e.date, preview: true });
    }
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await cp(publicDir, outDir, { recursive: true });
  await mkdir(join(outDir, 'assets'), { recursive: true });
  await cp(join(siteDir, 'site.css'), join(outDir, 'assets', 'site.css'));

  const pages = new Map();
  for (const entry of entries) {
    const src = join(gamesDir, entry.date);
    let meta;
    try { meta = await readJson(join(src, 'edition.json')); } catch { throw new Error(`edition ${entry.date}: missing source in ${src}`); }
    if (meta.date !== entry.date) throw new Error(`edition ${entry.date}: edition.json date mismatch`);
    const dest = join(outDir, 'games', entry.date);
    await cp(src, dest, { recursive: true });
    await rm(join(dest, 'index.html'));
    await rm(join(dest, 'edition.json'));
    const shareUrl = entry.preview ? null : `${entry.origin}/games/${entry.date}/`;
    const config = JSON.stringify({ mode, date: entry.date, preview: entry.preview, shareUrl }).replace(/</g, '\\u003c');
    const html = fill(await readFile(join(src, 'index.html'), 'utf8'), {
      title: esc(entry.preview ? `${meta.title} — Preview (not released)` : meta.title),
      description: esc(meta.description),
      robots: entry.preview ? '<meta name="robots" content="noindex">' : '',
      banner: entry.preview ? '<p class="preview-banner" role="note">Preview — not released</p>' : '',
      nav: renderNav(entries, entry.date),
      gamenav: renderGameNav(entries, entry.date),
      csp: cspMeta(),
      config,
    });
    pages.set(entry.date, html);
    await writeFile(join(dest, 'index.html'), html);
  }

  // Root: latest released edition; a preview build may open the latest candidate (with its banner) instead.
  let rootKind = 'scaffold';
  const latestPreview = [...entries].reverse().find((e) => e.preview);
  const latestReleased = [...entries].reverse().find((e) => !e.preview);
  const rootEntry = mode === 'preview' && latestPreview ? latestPreview : latestReleased;
  if (rootEntry) {
    await writeFile(join(outDir, 'index.html'), /** @type {string} */ (pages.get(rootEntry.date)));
    rootKind = rootEntry.preview ? 'preview-candidate' : 'latest-released';
  }
  await writeFile(join(outDir, '404.html'), notFoundPage(entries, mode));
  await writeFile(join(outDir, '_headers'), HEADERS_FILE);

  return writeManifest(outDir, {
    mode,
    root: rootKind,
    releasedEditions: released.map((e) => ({ date: e.date, sha: e.sha, origin: e.origin })),
    previewEditions: entries.filter((e) => e.preview).map((e) => e.date),
  }, o);
}

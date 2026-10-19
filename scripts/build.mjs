import { build } from './lib/build-lib.mjs';

// `node scripts/build.mjs` = public build (editions in releases/registry.json: verified releases or pending public candidates; draft-only until approved).
// `node scripts/build.mjs --preview` = explicit preview build (candidate shown, labeled not released).
const mode = process.argv.includes('--preview') ? 'preview' : 'public';
const manifest = await build({ mode });
console.log(`Built ${mode} -> dist/ (root: ${manifest.root}, released: ${manifest.releasedEditions.length}, preview: ${manifest.previewEditions.length}, tree ${manifest.treeSha256.slice(0, 12)})`);
console.log(`Source: ${manifest.source.commit ?? 'unknown'} — ${manifest.source.note}`);

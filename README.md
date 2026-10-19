# Trend Raiders Web

Static site, vanilla HTML/CSS/ES modules, no framework, no runtime dependencies, no remote assets, no backend. The *live* site is still the "Hello, world!" scaffold. This branch stages a **public-mode release candidate** (30-Second KO + Fly the Simulation, see [docs/public-release-candidate.md](docs/public-release-candidate.md)); it is not live and nothing in the repository says a release happened.

The repository also contains the *candidate* edition **30-Second KO** (`games/2026-10-17/`, spec r3). Its source and art live here, but it is published only by the explicit preview build, never by the normal build.

The repository also contains a second *candidate*, **Fly the Simulation** (`games/2026-10-18/`, spec r1, UTC edition 2026-10-18): preview-only too, listed in `preview/registry.json` and never in `releases/registry.json`. See [docs/fly-the-simulation.md](docs/fly-the-simulation.md).

## Requirements and setup

Node.js 20+. Dev dependencies (`typescript`, `playwright-core`, `@types/node`) are only for checks and browser tests; the build itself uses Node built-ins.

```sh
npm install
```

## Build commands

```sh
npm run build           # public build -> dist/ (registry editions only: the two PENDING candidates, root = latest, dated production share URLs)
npm run build:preview   # explicit preview build -> dist/ (candidate labeled "Preview — not released")
```

- **Public build** publishes the scaffold files plus a route, navigation entry and dated production share URL for every entry in `releases/registry.json`. The registry now holds the two edition candidates (`verified:false`, `status:"candidate-pending-approval"`), so the output is root = the latest edition (Fly), `/games/2026-10-17/` and `/games/2026-10-18/`, `404.html`, `assets/site.css`, `_headers` and `build-manifest.json`; with an empty registry the output is just the scaffold. Hosting environment variables (such as Netlify's `URL`) are never read.
- **Preview build** also adds the candidates in `preview/registry.json`: route `/games/2026-10-17/`, nav entry "17 Oct 2026 — Preview (not released)", a conspicuous banner, `noindex`, and root opening the candidate under that banner. Share text stays link-free in preview.
- Both builds write `dist/build-manifest.json`: per-file SHA-256, a tree hash and the mode/root/edition lists, plus a `source` block with the full local `git rev-parse HEAD` and a dirty flag (from `git status`, never from hosting env). A dirty or git-less build says `UNCOMMITTED` and `exactShaArtifact: false` and must not be presented as an exact-SHA artifact. `source` is outside `treeSha256`, which hashes output files only, so the tree hash stays reproducible for the same code.
- `dist/404.html` is the honest not-found page (lists only available editions). Routes are real static `…/index.html` directories, so direct loads, refresh and back/forward need no client-side router.

### Release gate

An edition becomes public only by adding an entry to `releases/registry.json`:

```json
{ "date": "2026-10-17", "verified": true, "sha": "<verified build sha>", "origin": "https://<production origin>", "verification": "<authorization/verification reference>" }
```

A pending candidate (staged for an authorized draft, NOT a release) has the form `{ "date": "2026-10-17", "verified": false, "status": "candidate-pending-approval", "sourceSha": "<40-hex commit of its game files>", "origin": "https://<production origin>", "approval": "pending: …" }`; release timestamps are rejected (an edition date is not a release date) and the preview build ignores candidates. Every field is validated; an incomplete entry or one without source in `games/<date>/` fails the build. Do not add an entry until a release is verified and authorized. The entry's `origin` is the only source of the share link (`origin + /games/<date>/`). Root then opens the latest released edition.

## Checks and tests

```sh
npm run check         # tsc --checkJs over games/**/js and scripts, plus the CSS contrast check
npm test              # node:test: combat engine (fake clock), build/registry/routing/manifest, release fixtures
npm run check:embed-real  # network: real X provider under the production CSP; automatic embed, no interaction (add `-- --url <origin>` for a hosted preview); not in test:all
node scripts/verify-hosted.mjs --url <draft origin> --sha <commit>   # hosted draft verifier for the BOXING edition only (hardcodes 2026-10-17)
node scripts/verify-hosted-fly.mjs --url <draft origin> --sha <commit> --out <outside repo>   # hosted draft verifier for Fly the Simulation (manifest, assets, _headers, preservation, gameplay, geometry)
node scripts/capture-evidence.mjs --out <dir outside the repo>       # Fly screenshots + measurements at the five named viewports
npm run check:embed-real -- --edition 2026-10-18                      # real provider check for either edition (default 2026-10-17)
npm run test:browser  # real Chromium via playwright-core (default /usr/bin/chromium; override with CHROMIUM_PATH)
npm run test:all      # all of the above
```

Details, coverage and limitations: [docs/thirty-second-ko.md](docs/thirty-second-ko.md).

## Layout

| Path | Purpose |
|---|---|
| `public/` | Scaffold root (published always) |
| `site/site.css` | Shared navigation/chrome styles |
| `games/<date>/` | Edition source (`edition.json`, `index.html` template, assets) |
| `games/2026-10-17/js/engine.js` | Deterministic combat simulation (no DOM) |
| `games/2026-10-18/js/engine.js` | Deterministic seven-seam course and collision rules (no DOM) |
| `games/2026-10-18/js/{art,render,main,embed,share}.js` | Fly pixel sprites, canvas painter, controller, automatic embed (8 s), plain-text copy |
| `releases/registry.json` | Public-build editions: two pending release candidates (see docs/public-release-candidate.md) |
| `preview/registry.json` | Preview-only candidates |
| `scripts/` | Build CLI and library; Fly verifier, evidence capture and scripted player in `scripts/lib/` |
| `test/` | Node tests; `test/browser/` Chromium tests |

## Netlify

`netlify.toml` sets build command `npm run build` (the public build) and publish directory `dist`. No site is linked, no credentials are stored, and the **deployment contract for the game is unconfigured**: nothing here deploys, and the repository authorizes no production deploy. Netlify installs dev dependencies by default, so `npm run build` still works there; the build needs none of them. A preview deploy would need its own command (`npm run build:preview`) configured outside this repo, after the deployment contract is verified.

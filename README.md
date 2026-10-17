# Trend Raiders Web

Static site, vanilla HTML/CSS/ES modules, no framework, no runtime dependencies, no remote assets, no backend. The public root is still the honest "Hello, world!" scaffold: **no game edition is released**.

The repository also contains the *candidate* edition **30-Second KO** (`games/2026-10-17/`, spec r3). Its source and art live here, but it is published only by the explicit preview build, never by the normal build.

## Requirements and setup

Node.js 20+. Dev dependencies (`typescript`, `playwright-core`, `@types/node`) are only for checks and browser tests; the build itself uses Node built-ins.

```sh
npm install
```

## Build commands

```sh
npm run build           # public build -> dist/ (verified release registry only)
npm run build:preview   # explicit preview build -> dist/ (candidate labeled "Preview — not released")
```

- **Public build** publishes the scaffold root plus an edition route and navigation entry for every entry in `releases/registry.json`. That registry is empty, so the output is the scaffold, `404.html` ("No game editions are released yet"), `assets/site.css` and `build-manifest.json`. Hosting environment variables (such as Netlify's `URL`) are never read, so a scaffold domain cannot cause a release or a share link.
- **Preview build** also adds the candidates in `preview/registry.json`: route `/games/2026-10-17/`, nav entry "17 Oct 2026 — Preview (not released)", a conspicuous banner, `noindex`, and root opening the candidate under that banner. Share text stays link-free in preview.
- Both builds write `dist/build-manifest.json`: per-file SHA-256, a tree hash and the mode/root/edition lists, plus a `source` block with the full local `git rev-parse HEAD` and a dirty flag (from `git status`, never from hosting env). A dirty or git-less build says `UNCOMMITTED` and `exactShaArtifact: false` and must not be presented as an exact-SHA artifact. `source` is outside `treeSha256`, which hashes output files only, so the tree hash stays reproducible for the same code.
- `dist/404.html` is the honest not-found page (lists only available editions). Routes are real static `…/index.html` directories, so direct loads, refresh and back/forward need no client-side router.

### Release gate

An edition becomes public only by adding an entry to `releases/registry.json`:

```json
{ "date": "2026-10-17", "verified": true, "sha": "<verified build sha>", "origin": "https://<production origin>", "verification": "<authorization/verification reference>" }
```

Every field is validated; an incomplete entry or one without source in `games/<date>/` fails the build. Do not add an entry until a release is verified and authorized. The entry's `origin` is the only source of the share link (`origin + /games/<date>/`). Root then opens the latest released edition.

## Checks and tests

```sh
npm run check         # tsc --checkJs over games/**/js and scripts, plus the CSS contrast check
npm test              # node:test: combat engine (fake clock), build/registry/routing/manifest, release fixtures
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
| `releases/registry.json` | Verified released editions (empty) |
| `preview/registry.json` | Preview-only candidates |
| `scripts/` | Build CLI and library |
| `test/` | Node tests; `test/browser/` Chromium tests |

## Netlify

`netlify.toml` sets build command `npm run build` (the public build) and publish directory `dist`. No site is linked, no credentials are stored, and the **deployment contract for the game is unconfigured**: nothing here deploys, and the repository authorizes no production deploy. Netlify installs dev dependencies by default, so `npm run build` still works there; the build needs none of them. A preview deploy would need its own command (`npm run build:preview`) configured outside this repo, after the deployment contract is verified.

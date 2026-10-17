# Trend Raiders Web

Minimal static scaffold: a responsive, accessible "Hello, world!" page. Plain HTML/CSS, no framework, no runtime dependencies, no remote assets.

## Setup

Requires Node.js 20+. There is nothing to install (`package.json` has no dependencies).

## Build

```sh
npm run build
```

Copies `public/` to `dist/`.

## Test

```sh
npm test
```

Runs a `node:test` check that builds the site and verifies output and page structure.

## View locally

After building, open `dist/index.html` in a browser, or serve it:

```sh
npx --no-install serve dist   # if you have a static server installed
python3 -m http.server --directory dist 8000
```

## Netlify

`netlify.toml` sets build command `npm run build` and publish directory `dist`. No site is linked and no credentials are stored in this repo.

Draft preview only (requires you to be logged in and linked to a site yourself):

```sh
netlify deploy --dir=dist
```

Do not pass `--prod`. Production deploys are not authorized by this repository.

# Public two-edition release candidate (30-Second KO + Fly the Simulation)

## Purpose and scope

This branch stages one **public-mode** artifact containing both editions so an exact clean commit can be deployed as a **draft** and verified. It is **not live and not a verified release**: nothing in the repository, the build output or the tests says that a release happened. This is **draft-only**: Exact-SHA PM acceptance, explicit human production approval of that exact SHA/destination AND the verified production safeguards in deployment.md are all required first; merging or publishing never grants approval. It carries no permission to merge. No game file was touched.

## What changed

- `releases/registry.json` now lists both editions as **pending candidates** (`verified: false`, `status: "candidate-pending-approval"`, `sourceSha` = the commit whose game files they ship: boxing `b7321bab07dc8fd21df0207d747dbdfa4d8e5acf`, Fly `ef20ccb392005e0aef4325d4ede356cf79d571d9`, `origin` = the standing-authorized `https://empty-site-7f987b.netlify.app`, `approval` = "pending: …"). There is **no release timestamp** field and the validator rejects `releasedAt`/`publishedAt`: an edition date (17/18 Oct) is not a release date.
- `scripts/lib/build-lib.mjs`: `validateReleaseRegistry` accepts the existing verified-release form unchanged and the new pending-candidate form (strict: full 40-hex `sourceSha`, https origin, an `approval` note that contains the word "pending" anywhere (case-insensitive; the check is `/pending/i`)). The **public** build treats candidate entries as published editions; the **preview** build ignores them, so `npm run build:preview` still produces the labeled, noindex, link-free preview exactly as before. The manifest lists candidates under `releasedEditions` with their `status` and `sourceSha` (no `sha`, no timestamps).
- Nothing else in the builder changed: root = latest edition (Fly), stable dated routes, nav/arrow neighbors from the registry only, share URL = `origin + /games/<date>/` (the dated production URL, never root or a draft URL), `404.html` honest, footer About per game, `_headers`/CSP unchanged.
- Verifiers: `scripts/verify-hosted.mjs` (boxing) and `scripts/verify-hosted-fly.mjs` take `--mode preview|public` (default preview) and a **required** `--base <40-hex>`: the boxing baseline (`b7321bab…`); there is no longer a built-in default baseline. Both verify the manifest bytes, SHA/clean/exact flag/mode/tree hash, the file list, every served file's hash, `_headers` (consumed config: GET is not a served asset; effective values compared on responses), root/date/404/navigation/history, preserved game files against the baselines, a real-clock scripted win of **both** games, and in public mode the dated share URL.
- Tests: `test/public-release.test.mjs`, `test/browser/public-flow.test.mjs`; `test/build.test.mjs` and `test/fly-build.test.mjs` now use explicit empty-registry fixtures for the scaffold behavior (the repository registry is no longer empty) and re-pin only `releases/registry.json` and `scripts/lib/build-lib.mjs`.

## Public artifact behavior (observed locally in tests)

- Root is byte-identical to `/games/2026-10-18/` (latest edition). `/games/2026-10-17/` and `/games/2026-10-18/` both exist; `selected date` has `aria-current="page"`; the arrows link each edition to the other (boxing Next → Fly, Fly Previous → boxing) with ≥44 px targets and disabled "None earlier"/"None later" at the ends; the other edition is also in the "Other dates" `<details>` chooser (keyboard and 320 px tested). Missing days are not linked.
- No preview badge, no `noindex` (except the 404 page), preview-only wording absent from every shipped HTML/JS file.
- `/games/2026-10-19/`, `/games/2026-10-16/` and `/games/` are genuine HTTP 404 pages that list only the two editions.
- Game output is byte-identical: every non-template file of both editions equals its source, the shipped HTML only differs by the injected header/CSP/config placeholders, and `git diff` of `games/2026-10-17` and `games/2026-10-18` against `b7321ba` (and Fly against `ef20ccb`) is empty.
- Sharing: boxing "Share result" uses Web Share with the exact text and `https://empty-site-7f987b.netlify.app/games/2026-10-17/`; a canceled share is neither an error nor a dialog; no Web Share → clipboard; denied clipboard → selectable text. Fly "Copy result" copies `… 2026-10-18 https://empty-site-7f987b.netlify.app/games/2026-10-18/` (also when started from the root page). Preview pages keep `shareUrl: null`. The dated production URL will not resolve until a release is actually published; a *draft* deploy shows the same links pointing at the production origin by design.

## Commands

```sh
npm run build            # PUBLIC candidate (default; what Netlify's build command runs)
npm run build:preview    # labeled preview (ignores the pending candidates)
node scripts/verify-hosted.mjs     --url <draft origin> --sha <full SHA of the deployed commit> --base b7321bab07dc8fd21df0207d747dbdfa4d8e5acf --mode public --out <outside repo>.json
node scripts/verify-hosted-fly.mjs --url <draft origin> --sha <full SHA> --base b7321bab07dc8fd21df0207d747dbdfa4d8e5acf --mode public --out <outside repo>.json --shots <outside repo dir>
npm run check:embed-real -- --url <draft origin> [--edition 2026-10-18]   # real provider (network)
```

## Local evidence and limits

See the final section appended by the implementation run (results of `check`, unit, browser and both builds, the verifier dry runs and where the logs are). Limits: all evidence is Chromium emulation with a mocked X provider (except the separate real-provider check), scripted play and a local static host that mimics Netlify's `_headers`/404 behavior; no hosted draft was exercised here, no human play is claimed, and the verifiers' clean-tree checks can only pass on an exact committed tree (a dry run on this uncommitted tree fails exactly those two checks).

## Observed local results (uncommitted tree on top of `b7321ba`)

- `npm run check` ok; `npm test` 109/109; `npm run test:browser` 163/163 (includes the Fly suites, the boxing r6/r7 suites, the new `public-flow` tests); `npm run build:preview` and `npm run build` ok; `git diff --check` clean. No file under `games/` changed.
- `npm run check:embed-real -- --edition <date>` against a local preview build with the real X provider: loaded for both 2026-10-17 and 2026-10-18 (this proves the provider path still works, not a hosted render).
- Verifier dry runs against a local static server of the real `dist/` (public and preview, both scripts, `--base b7321ba…`): 194 of 196 (boxing public), 198 of 200 (Fly public), 193 of 195 (boxing preview), 196 of 198 (Fly preview) checks passed; in every case the only two failures were the *clean exact-SHA* checks ("local dist is the expected clean … artifact" and "hosted manifest: … clean, exactShaArtifact …"), which cannot pass on an uncommitted tree. Everything else passed, including manifest-listing completeness, every file's hash, `_headers`/effective headers, preserved game files vs the baselines, root/date/404/navigation and both real-clock scripted wins.
- Evidence and logs (outside the repo): `/home/a_01M55C5J3DT0YBY1Y380B8ZHMX/public-release-work/` — `check.log`, `test.log`, `browser.log`, `build-*.log`, `selftest-{boxing,fly}-{public,preview}.json`, `real-embed-*.json/png`, Fly screenshots in `fly-shots-*`.
- No human play, physical device, hosted draft or production check was done or is claimed.

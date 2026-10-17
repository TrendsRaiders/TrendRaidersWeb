# 30-Second KO local build and test notes (spec r4)

## Purpose and scope

Implementation notes for spec r4 (edition 2026-10-17 UTC, key `thirty-second-creator-boxing`), which keeps every r3 behavior and all combat constants, AI timing and input rules unchanged (`engine.js` was not modified). This documents what the local checks cover and what they do not. It records no real play observations; staged play is the PM's to record. The r3 draft at `c8576e7` is historical baseline, not acceptance of r4.

## Design choices

- Combat rules and constants are in `games/2026-10-17/js/engine.js` and match the r2/r3 table unchanged. The sim has no DOM and no wall clock; the page feeds it an active-simulation clock that stops during pause, countdown and modals.
- Input at a timestamp applies before combat events at that timestamp (`sim.punch(t)` / `sim.setGuard(t)` process only events earlier than `t`); `sim.advance(t)` processes events up to and including `t`. Order at equal timestamps: deadline, strike, impact, cosmetics.
- Pages are static, one HTML file per date. Leaving a page unloads the simulation; `pageshow` from the back/forward cache resets to Intro.
- Blocking dialogs (Pause, About, share fallback) share one stack (`js/modal.js`): background `inert`, Tab containment, focus restore to the opener or, if it is inert or gone, to the dialog beneath or a logical fallback. About opened during play pauses first, and closing it returns to Pause.
- Focus leaving the play region during play pauses immediately; the Pause dialog opens after the initiating click settles so links and buttons still perform their action.
- Combat from buttons uses pointer events and the single keyboard handler. Buttons have no combat `click` handler except a guarded one for assistive-technology activation that is suppressed right after a handled pointer/key event.
- Sound is optional, off by default and generated with WebAudio.
- Best KO time is stored locally under `trendraiders:thirty-second-ko:best-hundredths` (wins only); denied storage is tolerated. `data-punch-requests` on `#app` counts Punch requests so tests can detect duplicate handling.

## r4 design notes

- **Pixel art and provenance:** `js/art.js` draws the arena, both boxers, gloves, shield, stool and stopwatch/stamp procedurally into a 256×144 RGBA buffer (result scene 128×72) from small hand-authored bitmaps and integer rectangles/lines. It is original work written for this repository: no imported images, fonts, sprite sheets, third-party art or licensing obligations, and the characters are generic non-likeness boxers. `main.js` puts the buffer on a `<canvas>` scaled by CSS `image-rendering: pixelated` at the largest whole-number factor that fits the arena width (1× at 320–667 px wide, 2× at 1280 px; on short screens the height can lower it, never below 1×), centered and letterboxed. The poses are derived from the unchanged simulation state at render time (wind-up pose = the engine's wind-up phase), so art never moves timing. HUD, timer, cues, WIND-UP progress, COUNTER badge, placard and all text are DOM outside the art grid. If a canvas context is unavailable the page shows a simple-shape fallback with cues and controls intact.
- **Idle bob** (1 px, 500 ms) is the only decorative sprite motion and is off with reduced motion. The win scene is four canvas stages timed by plain timeouts (≈1 s, skippable); reduced motion draws the final stage immediately. No state depends on animation completion.
- **Embed:** `js/embed.js` loads `https://platform.twitter.com/widgets.js` only after the explicit Load click and calls `twttr.widgets.createTweet('2111278238253342868', …, { conversation: 'none', dnt: true, … })`. There is no provider script, iframe, preconnect or prefetch in the HTML. It never moves focus and never retries automatically. A 10 s timer, a script error, a rejection or a missing post (`undefined`) show the fallback and a **Try loading again** button. Each attempt renders into its own holder element, and only the current attempt can change the state: a superseded attempt that resolves later neither displays old content nor marks the new attempt loaded or failed, while the same attempt's late success may replace its own timeout fallback.
- **Previous/Next:** computed at build time in `scripts/lib/build-lib.mjs` (`gameNeighbors`) from the released registry only; the selected edition, even a preview candidate, only anchors the comparison. Unavailable ends are `<button disabled>` with the adjacent honest text. The real registry is empty, so the preview candidate has both ends disabled; enabled links are exercised only with isolated fixtures built in temporary directories.
- **CSP** (meta tag in every page plus `dist/_headers` with `frame-ancestors 'none'`, `nosniff` and a referrer policy). It applies to the scaffold root too. Directives: `default-src 'self'`; `script-src 'self' https://platform.twitter.com`; `style-src 'self'`; `img-src 'self' data:` (inline favicon); `font-src 'self'`; `connect-src 'self'`; `frame-src https://platform.twitter.com`; `media-src 'none'`; `object-src`, `base-uri`, `form-action` `'none'`. No wildcards, no `unsafe-inline`/`unsafe-eval`. The `_headers` file only takes effect on a host that honors it (Netlify does); elsewhere the meta tag still enforces everything except `frame-ancestors`.

### Provider evidence (observed, real network, headless Chromium)

Probe run on 2026-10-17 against the live provider with no CSP, then under the CSP above, and the repeatable `npm run check:embed-real` (local preview build served with the production headers; `--url <origin>` checks an already hosted preview):

- Top-document requests after Load: `https://platform.twitter.com/widgets.js` and `https://platform.twitter.com/js/tweet.<hash>.js` only. Nothing before Load.
- The iframes are `https://platform.twitter.com/widgets/widget_iframe…` and `https://platform.twitter.com/embed/Tweet.html?dnt=true&embedId=…`. Requests made inside those frames (outside our CSP, governed by X's own) went to `syndication.twitter.com`, `cdn.syndication.twimg.com`, `syndication.x.com`, `pbs.twimg.com` and `video.twimg.com`, including preloading of the post's video playlist/segments. We do not request these ourselves and cannot suppress them with a supported option; the post shows a video thumbnail with a play control and no visible autoplay. This is third-party content and a privacy/bandwidth point for PM review.
- Under the narrow CSP the post rendered (iframe 268 px wide at 320 px viewport, no overflow, focus unchanged). The only CSP violation is one or two `style-src-elem` inline reports from `widgets.js`, which inserts a throwaway `.csptest…{visibility:hidden}` `<style>` to detect CSP support; it is left blocked, because allowing it would need `unsafe-inline`. The embed works regardless. The check script fails on any other violation.
- Real rendering has been observed only from a local origin. It has not been run against a hosted draft because no r4 draft exists; `npm run check:embed-real -- --url <draft origin>` is provided for that. The provider may render, refuse or change at any time; mocked tests do not prove real rendering.

## Commands

```sh
npm run check
npm test
npm run test:browser
npm run test:all
npm run build && npm run build:preview   # public scaffold / explicit preview
npm run check:embed-real                 # network: real provider, not part of test:all
```

## Coverage

- `test/engine.test.mjs`: constants; schedule across frame rates; late frames; guard/counter/stun/cancel cases from acceptance tests 2–5; walkthrough 9,101 ms; punch spam loss at 9,000; timeout draws; 29,999/30,000 boundary; double KO; pause freeze semantics; retry reset.
- `test/build.test.mjs`: public build keeps scaffold and omits the candidate; preview labels; exact news recap/link; manifest hashes and reproducibility; hosting env vars ignored; Netlify config safety; empty release registry.
- `test/release.test.mjs`: registry validation; isolated nonpublic archive fixture (fake earlier edition, not a release) proving preservation of earlier routes/assets, released-only nav, root = latest released, candidate hidden unless released; preview alongside released; static-host routing, trailing-slash redirect and 404 for unknown dates.
- `test/browser/game.test.mjs`: Chromium with Playwright's fake clock at 320px portrait, 667×375 landscape and 1280×800 (visible HUD/controls, ≥56 px targets, control strip below arena); countdown; keyboard combat; stun; loss/timeout/retry; win payoff with actual KO time; reduced motion; pause/resume lead-in; blur and hidden-page auto-pause; About during held Guard (inert background, Tab containment, Escape, Pause return); About from Intro/Result; no combat keys from UI focus, single action from a focused Punch button, repeat keys; focus-leave pause; nav link still navigating; history back/forward; unknown date 404; 320px Tab traversal with visible focus; multi-touch Guard+Punch and touch cancel; storage denied and missing clipboard; link-free share before release.
- `test/browser/share-released.test.mjs`: with a fixture release registry (origin `https://games.example.test`, not a real site): share text with time and production URL, Web Share, canceled share, clipboard fallback, root and no preview framing.

- `test/art.test.mjs`: 256×144 and 128×72 frames, opaque limited palette, determinism, all player/enemy poses distinct, shield/counter/warning/stool/bob change the frame, result stages and stamp.
- `test/build.test.mjs` (r4 additions): narrow CSP (no unsafe/wildcard, only `platform.twitter.com`) in meta and `_headers`; no provider script/iframe/preconnect in HTML; exact intro/placard/punchline/embed copy; disabled ends for the real empty registry.
- `test/release.test.mjs` (r4): `gameNeighbors` for none / current only / sparse dates / unrelated previews; built fixture pages with exact neighbor links and disabled ends.
- `test/browser/r4-art.test.mjs`: integer scale (1× at 320/390/667, 2× at 1280), canvas intrinsic size, `image-rendering`, ≥256 px art width, placard/subheading; canvas pixels equal `renderArena` for every pose reached in play and wind-up begins at the r3 time (within real-time clock drift); WIND-UP/progress/COUNTER/shield cues with normal and reduced motion; simple-shape fallback still plays; win scene, KO time, punchline, skip and static reduced-motion scene.
- `test/browser/r4-embed.test.mjs` (**mocked provider** via request interception): nothing leaves the origin before Load and the game plays fully; exact tweet id and options; focus not stolen; unavailable/rejected/blocked fallbacks with no automatic retry and explicit retry; 10 s timeout (loading at 9 s, fallback at 10 s); offline; 320 px layout loaded and fallback; Load during a fight pauses but never resets; keyboard traversal and no combat keys outside play; four retry-race cases (late success, late failure, ordering, same-attempt late success).
- `test/browser/r4-nav.test.mjs`: real preview endpoints (both genuinely disabled, honest messages, no href, 44 px); fixtures for current only, sparse neighbors, unrelated previews, exact hrefs/names/dates, keyboard activation, back/forward, leaving a fight via an arrow.
- Last full run in this tree: `npm ci --ignore-scripts`, `npm run check` (tsc and contrast) pass; `npm test` 64/64; `npm run test:browser` 50/50; `npm run build` and `npm run build:preview` succeed.

## Limitations

- Browser tests run Chromium only, headless, on a fake clock, with synthetic touch via the DevTools protocol. They do not cover Safari/Firefox, real devices, real Web Share sheets, screen readers or real frame pacing.
- Contrast: `scripts/check-contrast.mjs` (run by `npm run check` and `test/contrast.test.mjs`) computes WCAG ratios for a hand-listed set of major text, button-state (including Guard held) and boundary/focus pairings. It does not audit every rendered pixel, translucent overlays (approximated by their darkest backdrop), SVG art, hover states or browser-specific rendering, and no axe audit was run.
- The fake clock steps frames deterministically; real-device input latency and `rAF` throttling are not exercised.
- Staging/production deployment, release verification and preview-domain checks (acceptance 14–15 on an actual draft) are not done: the deployment contract is unconfigured, and no staging or production deployment was made; the branch/PR is tracked in `game_jobs`.
- No staged play observations exist: attempts to first win, readability and payoff reaction (acceptance 17) remain for the PM to record. The 2–5 attempt target is a design hypothesis.
- The r4 embed tests use a mocked provider; only `check:embed-real` talks to X and it was run locally, not against a deployed draft. Provider output (including the in-frame video preloads) is outside our control.
- Pixel-art readability, humor and payoff are unreviewed by humans; tests prove structure, determinism and cue timing, not taste. The art is deliberately simple (about 48 px tall boxers on a 144 px grid).
- The 1× art at 320 px is small by design (spec minimum is 256 CSS px).
- Legal clearance of the unofficial textual reference is not provided by this implementation.

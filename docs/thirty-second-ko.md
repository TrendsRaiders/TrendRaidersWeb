# 30-Second KO local build and test notes (spec r5)

## Purpose and scope

Implementation notes for spec r5 (edition 2026-10-17 UTC, key `thirty-second-creator-boxing`). R5 keeps every r3/r4 behavior and the unchanged combat engine (`games/2026-10-17/js/engine.js` and `test/engine.test.mjs` have no r5 changes: constants, AI timing, input and ordering are as before), and changes presentation, layout and the source embed:

- flat retro-arcade UI instead of the r4 rounded/striped theme;
- a full-width responsive ring instead of the fixed 256×144 integer-fit canvas with letterboxing;
- separate portrait-phone, short-landscape and desktop compositions;
- the exact short instruction **"Block the hit. Punch on COUNTER. KO Jack before time runs out."** and **GUARD — hold** / **PUNCH — tap** buttons;
- one automatic official-widget attempt per edition mount, replacing the r4 click-to-load gate.

This file records what the local checks cover and do not cover. It records no real play observations, no hosted result and no human review; the r4 build `0fcb0dd`, its draft and tests are historical, not r5 acceptance. Nothing here is a release: the public registry is empty and the public build is the scaffold.

## Design notes

- **Panel layout.** `#game` is one CSS grid (`display: contents` on `.app` and `.play-region`) with named areas that change per composition:
  - Default/portrait phone (<600px): head row (date + Pause/About), HUD, arena, cue strip, rail (instruction + thumb controls), panels. 8–12px gutters, arena `clamp(210px, 36svh, 340px)` high and the full inner width (296px at 320). Thumb controls are 64px (72px when the viewport is taller than 640px), Guard left, Punch right, 8px gap.
  - 600–899px: same stack, arena `clamp(240px, 40svh, 400px)`.
  - ≥900px: panel centered at up to 1120px, arena `clamp(300px, 48svh, 480px)` (346px at 720px tall), single-row HUD, cue strip below the arena, controls directly below.
  - Landscape with height ≤500px (e.g. 667×375): HUD/Pause row above, arena + cue strip in the left column, a 120px right rail holding the wrapped instruction and two stacked ≥64px controls. Arena is `clamp(200px, 100svh − 168px, 340px)`, 207px at 375px.
- **Positioning.** Play, Resume, Retry and Restart call `positionPanel()` before the 3-2-1 (`scrollIntoView({block:'start', behavior:'auto'})`, always instant, so reduced motion is respected). Phones scroll the panel head to the top of the view; the nav and news stay above/below and scroll normally.
- **Resize/rotation.** Any change of `innerWidth`/`innerHeight` while Playing or in the countdown pauses the round (inputs cleared, health/time preserved, explicit Resume). Height-only changes also pause, deliberately, because the spec says resize; a real mobile browser whose address bar collapses during a round would pause it too (not observable in emulation).
- **Cue strip.** A stable 48px strip under the arena holds the cue text (20px, e.g. `BLOCK −4`, `HIT YOU −22`, `COUNTER −20`, `HIT JACK −3`) and one status slot that shows either the WIND-UP label + progress bar or the COUNTER NOW badge (they never overlap in time). Nothing is overlaid on the art except the slim placard and the 3-2-1 box.
- **Pixel art and provenance.** `js/art.js` still draws everything procedurally from small hand-authored bitmaps and integer rectangles/lines; no imported images, fonts or third-party art (no licensing obligations; non-likeness generic boxers). R5 changes: the arena is rendered for its own pixel size. `fitArena()` picks a whole-number sprite scale `px = max(1, round(0.32 × arenaHeight / 56))` (boxers are 56 logical px tall, so 26–37% of arena height at the four spec sizes), makes the logical canvas `ceil(width/px) × ceil(height/px)` and clips the sub-pixel overshoot, so there are no side bars, no stretching and no fractional positions. `layoutFor(w, h)` recomposes scenery per aspect ratio: ropes, crowd band and floor run edge to edge (no posts), boxers keep their pixel size and are centered with a gap that grows on wide arenas. Pixel poses (idle, raised-glove WIND-UP, guard + shield, startup/punch/recover, stun, strike, recovery), the result scene (128×72, integer scale) and the 1 px idle bob (off with reduced motion) are unchanged in concept.
- **Automatic embed.** `js/embed.js`: `start()` runs once when the page mounts (`main.js` `init`). One script loader is shared: reused while pending or loaded, replaced only after it errored. The notice, dated summary and ordinary link are in the HTML, so they are visible immediately. States: loading (summary + link visible) → loaded (post replaces only the summary) or failed (fallback text + **Try loading again**). Failure comes from a script error, rejection, missing post or the 10 s timer; nothing polls or retries by itself. Every attempt renders into its own holder and only the current attempt may change state, so a superseded attempt's late success/failure is ignored and cannot add visible duplicates; the same attempt's late success after the timeout may replace its fallback. `suspend()`/`resume()` on pagehide/pageshow ignore stale callbacks and allow at most one new attempt on return. The embed code never calls `focus()`, never reads or writes game state and sits below the play panel in a 240px reserved slot, so provider activity cannot move the active controls.
- **CSP** is unchanged from r4 (meta tag in every page plus `dist/_headers` with `frame-ancestors 'none'`, `nosniff`, referrer policy): `default-src 'self'`; `script-src 'self' https://platform.twitter.com`; `style-src 'self'`; `img-src 'self' data:`; `font-src 'self'`; `connect-src 'self'`; `frame-src https://platform.twitter.com`; `media-src 'none'`; `object-src`, `base-uri`, `form-action` `'none'`. No wildcards or unsafe keywords. `_headers` also applies to the scaffold root when deployed; hosts that ignore `_headers` still get the meta tag (without `frame-ancestors`).
- **Public/preview.** Unchanged: `npm run build` (public) publishes the scaffold, `404.html`, `_headers`, `assets/site.css` and the manifest with an empty release registry; the scaffold and 404 pages contain no script, so nothing loads the provider there. `npm run build:preview` adds the labeled candidate.

## Commands

```sh
npm ci --ignore-scripts
npm run check              # tsc --checkJs + CSS contrast pairs
npm test                   # node:test: engine, art, build, release, contrast
npm run test:browser       # real Chromium (playwright-core, /usr/bin/chromium)
npm run build              # public scaffold
npm run build:preview      # labeled candidate
npm run check:embed-real   # network: real X provider under the production CSP, automatic expectations
node scripts/verify-hosted.mjs --url <draft origin> --sha <40-hex commit>   # after a draft deploy of the same clean commit
```

## Coverage

- `test/engine.test.mjs` (unchanged): constants, schedules, boundaries, retry reset.
- `test/art.test.mjs`: reference frames, palette, determinism, all poses distinct, flags change the frame, result stages, and (r5) arbitrary-size frames: ropes/floor reach both edges, no pillar colors, no void side columns, boxers inside the arena with room for gloves, pixel-identical sprites across sizes, 25–40% of height.
- `test/build.test.mjs`, `test/release.test.mjs`: public/preview builds, exact copy including the r5 instruction/notice and removal of the Load/consent text, flat stylesheet (no gradient/shadow/filter/alpha colors), narrow CSP, no provider markup, manifest source/hash, archive and `gameNeighbors` fixtures, registry gate.
- `test/browser/r5-layout.test.mjs` (real Chromium viewports): at 320×568, 390×844, 667×375 and 1280×720, after clicking Play with no manual scroll, HUD/arena/cue/both thumb controls/Pause are inside the view together and do not overlap; arena/thumb/gutter/gap/rail/panel dimensions per spec; font minimums; wrapping and clipping checks; BLOCK + COUNTER NOW fit in the 320 strip; computed flat theme; Play/Resume reposition instantly (also reduced motion); resize/rotation pauses with cleared input and preserved state, then recomposes; touch-action only on arena/controls, dual-touch drag does not pan, news scrolls normally, viewport meta does not disable zoom.
- `test/browser/r5-art.test.mjs`: arena canvas whole-number scale and edge coverage at four sizes, placard position, canvas pixels equal `renderArena` for every pose reached in play (same size), wind-up timing, cues with normal/reduced motion, simple-shape fallback, win scene and static reduced-motion scene.
- `test/browser/r5-embed.test.mjs` (**mocked provider**): attempt at mount without interaction (exact id/options, one script request, notice/summary/link, no Load control), slow provider never blocks play or moves controls, provider success/error during held Guard/play/Pause changes nothing, fallbacks (undefined/reject/blocked/offline) with explicit retry and script reuse, 10 s timeout, four retry-race orderings, same-attempt late success, navigation away/back, unknown route makes no provider request, 320px layout loaded/fallback, reserved slot, focus-leave pause when using Retry during a fight, keyboard.
- `test/browser/r5-nav.test.mjs`, `game.test.mjs`, `share-released.test.mjs`: arrows with isolated fixtures, and all r3/r4 gameplay, modal, input, share, routing and history behavior (updated only for r5 copy/selectors).
- `scripts/real-embed-check.mjs` (network, not in `test:all`): loads the page, performs no interaction, and reports whether the real provider rendered, the top-document vs provider-frame requests with timings, media preloads, CSP violations, page errors by origin, and layout/focus stability.
- `scripts/verify-hosted.mjs`: reusable hosted verifier (`--url`, `--sha`): manifest byte comparison, SHA/clean/mode/tree, every served file hash, explicit `_headers` handling with effective-header comparison on seven URLs, navigation/history/404, real-clock scripted win, and active-view geometry at the four sizes. Dry-run only against a local server here (it correctly fails the clean-tree checks on a dirty tree); not run against any draft.

## Local results (this tree)

Final run in this tree (uncommitted working tree on top of `0fcb0dd`): `npm ci --ignore-scripts` ok; `npm run check` (tsc + contrast) ok; `npm test` 68/68; `npm run test:browser` 62/62; `npm run build` (public: scaffold root, 404, `_headers`, assets, manifest; empty registry) and `npm run build:preview` ok; `git diff --check` clean; `npm run check:embed-real` ok (local origin). Rendered inspection used `~/r5-work/capture.mjs`, which drives the real preview build in Chromium and saves Intro, WIND-UP, COUNTER, Pause and Win screenshots at each size in normal and reduced motion (40 PNGs plus `geometry.json`, in `~/r5-work/shots/`, outside the repo). I looked at the images (e.g. 320×568 COUNTER, 667×375 WIND-UP/Pause, 390×844 COUNTER, 1280×720 COUNTER, 320×568 Win) and the measured geometry:

| Viewport | Arena (CSS px) | Pixel scale / logical canvas | Thumb controls | Active view |
|---|---|---|---|---|
| 320×568 portrait | 296×210 | 1× / 296×210 | 144×64 each, Guard left/Punch right, bottom at 492 | HUD, arena, 48px cue strip, instruction (2 lines), both controls and Pause all within 568 after Play |
| 390×844 portrait | 366×304 | 2× / 183×152 | 179×72 each, bottom at 593 | same, all within 844 |
| 667×375 short landscape | 515×207 | 1× / 515×207 | 120×98 each stacked in the right rail, bottom at 367 | HUD row, arena, cue strip and rail within 375 |
| 1280×720 desktop | 1120×346 | 2× / 560×173 | 554×72 each, bottom at 614 | centered 1120px panel; whole panel within 720 |

Fonts measured: controls 18px, cue 20px, health/timer 20/24px, instruction 16px. Win scenes showed the KO headline, actual KO time (9.11–9.12s in the scripted runs), BEAT THE BUZZER stamp scene at an integer scale (2× at 320/390, 3× at 667/1280) and no horizontal overflow at any size. All four sizes had no page errors or CSP violations in normal and reduced motion.

Real provider (local origin, headless Chromium, 320×568, no interaction): `npm run check:embed-real` passed. One `widgets.js` request at ~370 ms, a second top-document script (`js/tweet.<hash>.js`) at ~790 ms, the post rendered at ~1.6 s (268px iframe, no overflow, focus and scroll unchanged, play-panel geometry identical before/after). Provider-frame requests (outside our CSP) went to `platform.twitter.com`, `syndication.twitter.com`, `cdn.syndication.twimg.com`, `syndication.x.com`, `pbs.twimg.com` and `video.twimg.com`; they include preloading of the post's video playlist/segments (HLS `.m3u8`/`.m4s` fetches) without any click. The only CSP violation is the known `widgets.js` inline `<style>` self-test (`style-src-elem`, `inline`), left blocked. Separately, X's own embed scripts throw `Failed to execute 'appendChild' on 'Node'` inside the provider frame after the post loads while a game is running; it comes from `platform.twitter.com` code, does not affect play, and the verifiers record it as third-party rather than failing on it.

## Limitations

- Viewports are Chromium emulation: no physical devices, no real browser chrome/safe-area insets (the 568px and 375px heights are treated as the visible area), no Safari/Firefox, no screen reader. The "pause on any resize" rule was checked by `setViewportSize`, not by a real address-bar collapse.
- The fake clock drives most browser tests; real-clock coverage is the scripted win in the hosted verifier and the earlier smoke scripts. Scripted wins are not human play evidence. No unassisted desktop/phone play, comprehension, time-to-first-win or payoff reaction has been collected; that stays with PM.
- Sprites are intentionally small (56px tall on a 296×210 arena is 26.7%, near the lower bound of the 25–40% guide); readability/taste is unreviewed by humans.
- The embed tests are mocked. The real provider was checked only from a local origin on this machine; there is no hosted draft result, the provider can change or refuse at any time, and its in-frame privacy/bandwidth behavior (including media preloading, cookies/identifiers) is outside our control and now happens without a click. PM reviews that scope; if site policy requires consent, that conflicts with the r5 spec and must be reported rather than gated here.
- `_headers` is applied only by hosts that honor it; the hosted verifier compares effective headers.
- `scripts/verify-hosted.mjs` has not been run against a real draft.
- Contrast: `scripts/check-contrast.mjs` covers a hand-listed set of pairs (updated for the r5 flat palette), not every rendered pixel, translucent art, hover states or the provider's iframe; no axe audit.
- Legal clearance of the unofficial textual reference is not provided by this implementation.

# 30-Second KO local build and test notes (spec r6)

## Purpose and scope

Implementation notes for spec r6 (edition 2026-10-17 UTC, key `thirty-second-creator-boxing`). R6 changes only the page composition and the entry/reset flow. Combat engine, constants, AI timing, input rules, countdown, win payoff, flat pixel art, the automatic X embed with its disclosure/fallback/10 s timeout/retry, and the narrow CSP are as in r5 (`games/2026-10-17/js/engine.js`, `embed.js` logic and the CSP list are unchanged; `test/engine.test.mjs` is unchanged).

R6 adds: a minimal compact header; **About only in a normal-flow footer after the news**; one compact play heading; a short **non-modal Intro overlay inside the arena** (goal, keyboard, touch, **Start round**) on first entry and after every Restart/Retry; no persistent instruction in the countdown or play; Pause and Restart as separate compact controls; and more arena space.

This file records local evidence only. No hosted result, no human play, comprehension or time-to-first-win evidence exists; the r5 build `77ec918` and its draft are historical. Nothing is released: the public registry is empty and the public build is the scaffold.

## Design notes

- **Header** (`renderHeader` in `scripts/lib/build-lib.mjs`): one `<header>` in normal flow containing the identity link, a compact **Preview — not released** badge on drafts, and a single `nav` labelled **Game navigation**. The nav row is ← Previous / selected date / Next →: the selected edition is always one real link with `aria-current="page"`; the visible secondary text of the arrows is the destination date or **None earlier / None later** (screen readers get "Previous game … 10 Oct 2026 UTC" or "No earlier released game"); disabled ends are real `<button disabled>`s. Every *other* date lives in a native, bounded `<details class="others">` chooser ("Other dates", real links, no script, dropdown `max-height: 50vh` with its own scroll, opens over content without changing the header height), so the header does not grow with the number of editions. No About, tutorial, title block, share or news content is in the header. **Phones (<600px) use at most two rows**: row 1 = identity + Preview badge (the identity link is dropped only when the date chooser needs the row), row 2 = a three-column grid of Previous / selected date / Next with wrapping compact labels (≥44px targets, text ≥13px). Measured 98px at 320, 390 and 667 wide, 50px at 1280×720 (one row); the many-date fixture has the same height.
- **Play heading and tools**: one `h1` ("30-Second KO 17 October 2026 (UTC)", compact date on phones) in the play panel. `#panel-tools` holds Sound while stopped and Pause + Restart while a round is on. Portrait phones put them in a row below the thumb controls; ≥900px and short landscape put them in the heading row.
- **Intro** (`#panel-intro`, a labelled `section` inside `#arena`): heading "Ready?", the exact goal line, "PUNCH: Space / J · GUARD: hold K / Shift · Esc: Pause", "PUNCH: tap · GUARD: hold" and one **Start round** button (also described by those lines). It is not a dialog: nothing is inert, `Tab` leaves it freely, Escape does nothing in it. Combat buttons, cue strip and Pause/Restart are not displayed while it is up. It is `hidden` (out of layout and the accessibility tree) in countdown/play/pause/result.
- **Entry/reset flow** (`main.js`): first load, `pageshow` from the back/forward cache, **Restart** (play head, Pause dialog) and **Retry** all call `resetToIntro()`: close dialogs, stop the run, clear inputs, new `Sim`, show the overlay, position the panel, focus **Start round** (no scroll), announce once. `startRound()` (click, touch, native Enter/Space) refuses when `document.hidden`, positions the panel, clears held keys/pointers, then runs the existing 3-2-1 and focuses the play region without scrolling. Held Enter/Space/K fire only repeat events, which the existing handlers ignore, so a fresh press is required. **Resume** is unchanged and keeps the round. **Exit** navigates to `/`.
- **Space allocation**: portrait arena `clamp(210px, 40svh, 360px)`, 600–899px `clamp(240px, 40svh, 400px)`, ≥900px `clamp(320px, 52svh, 500px)`, short landscape `clamp(200px, 100svh − 164px, 340px)` beside a 120px rail. The instruction row is gone. While Intro is up the arena may grow (zoom/large text) and nothing is clipped. Boxers are 60 logical px tall (`BOXER_H`), so they are 26–36% of arena height at the four spec sizes.
- **Resize/rotation**: unchanged. Any inner-size change while Playing/Countdown pauses and clears input; Intro stays Intro and Result stays Result.
- Everything else (art, embed, CSP, public/preview builds, share, modals) as in r5; see the git history and `README.md`.

## Commands

```sh
npm ci --ignore-scripts
npm run check              # tsc --checkJs + CSS contrast pairs
npm test                   # node:test: engine, art, build, release, contrast
npm run test:browser       # real Chromium (playwright-core, /usr/bin/chromium)
npm run build              # public scaffold
npm run build:preview      # labeled candidate
npm run check:embed-real   # network: real X provider under the production CSP (automatic, no interaction)
node scripts/verify-hosted.mjs --url <draft origin> --sha <40-hex commit>   # after a draft deploy of the same clean commit
```

## Coverage

- `test/browser/r6-intro.test.mjs` (new): first-entry Intro (focus ring, >30 s idle, combat keys and Escape do nothing); Tab/Shift+Tab reach nav, news, embed link and footer (no trap, nothing inert); Enter, Space and pointer each start exactly one countdown with the overlay removed from layout and the accessibility tree; held Enter/K across the countdown never punch or guard; Start refused while hidden; touch tap; Restart during play with held Guard and a pending Punch → focused Intro, no clock, then a clean first strike; Pause Restart vs Resume (same round, no Intro) and Restart by keyboard without a punch; Retry after loss, timeout and win (focused Intro, nothing advances, clean round, no second widget attempt or script); engine Double KO fixture; provider completion/failure during Intro changes nothing; history return and refresh give a fresh Intro; Exit leaves for `/`.
- `test/browser/r6-layout.test.mjs`: at 320×568, 390×844, 667×375, 1280×720: Intro fits inside the arena at ≥16 px with Start ≥44 px and the arena at its normal height; after Start, HUD/arena/cue/both thumb controls/Pause/Restart are inside the view together, do not overlap, meet size minimums, and no instruction/overlay remains; portrait/landscape/desktop dimensions per spec and larger than r5; compact heading; header ≤72 px at 1280; footer About in normal flow below the news and no About/hero in the header; zoom (enlarged root font) grows the stopped arena without clipping; wrapping; flat theme; Start/Resume/Restart/Retry reposition instantly; resize/rotation pause; touch-action and dual-touch; cue strip.
- `test/browser/r6-nav.test.mjs`: real endpoints (two disabled buttons with compact visible and full accessible labels, one `nav`); isolated fixtures for current-only, sparse neighbors, unrelated previews, keyboard activation, history; **header geometry at 320, 390, 667 and 1280 for the real registry and a 10-date archive fixture: ≤2 visual rows on phones/landscape and ≤72px in one row at 1280, ≥44px targets inside the viewport, no text under 13px, selected date and Preview status visible, exactly one `aria-current` link**; the bounded `<details>` chooser (all other dates are real links, keyboard opens it, opening does not change the header height, dropdown ≤50vh and scrolls, Tab enters it, choosing a date navigates), nearest-neighbor arrows, and the Tab path to the news link and footer About.
- `test/browser/r6-art.test.mjs`, `r6-embed.test.mjs`, `game.test.mjs`, `share-released.test.mjs`: the r5 suites updated for the new structure (renamed from r5-*; nothing dropped) — Start replaces Play, Retry/Restart go to Intro, About only from the footer, header selectors.
- `test/build.test.mjs`, `test/release.test.mjs`: exact r6 markup (Intro inside the arena, one About in the footer after the news, header contents, disabled-end labels, sparse-neighbor links), flat CSS, CSP, manifest, archive fixtures. `scripts/real-embed-check.mjs` and `scripts/verify-hosted.mjs` were updated for r6 (Start round, header, footer, Intro focus, Restart/Retry flow, geometry with Restart, arena heights).

## Local results (this tree, uncommitted on top of `77ec918`)

`npm ci --ignore-scripts` ok; `npm run check` (tsc + contrast) ok; `npm test` 68/68; `npm run test:browser` 86/86; `npm run build` (public: `404.html`, `_headers`, `assets`, manifest, scaffold `index.html`/`styles.css`; neither `index.html` nor `404.html` contains a script, so no provider load there) and `npm run build:preview` ok; `git diff --check` clean; `npm run check:embed-real` ok on a local origin.

Evidence is in `~/r6-work/` (outside the repo): `shots/` (49 files: for each of 320×568, 390×844, 667×375, 1280×720 and normal/reduced motion — first-entry Intro, WIND-UP, COUNTER, Pause, reset Intro after Restart, Win; `geometry.json` has the measured rectangles), `real-embed.json`, `verify-hosted-selftest.json`, the step logs, and `~/r5-work/shots/geometry.json` for the r5 baseline. I looked at the images for 320×568 (first-entry Intro, COUNTER), 667×375 (reset Intro) and others while tuning.

Measured, CSS px, COUNTER state, normal motion (reduced motion is identical):

| Viewport | Header (real registry, was 150/150/98/50 before the header fix) | Arena r5 → r6 | Arena area vs r5 | Arena share of viewport r5 → r6 | Thumb controls | Pause / Restart | Active stack (heading to lowest control) |
|---|---|---|---|---|---|---|---|
| 320×568 | 98 | 296×210 → 296×227 | +8.2% | 34.2% → 37.0% | 144×64 | 44 high each, below the thumbs | 495 of 568 |
| 390×844 | 98 | 366×304 → 366×338 | +11.1% | 33.8% → 37.5% | 179×72 | 44 high each, below the thumbs | 614 of 844 |
| 667×375 | 98 | 515×207 → 515×211 | +1.9% | 42.6% → 43.4% | 120×155 (rail) | 44 high each, top row | 371 of 375 |
| 1280×720 | 50 | 1120×346 → 1120×374 | +8.2% | 42.0% → 45.5% | 554×72 | 44 high each, heading row | to 676 of 720 |

R6 removes the 40–48 px instruction row and the About/Pause head buttons from the active layout; on phones the freed space went to the arena (+17 px at 568, +34 px at 844) and the Pause/Restart row, on desktop the arena grew 28 px, and short landscape gains little (4 px) because the rail already filled the height. Intro text measured at 16 px (goal, keys, touch, Start) at every size; at 320×568 the overlay (≈212 px) fits inside the 227 px arena without growing it. Fonts: cue 20 px, health 20 px, timer 24 px, thumb labels 18 px.

Real provider (local origin, headless Chromium, 320×568, no interaction): one `widgets.js` request at ~390 ms, post rendered at ~1.6 s, top-document requests only to `platform.twitter.com`; provider frames contacted `syndication.twitter.com`, `cdn.syndication.twimg.com`, `syndication.x.com`, `pbs.twimg.com` and `video.twimg.com` (including video playlist/segment preloads without a click); the only CSP violation is the known `widgets.js` inline `<style>` self-test; X's own script threw `appendChild` on a non-Node inside its frame (recorded as provider-script, not ours). Focus stayed on Start round and the play panel geometry did not change.

## Limitations

- Viewports are Chromium emulation: no physical device, no real browser chrome or safe-area insets (the visible area is taken as the viewport), no Safari/Firefox, no screen reader. Touch is synthetic (DevTools/Playwright). The pause-on-any-resize behavior was exercised with `setViewportSize`; a real phone's address bar collapsing mid-round would pause it and was not observable.
- The fake clock drives most tests; real-clock coverage is the hosted verifier's scripted win and the capture scripts. Scripted wins are not human play. Whether players understand the overlay before coaching, how many attempts they need, whether the Restart/Retry flow is clear, and their reaction to the payoff are **unmeasured**; they remain PM's to record.
- The Double KO result is covered at engine level plus the generic Retry path; the UI cannot reach it through ordinary combat.
- Header: the date chooser is a native `<details>` dropdown that overlays content while open (transient, user-opened); the two-row limit and ≤72 px at 1280×720 are asserted at four viewport sizes only in Chromium emulation. Evidence images `~/r6-work/hdr-fixture-closed-320.png` and `hdr-fixture-open-320.png` show the 10-date fixture.
- 667×375: the active stack ends at 371 of 375 px, i.e. effectively no spare height on a real phone with browser chrome; the spec says to scroll rather than clip if minimums do not fit.
- The embed tests are mocked; the real provider was checked only from a local origin. `scripts/verify-hosted.mjs` was only run against a local server (it fails exactly the two clean-tree checks there, as intended) and has not been run against any draft.
- Contrast uses a hand-listed pair set (`scripts/check-contrast.mjs`), not every rendered pixel or the provider's iframe; no axe audit.
- Legal clearance of the unofficial textual reference is not provided by this implementation.

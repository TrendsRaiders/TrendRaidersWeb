# 30-Second KO local build and test notes

## Purpose and scope

Implementation notes for spec r3 (edition 2026-10-17 UTC, key `thirty-second-creator-boxing`). This documents what the local checks cover and what they do not. It records no real play observations; staged play is the PM's to record.

## Design choices

- Combat rules and constants are in `games/2026-10-17/js/engine.js` and match the r2/r3 table unchanged. The sim has no DOM and no wall clock; the page feeds it an active-simulation clock that stops during pause, countdown and modals.
- Input at a timestamp applies before combat events at that timestamp (`sim.punch(t)` / `sim.setGuard(t)` process only events earlier than `t`); `sim.advance(t)` processes events up to and including `t`. Order at equal timestamps: deadline, strike, impact, cosmetics.
- Pages are static, one HTML file per date. Leaving a page unloads the simulation; `pageshow` from the back/forward cache resets to Intro.
- Blocking dialogs (Pause, About, share fallback) share one stack (`js/modal.js`): background `inert`, Tab containment, focus restore to the opener or, if it is inert or gone, to the dialog beneath or a logical fallback. About opened during play pauses first, and closing it returns to Pause.
- Focus leaving the play region during play pauses immediately; the Pause dialog opens after the initiating click settles so links and buttons still perform their action.
- Combat from buttons uses pointer events and the single keyboard handler. Buttons have no combat `click` handler except a guarded one for assistive-technology activation that is suppressed right after a handled pointer/key event.
- Art is inline SVG/CSS, so it cannot fail to load; there is no external asset. Sound is optional, off by default and generated with WebAudio.
- Best KO time is stored locally under `trendraiders:thirty-second-ko:best-hundredths` (wins only); denied storage is tolerated. `data-punch-requests` on `#app` counts Punch requests so tests can detect duplicate handling.

## Commands

```sh
npm run check
npm test
npm run test:browser
npm run test:all
```

## Coverage

- `test/engine.test.mjs`: constants; schedule across frame rates; late frames; guard/counter/stun/cancel cases from acceptance tests 2–5; walkthrough 9,101 ms; punch spam loss at 9,000; timeout draws; 29,999/30,000 boundary; double KO; pause freeze semantics; retry reset.
- `test/build.test.mjs`: public build keeps scaffold and omits the candidate; preview labels; exact news recap/link; manifest hashes and reproducibility; hosting env vars ignored; Netlify config safety; empty release registry.
- `test/release.test.mjs`: registry validation; isolated nonpublic archive fixture (fake earlier edition, not a release) proving preservation of earlier routes/assets, released-only nav, root = latest released, candidate hidden unless released; preview alongside released; static-host routing, trailing-slash redirect and 404 for unknown dates.
- `test/browser/game.test.mjs`: Chromium with Playwright's fake clock at 320px portrait, 667×375 landscape and 1280×800 (visible HUD/controls, ≥56 px targets, control strip below arena); countdown; keyboard combat; stun; loss/timeout/retry; win payoff with actual KO time; reduced motion; pause/resume lead-in; blur and hidden-page auto-pause; About during held Guard (inert background, Tab containment, Escape, Pause return); About from Intro/Result; no combat keys from UI focus, single action from a focused Punch button, repeat keys; focus-leave pause; nav link still navigating; history back/forward; unknown date 404; 320px Tab traversal with visible focus; multi-touch Guard+Punch and touch cancel; storage denied and missing clipboard; link-free share before release.
- `test/browser/share-released.test.mjs`: with a fixture release registry (origin `https://games.example.test`, not a real site): share text with time and production URL, Web Share, canceled share, clipboard fallback, root and no preview framing.

## Limitations

- Browser tests run Chromium only, headless, on a fake clock, with synthetic touch via the DevTools protocol. They do not cover Safari/Firefox, real devices, real Web Share sheets, screen readers or real frame pacing.
- Contrast: `scripts/check-contrast.mjs` (run by `npm run check` and `test/contrast.test.mjs`) computes WCAG ratios for a hand-listed set of major text, button-state (including Guard held) and boundary/focus pairings. It does not audit every rendered pixel, translucent overlays (approximated by their darkest backdrop), SVG art, hover states or browser-specific rendering, and no axe audit was run.
- The fake clock steps frames deterministically; real-device input latency and `rAF` throttling are not exercised.
- Staging/production deployment, release verification and preview-domain checks (acceptance 14–15 on an actual draft) are not done: the deployment contract is unconfigured, and no staging or production deployment was made; the branch/PR is tracked in `game_jobs`.
- No staged play observations exist: attempts to first win, readability and payoff reaction (acceptance 17) remain for the PM to record. The 2–5 attempt target is a design hypothesis.
- Legal clearance of the unofficial textual reference is not provided by this implementation.

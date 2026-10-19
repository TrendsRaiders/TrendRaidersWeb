# Fly the Simulation — implementation notes (spec r1, edition 2026-10-18)

Status: **implemented locally, preview-only, not released, not staged by this change.** No gameplay acceptance, human playtest,
physical-device check or release approval is claimed. The canonical spec (`game_jobs #2`, "Fly the Simulation — implementation
specification", r1) owns the requirements; this file records what the code does, how it is tested, what was observed and what is
*not* known. Preview only: `preview/registry.json` lists the candidate, `releases/registry.json` stays empty, the public build keeps the
scaffold root.

## What is where

| Path | Purpose |
|---|---|
| `games/2026-10-18/edition.json`, `index.html` | Edition metadata and the page template filled by the shared build (nav, CSP, config, noindex/preview framing) |
| `js/engine.js` | Pure deterministic course: seven seams, 0.52/s steering, microsecond integer clock, fixed ≤1/120 s steps split at every boundary |
| `js/art.js` | Original hand-authored pixel sprites (fly ×2 wing frames, banana, banana.png icon + bitten icon, arrows, burst), four scenery/wall tile sets, 3×5 label font |
| `js/render.js` | Canvas painter at arena CSS size; whole-number sprite scale; reveal drawing |
| `js/main.js` | Controller: states, Start/Resume release gating, pause rules, inputs, result, copy |
| `js/embed.js` | Automatic official X embed for source 1 (copied from the boxing edition's reviewed module with a post-id parameter; see below) |
| `js/share.js` | Plain-text result copy, no URL in preview |
| `scripts/lib/fly-bot.mjs`, `fly-measure.mjs` | Scripted route follower; layout measurement + the spec geometry rules as checks |
| `scripts/capture-evidence.mjs` | Screenshots/measurements at 1280×800, 320×568, 390×844, 568×320, 844×390 (writes outside the repo) |
| `scripts/verify-hosted-fly.mjs` | Hosted-draft verifier written for this edition (does not reuse the boxing verifier) |
| `scripts/real-embed-check.mjs --edition 2026-10-18` | Real-provider check with edition selection (default stays the boxing edition) |

## Rules as implemented (spec numbers, verified by unit tests)

- Fly x=0.23, start y=0.50, Up/Down 0.52 arena-heights/s, clamp [0.06,0.94], opposite directions cancel.
- Walls travel at 0.30 widths/s, half-width 0.024; core half-extents 0.018 × 0.025; opening 0.28 high; contact window |t−T| ≤ 0.14 s.
- Safe test: `y−ry ≥ centre−0.14` and `y+ry ≤ centre+0.14` with a 1e-9 float tolerance (equality safe, any real penetration loses).
- Table, preview at T−2.4 s, commit at T−1.4 s (only seams 2, 4, 6), clear credited once at t > T+0.14 s, win at t = 20.000 s with 7/7.
- Time is integer microseconds, so every table instant is exact; the simulation lands exactly on each boundary (preview, commit, contact start/end, clear, win). A large `dt` cannot skip a wall: the collision is reported at the exact contact instant. Frame sizes 16 ms, 8 ms and 1 ms give identical results (unit test).
- Banana: hidden until seam 7 is clear, reaches the fly at t = 20 s, slides to the fly's height (render only; no eighth test).
- Scenery palette: garden → wireframe → desktop tiles → garden with pixel seams at the three commits; instant swap (no transition animation), pure decoration.

## Controls, focus and pause (what the controller does)

- Intro → Running ↔ Paused → Won/Lost; Restart/Retry/Play again always reset to a focused Intro (Resume never resets).
- Start/Resume are consumed (`preventDefault`/`stopPropagation`) and move focus to the arena. A click made by Enter keeps the clock at t=0 (or at the paused t) until Enter is released; Space and pointer/touch clicks are already released at click time. Directions held during arming are cleared; a held-over key needs a fresh press (key-repeat of an unowned key is ignored).
- Direction keys are consumed **only** while the play region (arena + steering buttons) owns focus. Escape pauses. Enter/Space on a focused steering button hold that direction while down.
- Pointer: one pointer per button with pointer capture; `pointerup/cancel/lostpointercapture` plus a document-level backstop clear it. `touch-action:none` only on the two steering buttons.
- Pauses (all clear input, freeze the clock, never auto-resume): Pause button, Escape, Tab out of the play region, window blur, hidden document, scroll leaving < 50% of the arena visible, a real arena size change (resize/rotation/viewport height change), frame gap > 100 ms (nothing is simulated across the gap). Redundant resize events with identical arena bounds are ignored. Paused shows "More room needed — rotate or scroll to the play area." only when the arena is not fully in view or < 180 px high.
- A Tab-out pause leaves focus where the user put it; other pauses focus Resume. The Pause button stays focusable (not `disabled`) while Paused so a Tab-out onto it does not drop focus.
- Live region: "Started…", "World rebuilding. Follow the dashed gap.", "World updated.", "Resumed.", "Paused.", the result. Nothing per frame.
- `data-*` attributes on `#game` (`data-state`, `data-t-us`, `data-fly-y`, `data-cleared`, `data-held`, `data-paused-by`, `data-hit-seam`, `data-hit-y`) expose state for the tests; they are not part of the public contract.

## Layout

- Phone portrait: one header row (arrow-only Previous/Next with the words in the accessible name, compact "Preview" badge, date, date-chooser icon), 32 px strip, arena fills the rest, steering row (two ≥96×56 hold buttons), a separate utility row 24 px below it (left-aligned; ≥44×44 targets with 14 px labels).
- Short landscape: header ≤ 36 px, arena left, 24 px gap, steering rail on the right (HUD above it, two ≥56 px stacked buttons), utility strip below the arena in the left column.
- Desktop (≥900×501): 1100 px column, 32 px strip, arena `min(66svh, …)`, compact steering buttons and utilities on one row at opposite ends.
- Heights use `100svh` (the small viewport) on purpose: an address bar collapsing must not resize the arena and pause the run. Safe-area insets are added. When the minimums do not fit (tiny screens / large text) the panel uses `min-height` and the document scrolls; nothing is clipped; News and footer are never hidden.
- Sprite scale is the smallest integer whose fly body block (9×7 art px) contains the collision core, so on tall arenas the visible body is wider than the core horizontally (the wall may visibly overlap wings/body edges by a few pixels before contact). Wings, antennae and legs never collide.

## Official embed (source 1) — reuse, differences, limits

- Reused: the reviewed automatic approach and the **unchanged** CSP (`build-lib.mjs` untouched; script-src/frame-src `platform.twitter.com` only).
- `games/2026-10-18/js/embed.js` is a copy of the boxing module with a post-id parameter, **8 s** timeout, no retry control (spec: one attempt per page load), fallback text "Embed unavailable — read the source on X". The boxing module was not modified (it keeps 10 s, its retry button and its post id), which is why this is a copy rather than a shared import. A shared module would require touching boxing artifacts.
- Real-provider run on this machine (`check:embed-real -- --edition 2026-10-18`, local preview build, production CSP): outcome `loaded` in ≈1.5 s, one `widgets.js` request, top-document hosts only `platform.twitter.com`, provider-frame hosts `abs-0.twimg.com, cdn.syndication.twimg.com, pbs.twimg.com, platform.twitter.com, syndication.twitter.com, syndication.x.com, video.twimg.com` (video playlist/segment requests happen without a click, as with the boxing edition), only the known widgets.js inline-style CSP self-test violation, one provider-script `appendChild` TypeError thrown inside X's own code. That is one observation at one moment, not a guarantee. `abs-0.twimg.com` is not in the boxing verifier's host allow-list; the Fly verifier allows it.

## Shared-site integration (additive) and changes to boxing tests

- Only `preview/registry.json` changed in shared build inputs. `build-lib.mjs`, `site/site.css`, `public/`, `releases/registry.json` and every file in `games/2026-10-17/` are unchanged (SHA-256 pinned in `test/fly-build.test.mjs`).
- Preview root now opens the latest candidate (existing rule), i.e. Fly; the boxing candidate is reached at its route or from the header's "Other dates" chooser. Neither candidate is a Previous/Next neighbor (those come from the released registry only), both arrows are disabled buttons with accessible names.
- Two shared-header consequences of having two preview entries: boxing's header gains the "Other dates" chooser (the shared builder derives it from the registry). Existing boxing tests assumed a single candidate, so: (1) `test/browser/helpers.mjs` `setup()` builds boxing suites with an explicit boxing-only preview registry by default and gains an opt-in `realPreview`; (2) `test/release.test.mjs` fixture builds pass a boxing-only preview registry; (3) the "unknown date" probes in `game.test.mjs` and `r6-embed.test.mjs` use 2026-10-19 instead of 2026-10-18 (which is now a real route). No boxing assertion was weakened.

## Tests

`npm run check` (tsc over `games/**/js` and `scripts/**`, plus contrast incl. new Fly pairs and sprite/scenery pairs), `npm test`, `npm run test:browser`, `npm run build`, `npm run build:preview`.

- `test/fly-engine.test.mjs` — table/constants, steering, clamp, events to the microsecond, final-centre geometry at every contact instant for all seven seams, equality-safe/penetration-loses, large `dt`, substep invariance, reset, banana, palette, reference route.
- `test/fly-art.test.mjs` — sprite validity, body block, core-in-body for many arena sizes, palettes, bite/hole, no remote assets.
- `test/fly-build.test.mjs` — public vs preview output, empty registry, scaffold, preservation hashes, CSP, text contract, markup contract, isolated fixture release.
- `test/browser/fly-flow.test.mjs` — Intro/start/release gating, keyboard steering, key scope, pause matrix, resume gating, restart/retry, loss/win, reveal parity (skip = natural = reduced), event boundaries, pixel-sampled opening bounds, live announcements, focus, accessible names, tiny screens.
- `test/browser/fly-layout.test.mjs` — the five named viewports: Intro fit, header, arena size, control sizes, separation, no overflow, panels inside the arena, win card fit, rotation, large text, flat UI.
- `test/browser/fly-io.test.mjs` — multi-pointer touch (CDP), utility taps, mouse capture, keyboard-hold buttons, copy outcomes, reduced motion, routes/history, header neighbors, network blocked, embed (one attempt, exactly 8 s, late success, provider completion during play).

All browser tests use a Playwright fake clock and (except the explicit network tests) a mocked provider.

## Observations from scripted runs (not human evidence)

- The reference route (scripts/lib/fly-bot.mjs) wins at exactly t = 20.000 s with 7/7 at all five viewports; holding nothing clears seam 1 and loses at seam 2's first contact instant (5.860 s), as the paper walkthrough predicts.
- Measured (fake clock, emulated viewports; see `measurements.json` from `capture-evidence.mjs`): arena 1100×528 at 1280×800 (66%); 296×340 at 320×568 (≥270 ✓); 366×616 at 390×844; 424×230 at 568×320 (≥180 ✓); 664×300 at 844×390. Steering/utility rectangle gap 24.0 px on both portrait phones.

## Known limits and open questions for PM

- **Not evidence:** human fairness/learning time, real-phone thumb reach, address-bar and safe-area behavior, accidental Pause/Restart rate, screen-reader use, physical audio/visual comfort. Emulation and scripts cannot answer them; spec "Fresh staged review" items 2–4 are still open.
- Pausing on any real arena size change means a collapsing address bar that changes the *visible viewport* does not pause (svh is stable) but a browser that changes layout size mid-run will; whether that happens repeatedly on real devices is unobserved.
- Window `blur` pauses (spec: focus loss). If a provider frame ever takes window focus during play this would pause; not observed with the real provider in the local check.
- Header on phones and short landscape shows Previous/Next as arrow-only buttons with full accessible names and a compact "Preview" badge (the long "— Preview (not released)" label is in the accessible name, visible from 900 px).
- Utility row is left-aligned under full-width steering buttons (the spec's "opposite side from the thumb controls" is ambiguous when steering spans the width).
- Tall portrait arenas (e.g. 366×616) make the whole-number sprite large (scale 5); the horizontal collision core is much narrower than the visible body there.
- The hosted verifier's "clean exact SHA" checks can only pass for a clean committed tree; this change is uncommitted, so dry runs against a local server report those two checks as failures by design.

# Bigfoot: Take Two

Candidate edition for `game_jobs #3` (key `bigfoot-take-two`), UTC edition **2026-10-19**, implemented from the canonical spec **r1** ("proposed for PM design review"). Route: `/games/2026-10-19/`. This document records what was built and what was and was not verified. It is not release approval, and nothing here claims human play or acceptance.

## Status and integration

- Staged in `preview/registry.json` only, so it is reachable through `npm run build:preview` (labeled "Preview — not released", `noindex`, link-free share text, preview root = the latest staged candidate).
- **Not** in `releases/registry.json`: the public build does not contain it (covered by `test/bigfoot-build.test.mjs`). Previous/Next derive only from the release registry, so on this preview both are disabled buttons.
- The boxing (2026-10-17) and Fly (2026-10-18) editions, the shared build library, site CSS, scaffold and release registry are byte-unchanged (asserted against `git diff HEAD`). Existing tests that assumed the preview registry held two entries, or that the preview root was the Fly page, were updated for the third staged candidate (`test/fly-build.test.mjs`, `test/public-release.test.mjs`, `test/browser/fly-io.test.mjs`).

## Files

| Path | Purpose |
|---|---|
| `games/2026-10-19/edition.json`, `index.html` | Build input and page template (intro, HUD, stage, POSE, utilities, News, About, footer) |
| `games/2026-10-19/js/engine.js` | Deterministic rules (`Take`) and the active-time clock (`ActiveClock`); no DOM |
| `games/2026-10-19/js/art.js` | Original pixel sprites on logical grids (monster frames, fern, tree, camera, clapperboard, boom mic, fan, sandwich), 3x5 sign font, rasterizer |
| `games/2026-10-19/js/render.js` | Canvas painter: stage, tape strip, footpoint marker, photo frame, wide-set reveal, contact-sheet thumbnails |
| `games/2026-10-19/js/main.js` | Controller: input paths, pause/blur/stall rules, results, reveal, sound toggle, share |
| `games/2026-10-19/js/embed.js`, `share.js` | One automatic official X embed (6000 ms), optional share/copy |
| `games/2026-10-19/game.css` | Game-first layouts: phone portrait, desktop, short landscape |
| `test/bigfoot-*.test.mjs`, `test/browser/bigfoot-*.test.mjs` | Unit, build and browser tests |
| `scripts/check-contrast.mjs` | Added Bigfoot UI/stage/sprite contrast pairs |

## Rules as implemented (spec numbers)

All times are integer microseconds of *active* simulation time, so every table value is exact and results never depend on the frame rate.

- Rolling 650 ms (stationary, POSE ignored and never queued), walking 3.2 s, `x(t) = 0.08 + 0.84 t/3.2`, result window 900 ms.
- Centers `[1.80, 2.25, 1.55, 2.05, 1.70]`, half-windows `[0.26, 0.23, 0.21, 0.19, 0.18]`, inclusive: success iff `|t-c| <= w`.
- Timeout only for `t > c+w`. The engine places the timeout at the first instant after `c+w` (`c+w+1 µs`), so it is independent of frame size. An input stamped at exactly `c+w` succeeds even if it is delivered in the same batch as the overdue update (`Take.poseAt` simulates up to the event without timing out first). An input stamped after `c+w` that the simulation had not yet timed out is classified "Too late"; a no-input timeout is "Missed the mark". Both are misses, so the score never depends on the label.
- `usable == 4` wins, `misses == 2` loses (checked after the 900 ms window); a sixth shot cannot occur (exhaustively tested over all hit/miss patterns).
- Foreground gap above 250 ms auto-pauses before advancing (`ActiveClock.frame` reports a stall; a POSE that arrives after a stall pauses instead of scoring). Pause, blur, `visibilitychange`/`pagehide`, rotation and an unreadably small resize stop every clock; focus return and Resume never pose.
- Input paths (one per device action): keyboard `keydown` (Space/Enter, non-repeat, only when the target is the stage or POSE; never in nav/footer/News), `pointerdown` on POSE, `pointerdown` on the stage background (primary pointer, not on panels/buttons), and a click with `detail === 0` for assistive technology. A click that follows a scoring `pointerdown` is suppressed; a click right after a keyboard pose is suppressed. Keys held through Start/Resume are recorded and can never pose.

## Design decisions and deviations to review

- **Event time** is `performance.now()` at the handler, translated to the active clock; `event.timeStamp` is not used because it is not rebased by the Playwright fake clock and the handler latency is bounded by the same task queue as the frame. This is a precision limit, not a rule change.
- **Header title.** The visible title is not in the arena (the intro contains only goal/controls/Start per spec); the page has a screen-reader-only `h1` and `<title>`, as in the Fly edition. The shared header (`build-lib.mjs`) was not changed to add a visible title.
- **Result cue.** ROLLING / "✓ Usable" / "✗ Too early / Too late / Missed the mark" are DOM text over the stage (`aria-hidden`); the semantic live region announces each shot outcome once ("Shot 1: Usable. Usable 1 of 4.").
- **Stage geometry.** Everything is laid out from arena fractions: feet line at 62% of height; the usable strip, center tape and brackets sit on a band *below* the feet line so the performer can never hide the window edges; the footpoint marker is a magenta diamond with a white ring between the feet and the band. The sprite is scaled by one whole-number factor (about 25–30% of stage height, capped by width), so at the left start mark the sprite is partly clipped by the stage edge (the marker stays exactly at x = 0.08).
- **Optional sound** is a labeled toggle (default off) with a tiny synthesized blip; it is never required.
- **Share** is offered on a win only (Web Share, copy fallback, selectable text fallback). In preview there is no link and the text says "preview build: not a released link". A loss share is not offered.
- **Embed** reuses the reviewed site CSP unchanged. Differences from the Fly embed: 6000 ms timeout, spec failure wording, late callbacks cannot overwrite a settled state, and on failure the holder node is removed so a late widget renders into a detached node. The embed area has a fixed height so success, failure and late arrival never shift the page. The ordinary link to the Variety post is always present.

## Checks that were run

See the handoff summary for the exact commands and results. Planned acceptance items that need people or devices (acceptance test 9, physical devices, real-provider embed/CSP inspection with network) are **not** covered by automation and have not been done.

## Known limitations

- Touch is Playwright emulation, not a physical device. Screenshots/pixel checks cover 320×568, 390×844, 844×390, 568×320 and 1280×800 in Chromium only.
- The real X provider was not exercised (`npm run check:embed-real -- --edition 2026-10-19` is not supported by the script, which only knows the two earlier editions); only mocked provider modes (success, blocked, reject, never, deferred) were tested.
- `scripts/verify-hosted.mjs` and `scripts/verify-hosted-fly.mjs` assert the preview manifest lists exactly the two earlier previews; they would flag a *preview* deploy that now lists three. They were not edited. Public-mode checks are unaffected (Bigfoot is not in the public build).
- Intended pacing (2–6 attempts, 2–6 minutes to first win, about 15–20 s for a perfect attempt) is a hypothesis; no human play was observed. Tuning is exactly the spec constants; nothing was retuned.

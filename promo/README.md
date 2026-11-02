# Talky promo film

A ~39 s silent launch film for Talky, in two cuts:

| Cut | File | Format |
|-----|------|--------|
| 16:9 | `renders/talky-promo-16x9.mp4` (+ `-poster.png`) | 1920×1080, 60 fps, H.264 yuv420p, faststart |
| 9:16 | `renders/talky-promo-9x16.mp4` (+ `-poster.png`) | 1080×1920, 60 fps, H.264 yuv420p, faststart |

It is a [HyperFrames](https://hyperframes.heygen.com) code video: an HTML composition animated with a
GSAP timeline and rendered to MP4 by the open-source `hyperframes` CLI (v0.9.0). Everything that
looks like the product **is** the product: the real control panel (`web-ui/dist`) served by the
real control server (`src/web/control-server.ts`), filmed with Playwright. Shot list and timings:
[`STORYBOARD.md`](STORYBOARD.md).

## Re-capture and re-render

Needs Bun, Node ≥ 22, FFmpeg and a Chromium that Playwright can launch (`require('playwright')`).
No WhatsApp account is needed.

```bash
cd web-ui && bun install && bun run build && cd ..   # the panel being filmed
bun run promo:capture   # films the panel → promo/hf/assets/, composes promo/hf/build/{wide,tall}
bun run promo:draft     # optional: fast low-res preview renders (…-draft.mp4)
bun run promo:render    # final 60fps renders + posters → promo/renders/
```

A full capture takes about 6 minutes. A final render of both cuts takes roughly 15–25 minutes on a laptop CPU.

To edit visually, open a build folder in HyperFrames Studio, for example:
`cd promo/hf/build/wide && npx hyperframes@0.9.0 preview`.
The HyperFrames desktop app also works. Generated folders are overwritten by `promo:compose`, so carry lasting changes back to the sources below.

## How it works

```
promo/
  scripts/preview-server.ts  real control server + built panel, fake WhatsApp runtime, seeded data
  scripts/capture.cjs        Playwright: plates, chart reveals, recorded interactions → hf/assets/
  scripts/compose.cjs        writes hf/build/{wide,tall}/index.html (beat timings live here)
  scripts/render.cjs         hyperframes render → ffmpeg delivery encode + poster frames
  hf/film.js                 the director: camera moves, cursor, captions, transitions (GSAP)
  hf/film.css                look: palette = the panel's tokens, Geist type
  hf/vendor/gsap.min.js      GSAP 3.13 (vendored; the render sandbox has no CDN access)
  STORYBOARD.md              beats and final timings
```

1. **Preview server** (`bun run promo:preview-server`).
   - Creates a temp working dir and seeds about 32 days of plausible activity for five fictional chats (Riya, Arjun, Mum, "Product squad", "CSE '22 gang"): chat logs, reply decisions, a Claude queue with 4 waiting messages, persona files and `config.yaml`. A seeded PRNG keeps it deterministic.
   - Picks an `Etc/GMT±N` time zone so "now" is about 20:xx local, which keeps the "today, hour by hour" chart full whenever you capture.
   - Starts `startControlServer()` with a fake runtime.
   - Prints `{url, tz, token, dir}`.
2. **Capture** (`capture.cjs`) runs once per format: desktop 1600×1000 @2×, phone 640×1138 @3×.
   - **Plates.** Full-page stills of Overview and Voice, with their charts at 0%.
   - **Reveal clips.** The same chart regions re-shot frame by frame at 60 fps while an injected performer drives the live DOM from 0 to 100%: bar heights, heatmap cells, the line chart's clip rect, dumbbell dots. The camera can push in to 2× and stay sharp.
   - **Interactions.** Real clicks and typing (open a queued message, type, Send; Pause replies; dark theme) recorded as timed state snapshots. Page timers run on Playwright's fake clock, and CSS transitions are slowed via CDP, so the toast and banner animate smoothly and repeatably.
   - **Layout file.** `hf/layout-<fmt>.js` records every region box and the recorded cursor/click points.
3. **Compose and render.** `film.js` flies a virtual camera over the plates. It places each clip at its captured coordinates, draws the cursor from the recorded points, and animates captions and transitions on one paused timeline. HyperFrames renders it deterministically, with motion blur on fast moves (`data-motion-blur="on"`).

### Changing things

- **Copy (captions, hook, end card):** `scripts/compose.cjs`, then `bun run promo:compose`.
- **Timing of a beat:** the `T` table in `scripts/compose.cjs`. Camera and caption times in `film.js` key off those values.
- **Camera moves and easing:** `hf/film.js`.
- **Sample data:** `scripts/preview-server.ts`, then re-capture.
- **Music:** none by design. The ♪ beats in `STORYBOARD.md` mark the hits. Add a track in HyperFrames Studio (an `<audio id=… data-start=…>` in the composition) or in any editor.

The capture assets and build folders are git-ignored (regenerable). The finished renders are committed.

# Talky promo — storyboard (final timings)

39 s, silent, 60 fps. Two cuts from the same beats: **16:9** (1920×1080) and **9:16**
(1080×1920, re-laid-out on the panel's real phone layout). Times are seconds on the root
timeline; the clip starts live in `scripts/compose.cjs` (`T`), the motion in `hf/film.js`.

Music beats are marked ♪: these are the moments a track should hit if one is added later.

| # | Time | Beat | What is on screen (all real Talky UI) | Transition out |
|---|------|------|----------------------------------------|----------------|
| 1 | 0.0–3.9 | **Hook** | Talky mark on a dark canvas; "Your WhatsApp, answered in **your voice.**" blurs in word by word. The mark's orange "speaking" dot answers twice (♪ 1.45, ♪ 2.35). | **Container morph** (3.17): the title blurs out, and the mark's tile grows into the panel window. |
| 2 | 3.5–12.9 | **Overview** | The real dashboard lands slightly large and settles. The camera glides into *What Talky did, hour by hour* while the bars grow (♪ 5.75). Caption: "See **every reply,** hour by hour." The camera pans down to the weekday × hour heatmap as it lights up (♪ 9.15), then tracks to **Open live queue**. | **Zoom through the button** (12.4–12.9): the orange fill becomes the frame. |
| 3 | 12.9–20.3 | **Live queue** | Recorded interaction: a cursor opens Riya's waiting message, the camera pushes in to the composer, and "yes!! 8 baje? I'll book the table 🙌" is typed. **Send** (♪ ≈17.6): the toast appears and the item leaves the queue (4 → 3). Caption: "**Step in** whenever you want." | **Whip** left (20.0). |
| 4 | 20.3–28.7 | **Voice fingerprint** | The Voice page arrives from the right. Caption: "Sounds like **you.**" The words-per-day line draws (♪ 21.5), the You-vs-Talky dumbbell dots slide into place (♪ 24.0) and the message-length bars grow (♪ 26.3). | **Blur swap** (28.5). |
| 5 | 28.7–33.2 | **Control** | Overview with every chart drawn. The camera pushes to the header and the cursor presses **Pause replies** (♪ 29.7). The *Replies are paused* banner drops in and the button becomes *Resume replies*. Caption: "**One switch.** Total control." Pull back; on desktop the cursor clicks the moon, and an **iris** opens dark mode from that point (♪ 31.45). On the phone cut it is a flood from the top. | **Recede** (33.2): the window shrinks and blurs into the canvas. |
| 6 | 33.2–39.0 | **End card** | Mark and wordmark land, followed by the dot pulse (♪ 34.7). "Local-first. Private. **Yours.**" appears, then `github.com/anandxdj/talky`. Held for about 3.5 s. | — |

## Notes

- **Product shots.** Every product shot comes from the real panel (`web-ui/dist`), served by the real control server (`src/web/control-server.ts`) against seeded, fictional data. The data uses placeholder names and +1 555-01xx numbers.
- **Chart reveals.** These are the live page re-rendered frame by frame: the in-page performer in `scripts/capture.cjs` drives each chart's bar heights, cell colours, line clip or dot positions from 0 to 100%.
- **Polish added on top of the real UI.**
  - The paused banner's short drop-in animation is injected CSS. The real banner appears instantly.
  - The cursor is drawn by the composition from the recorded click points.
- **Vertical cut layout.** Captions sit in the top band (y 250–560). The product sits in the 560–1330 band, so nothing important falls under platform UI.

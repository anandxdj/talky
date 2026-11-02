/*
 * Talky promo — shared film director for both cuts (index.html = 16:9, vertical.html = 9:16).
 *
 * Every product shot is the REAL Talky panel, captured by promo/scripts/capture.cjs:
 *   - "worlds" are full-page plates of the panel (PNG @2–3x) that a virtual camera flies over,
 *   - timed <video> clips sit on top of the plates at the exact captured coordinates and show
 *     the real UI performing (charts revealing, the live-queue reply, Pause replies),
 *   - the cursor is drawn here from the capture's recorded click points.
 * Media timing lives in the HTML (data-start / data-duration); this file reads those values so
 * the camera, cursor and captions stay locked to the clips.
 *
 * Deterministic: no clocks, no randomness, one paused GSAP timeline registered on __timelines.
 */
(function () {
  const root = document.getElementById('root')
  const FMT = root.dataset.format // "wide" | "tall"
  const L = window.PROMO_LAYOUT[FMT]
  const ASSETS = `assets/${FMT}`
  const W = Number(root.dataset.width)
  const H = Number(root.dataset.height)
  const TALL = FMT === 'tall'
  const $ = (s) => document.querySelector(s)
  const $$ = (s) => Array.from(document.querySelectorAll(s))
  const startOf = (id) => Number($(id).dataset.start)

  const tl = gsap.timeline({ paused: true })

  // ------------------------------------------------------------------ framing
  // Where the "screen" sits in the frame. Wide: centred. Tall: the product band (168–1330px)
  // under the caption area, per vertical safe zones.
  const FOCUS = TALL ? { x: W / 2, y: 1010 } : { x: W / 2, y: H / 2 - 20 }
  const cam = (cx, cy, s, fx = FOCUS.x, fy = FOCUS.y) => ({ x: fx - cx * s, y: fy - cy * s, scale: s })
  /** Keep a zoomed-in camera inside the page so the frame never shows past its edge. */
  const clampCam = (c, pageW, pageH) => {
    const top = TALL ? 480 : 0
    if (pageW * c.scale >= W) c.x = Math.min(0, Math.max(W - pageW * c.scale, c.x))
    if (pageH * c.scale >= H - top) c.y = Math.min(top, Math.max(H - pageH * c.scale, c.y))
    return c
  }
  /** Camera that fits a region box (CSS px of the page) into a share of the frame. */
  const frameBox = (b, fillW, fillH, dy = 0, page = null) => {
    const s = Math.min((W * fillW) / b.w, (H * fillH) / b.h)
    const c = cam(b.x + b.w / 2, b.y + b.h / 2 + dy / s, s)
    return page ? clampCam(c, page.pageW, page.pageH) : c
  }
  /** Establishing shot: page top-centred, full width (with margin). */
  const establish = (pageW, scaleMul = 1) => {
    const s = (TALL ? (W * 0.9) / pageW : (W * 0.78) / pageW) * scaleMul
    const topY = TALL ? 530 : 96
    return { x: W / 2 - (pageW / 2) * s, y: topY, scale: s }
  }

  // ------------------------------------------------------------------ place the real footage
  function placeWorld(world, page, plate) {
    world.style.width = page.pageW + 'px'
    world.style.height = page.pageH + 'px'
  }
  function placeClip(id, clip) {
    const v = $(id)
    Object.assign(v.style, { left: clip.x + 'px', top: clip.y + 'px', width: clip.w + 'px', height: clip.h + 'px' })
  }
  placeWorld($('#w-overview'), L.overview, L.overview.plateStart)
  placeClip('#v-hourly', L.overview.clips.hourly)
  placeClip('#v-heat', L.overview.clips.heat)
  placeWorld($('#w-voice'), L.voice, L.voice.plateStart)
  placeClip('#v-words', L.voice.clips.words)
  placeClip('#v-dumbbell', L.voice.clips.dumbbell)
  placeClip('#v-lengths', L.voice.clips.lengths)
  placeWorld($('#w-queue'), { pageW: L.queue.w, pageH: L.queue.h })
  placeClip('#v-queue', { x: 0, y: 0, w: L.queue.w, h: L.queue.h })
  placeWorld($('#w-control'), { pageW: L.control.w, pageH: L.control.h })
  placeClip('#v-control', { x: 0, y: 0, w: L.control.w, h: L.control.h })
  Object.assign($('#control-dark').style, { width: L.control.w + 'px', height: L.control.h + 'px' })

  // ------------------------------------------------------------------ helpers
  // Initial states outside the timeline (hidden states are authored in film.css).
  gsap.set(['#w-overview', '#w-queue', '#w-voice', '#w-control'], { transformOrigin: '0 0' })
  gsap.set(['#mark-dot', '#end-mark-dot'], { transformOrigin: '50% 50%' })

  /** Caption: words blur in (stagger 70ms), hold dead still, blur out. */
  function caption(id, tIn, tOut) {
    const words = $$(`${id} .w`)
    tl.set(id, { opacity: 1 }, tIn)
    tl.fromTo(`${id} .pill`, { opacity: 0, scale: 0.96 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'expo.out' }, tIn)
    // per word, from dim grey to paper — no position change
    tl.to(words, { opacity: 1, color: '#f4f4f1', duration: 0.16, ease: 'power1.out', stagger: 0.08 }, tIn + 0.05)
    tl.to(`${id} .w.accent`, { color: '#eb6834', duration: 0.2, ease: 'power1.out' }, tIn + 0.05 + words.length * 0.08)
    tl.to(id, { opacity: 0, filter: 'blur(6px)', duration: 0.22, ease: 'power2.in' }, tOut)
  }

  /**
   * Cursor from recorded click points (times relative to the clip start). Each move lands on
   * its recorded time with a ≤0.65s eased glide; a click is a short press (scale), no rings.
   */
  function cursorTrack(sel, points, t0) {
    const el = $(sel)
    const first = points[0]
    tl.set(el, { x: first.x, y: first.y, opacity: 1 }, t0)
    let prevT = first.t
    for (let i = 1; i < points.length; i += 1) {
      const p = points[i]
      const prev = points[i - 1]
      const moved = Math.hypot(p.x - prev.x, p.y - prev.y) > 1
      if (moved) {
        const dur = Math.max(0.2, Math.min(0.65, p.t - prevT))
        tl.to(el, { x: p.x, y: p.y, duration: dur, ease: 'power3.inOut' }, t0 + p.t - dur)
      }
      if (p.click && TALL) {
        // touch: the fingertip shows only around each tap
        tl.fromTo(`${sel} .arrow`, { opacity: 0, scale: 1.4 }, { opacity: 1, scale: 0.85, duration: 0.18, ease: 'power2.out', immediateRender: false }, t0 + p.t - 0.16)
        tl.to(`${sel} .arrow`, { opacity: 0, scale: 1.15, duration: 0.3, ease: 'power2.out' }, t0 + p.t + 0.08)
      } else if (p.click) {
        tl.to(`${sel} .arrow`, { scale: 0.8, duration: 0.07, ease: 'power2.out' }, t0 + p.t - 0.04)
        tl.to(`${sel} .arrow`, { scale: 1, duration: 0.22, ease: 'power3.out' }, t0 + p.t + 0.06)
      }
      prevT = p.t
    }
    return el
  }

  // =================================================================== 1. HOOK
  const ov = L.overview
  const ovEst = establish(ov.pageW)
  tl.set('#hook', { opacity: 1 }, 0)
  tl.fromTo('#mark', { scale: 0.86, opacity: 0.35 }, { scale: 1, opacity: 1, duration: 0.9, ease: 'expo.out' }, 0)
  tl.to('#hook-title .w', { opacity: 1, filter: 'blur(0px)', duration: 0.2, ease: 'power2.out', stagger: 0.09 }, 0.55)
  // the "speaking" dot answers on the beat
  tl.to('#mark-dot', { scale: 1.55, duration: 0.16, ease: 'power2.out' }, 1.45)
  tl.to('#mark-dot', { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.55)' }, 1.61)
  tl.to('#mark-dot', { scale: 1.4, duration: 0.14, ease: 'power2.out' }, 2.35)
  tl.to('#mark-dot', { scale: 1, duration: 0.45, ease: 'elastic.out(1, 0.55)' }, 2.49)
  // title leaves; the mark's tile becomes the panel window (container morph)
  tl.to('#hook-title', { opacity: 0, filter: 'blur(8px)', duration: 0.22, ease: 'power2.in' }, 3.0)
  tl.to('#mark-glyph', { opacity: 0, duration: 0.15, ease: 'power1.in' }, 3.08)
  const mb = TALL ? { x: W / 2 - 110, y: 640, s: 220 } : { x: W / 2 - 90, y: 250, s: 180 }
  const winX = ovEst.x
  const winY = ovEst.y
  const winR = W - (ovEst.x + ov.pageW * ovEst.scale)
  const inset = (t, r, b, l, rad) => `inset(${t}px ${r}px ${b}px ${l}px round ${rad}px)`
  // explicit from/to strings (left ≠ right by a hair so the browser never collapses the shorthand)
  tl.set('#morph', { opacity: 1 }, 3.17)
  tl.set('#mark', { opacity: 0 }, 3.17)
  tl.fromTo(
    '#morph',
    { clipPath: inset(mb.y, W - mb.x - mb.s, H - mb.y - mb.s, mb.x + 0.01, mb.s * 0.29) },
    { clipPath: inset(winY, winR, -40, winX + 0.01, 16), duration: 0.7, ease: 'power3.inOut', immediateRender: false },
    3.17,
  )
  // the real panel lands in the window, slightly large, and settles
  tl.set('#w-overview', { ...ovEst, scale: ovEst.scale * 1.035, x: ovEst.x - ov.pageW * ovEst.scale * 0.0175 }, 3.5)
  tl.to('#w-overview', { opacity: 1, duration: 0.3, ease: 'power1.out' }, 3.55)
  tl.to('#w-overview', { ...ovEst, duration: 1.0, ease: 'expo.out' }, 3.55)
  tl.set('#hook', { opacity: 0 }, 3.9)
  tl.to('#morph', { opacity: 0, duration: 0.2 }, 3.85)

  // =================================================================== 2. OVERVIEW
  const tHourly = startOf('#v-hourly')
  const tHeat = startOf('#v-heat')
  const hourlyCam = TALL ? frameBox(ov.regions.hourly, 0.96, 0.5, 0, ov) : frameBox(ov.regions.hourly, 0.8, 0.66, 50, ov)
  const heatCam = TALL ? frameBox(ov.regions.heat, 0.96, 0.5, 0, ov) : frameBox(ov.regions.heat, 0.8, 0.66, 50, ov)
  tl.to('#w-overview', { ...hourlyCam, duration: 1.0, ease: 'power2.inOut' }, tHourly - 0.75)
  caption('#cap-hourly', tHourly + 0.35, tHeat - 0.55)
  tl.to('#w-overview', { ...heatCam, duration: 0.95, ease: 'power2.inOut' }, tHeat - 0.7)
  // track to "Open live queue", then zoom through the orange button into the queue
  const oq = ov.regions.openQueue
  const tQueue = startOf('#v-queue')
  const throughPt = { x: oq.x + oq.w * 0.12, y: oq.y + oq.h / 2 }
  tl.to('#w-overview', { ...cam(oq.x + oq.w / 2, oq.y + oq.h / 2, TALL ? 2.6 : 2.5), duration: 0.75, ease: 'power2.inOut' }, tQueue - 1.25)
  tl.to('#w-overview', { ...cam(throughPt.x, throughPt.y, 34), duration: 0.5, ease: 'power3.in' }, tQueue - 0.5)
  tl.set('#w-overview', { opacity: 0 }, tQueue + 0.02)

  // =================================================================== 3. LIVE QUEUE
  const Q = L.queue
  const qFit = TALL
    ? cam(Q.w / 2, Q.h / 2, (W * 0.94) / Q.w, W / 2, 1000)
    : cam(Q.w / 2, Q.h / 2, Math.min((W * 0.86) / Q.w, (H * 0.86) / Q.h), W / 2, H / 2)
  const qCur = Q.cursor
  const clicks = qCur.filter((p) => p.click)
  const riya = clicks[0] // open Riya's message
  const typePt = clicks[1] // click into the composer
  tl.set('#w-queue', { ...qFit, scale: qFit.scale * 1.12, x: qFit.x - Q.w * qFit.scale * 0.06, y: qFit.y - Q.h * qFit.scale * 0.06 }, tQueue - 0.08)
  tl.to('#w-queue', { opacity: 1, duration: 0.18, ease: 'power1.out' }, tQueue - 0.08)
  tl.to('#w-queue', { ...qFit, duration: 0.8, ease: 'expo.out' }, tQueue)
  tl.set('#flash', { opacity: 1 }, tQueue - 0.06)
  tl.to('#flash', { opacity: 0, duration: 0.3, ease: 'power2.out' }, tQueue - 0.04)
  if (TALL) {
    tl.to('#w-queue', { ...cam(Q.w / 2, riya.y, 1.75), duration: 0.8, ease: 'power2.inOut' }, tQueue + 0.35)
    tl.to('#w-queue', { ...cam(Q.w / 2, typePt.y - 120, 1.75), duration: 0.7, ease: 'power2.inOut' }, tQueue + Q.riyaAt + 0.15)
    tl.to('#w-queue', { ...cam(Q.w / 2, Q.h * 0.42, (W * 0.94) / Q.w, W / 2, 1000), duration: 0.9, ease: 'power2.inOut' }, tQueue + Q.sendAt + 0.15)
  } else {
    tl.to('#w-queue', { ...cam(riya.x + 330, 470, 1.4), duration: 0.85, ease: 'power2.inOut' }, tQueue + 0.45)
    tl.to('#w-queue', { ...cam(typePt.x + 250, typePt.y - 90, 1.95), duration: 0.8, ease: 'power2.inOut' }, tQueue + Q.typeStart - 0.55)
    tl.to('#w-queue', { ...qFit, duration: 0.95, ease: 'power2.inOut' }, tQueue + Q.sendAt + 0.12)
  }
  cursorTrack('#cur-queue', qCur, tQueue)
  caption('#cap-queue', tQueue + Q.typeStart - 0.2, tQueue + Q.sendAt + 1.9)

  // =================================================================== 4. VOICE
  const V = L.voice
  const tWords = startOf('#v-words')
  const tDumb = startOf('#v-dumbbell')
  const tLen = startOf('#v-lengths')
  const tVoice = tWords - 1.2
  const vEst = establish(V.pageW)
  // whip: queue exits left, voice arrives from the right and sharpens
  tl.to('#w-queue', { x: `-=${W * 1.25}`, duration: 0.32, ease: 'power3.in' }, tVoice - 0.3)
  tl.set('#w-queue', { opacity: 0 }, tVoice + 0.03)
  tl.set('#cur-queue', { opacity: 0 }, tVoice)
  tl.set('#w-voice', { ...vEst, x: vEst.x + W * 1.2, opacity: 1 }, tVoice - 0.02)
  tl.to('#w-voice', { ...vEst, duration: 0.55, ease: 'expo.out' }, tVoice)
  caption('#cap-voice', tVoice + 0.35, tLen + 1.6)
  const wordsCam = TALL ? frameBox(V.regions.words, 0.96, 0.4, 0, V) : frameBox(V.regions.words, 0.74, 0.62, 40, V)
  const dumbCam = TALL ? frameBox(V.regions.dumbbell, 0.9, 0.42, 0, V) : frameBox(V.regions.dumbbell, 0.55, 0.7, 40, V)
  const lenCam = TALL ? frameBox(V.regions.lengths, 0.96, 0.4, 0, V) : frameBox(V.regions.lengths, 0.8, 0.62, 40, V)
  tl.to('#w-voice', { ...wordsCam, duration: 0.9, ease: 'power2.inOut' }, tWords - 0.7)
  tl.to('#w-voice', { ...dumbCam, duration: 0.85, ease: 'power2.inOut' }, tDumb - 0.7)
  tl.to('#w-voice', { ...lenCam, duration: 0.85, ease: 'power2.inOut' }, tLen - 0.7)

  // =================================================================== 5. CONTROL
  const C = L.control
  const tCtl = startOf('#v-control')
  const cFit = TALL
    ? cam(C.w / 2, C.h / 2, (W * 0.94) / C.w, W / 2, 1000)
    : cam(C.w / 2, C.h / 2, Math.min((W * 0.86) / C.w, (H * 0.86) / C.h), W / 2, H / 2)
  // blur swap on one stage: voice blurs out, the overview (now with every chart drawn) blurs in
  tl.to('#w-voice', { opacity: 0, filter: 'blur(10px)', duration: 0.2, ease: 'power2.in' }, tCtl - 0.2)
  tl.set('#w-control', { ...cFit, opacity: 0, filter: 'blur(10px)' }, tCtl - 0.05)
  tl.to('#w-control', { opacity: 1, filter: 'blur(0px)', duration: 0.22, ease: 'power2.out' }, tCtl - 0.05)
  const pz = C.regions.pause
  const pauseCam = clampCam(TALL ? cam(C.w / 2, pz.y + 60, 1.55) : cam(pz.x - 430, pz.y + 110, 1.45), C.w, C.h)
  tl.to('#w-control', { ...pauseCam, duration: 0.8, ease: 'power2.inOut' }, tCtl + 0.1)
  tl.to('#w-control', { ...cFit, duration: 0.9, ease: 'power2.inOut' }, tCtl + C.pauseAt + 0.9)
  cursorTrack('#cur-control', C.cursor, tCtl)
  caption('#cap-control', tCtl + C.pauseAt + 0.3, tCtl + C.pauseAt + 3.1)
  // theme flip: an iris from the clicked moon (wide) / a flood from the top (tall)
  const tFlip = tCtl + (C.moonAt ?? 2.7)
  const irisAt = C.regions.moon ? { x: C.regions.moon.x + C.regions.moon.w / 2, y: C.regions.moon.y + C.regions.moon.h / 2 } : { x: C.w / 2, y: 0 }
  const irisR = Math.hypot(C.w, C.h) * 1.05
  tl.set('#control-dark', { opacity: 1, clipPath: `circle(0px at ${irisAt.x}px ${irisAt.y}px)` }, tFlip)
  tl.to('#control-dark', { clipPath: `circle(${irisR}px at ${irisAt.x}px ${irisAt.y}px)`, duration: 0.7, ease: 'power2.inOut' }, tFlip)

  // =================================================================== 6. END CARD
  const tEnd = Number($('#end').dataset.at)
  tl.set('#cur-control', { opacity: 0 }, tEnd)
  tl.to('#w-control', { scale: cFit.scale * 0.82, x: cFit.x + C.w * cFit.scale * 0.09, y: cFit.y + C.h * cFit.scale * 0.09, opacity: 0, filter: 'blur(14px)', duration: 0.6, ease: 'power2.in' }, tEnd)
  tl.set('#end', { opacity: 1 }, tEnd + 0.45)
  tl.fromTo('#end-mark', { scale: 0.55, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.9, ease: 'expo.out' }, tEnd + 0.5)
  tl.fromTo('#end-word', { clipPath: 'inset(0 100% 0 0)', x: -24 }, { clipPath: 'inset(0 0% 0 0)', x: 0, duration: 0.6, ease: 'power3.out' }, tEnd + 0.9)
  tl.to('#end-mark-dot', { scale: 1.45, duration: 0.14, ease: 'power2.out' }, tEnd + 1.5)
  tl.to('#end-mark-dot', { scale: 1, duration: 0.45, ease: 'elastic.out(1, 0.55)' }, tEnd + 1.64)
  tl.to('#end-line .w', { opacity: 1, filter: 'blur(0px)', duration: 0.2, ease: 'power2.out', stagger: 0.16 }, tEnd + 1.45)
  tl.fromTo('#end-url', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6, ease: 'expo.out' }, tEnd + 2.3)

  window.__timelines = window.__timelines || {}
  window.__timelines['main'] = tl
})()

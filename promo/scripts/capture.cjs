#!/usr/bin/env node
/**
 * Captures the REAL Talky panel for the promo film.
 *
 *   node promo/scripts/capture.cjs            (or: bun run promo:capture)
 *
 * 1. Starts promo/scripts/preview-server.ts (real control server + built web-ui, fake runtime,
 *    seeded fictional data).
 * 2. For each format ("wide" = desktop 1600×1000 @2x, "tall" = phone-width 640×1138 @3x):
 *    - plates: full-page stills of Overview / Voice with their charts at progress 0,
 *    - reveal clips: the same chart regions re-shot frame by frame while a small in-page
 *      "performer" drives each chart from 0 → 100% (bar heights, heatmap cells, the line's
 *      clip rect, dumbbell positions). Every pixel is the live UI rendering its real data.
 *    - interaction clips: real clicks/typing (open a queued message, type a reply, Send; press
 *      Pause replies; switch theme), recorded as timed state snapshots. Page timers run on
 *      Playwright's fake clock and CSS animations are slowed through CDP, so short UI
 *      transitions (toast, banner) are sampled smoothly and deterministically.
 * 3. Writes everything to promo/hf/assets/<format>/ plus layout-<format>.js, which the
 *    HyperFrames compositions read (region boxes, clip files, cursor keyframes).
 *
 * The cursor is NOT burned into the footage: the composition draws it from the exported
 * keyframes, so it moves smoothly at 60fps with motion blur.
 */
const { chromium } = require('playwright')
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..', '..')
const HF = path.join(REPO, 'promo', 'hf')
const WORK = path.join(REPO, 'promo', '.work')
const FPS = 60
const PORT = Number(process.env.PROMO_PORT || 4319)
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith('-'))

const FORMATS = {
  wide: { viewport: { width: 1600, height: 1000 }, dsf: 2, mobile: false },
  tall: { viewport: { width: 640, height: 1138 }, dsf: 3, mobile: true },
}

// Reply typed in the live-queue clip.
const REPLY = "yes!! 8 baje? I'll book the table 🙌"

// ---------------------------------------------------------------- helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rmrf = (p) => fs.rmSync(p, { recursive: true, force: true })
const mkdirp = (p) => fs.mkdirSync(p, { recursive: true })

function startPreviewServer() {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', [path.join(REPO, 'promo/scripts/preview-server.ts'), '--port', String(PORT)], {
      cwd: REPO,
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let buf = ''
    child.stdout.on('data', (d) => {
      buf += d.toString()
      for (const line of buf.split('\n')) {
        if (line.startsWith('{') && line.includes('"ready"')) {
          try {
            resolve({ child, info: JSON.parse(line) })
          } catch (e) {
            reject(e)
          }
        }
      }
    })
    child.on('exit', (code) => reject(new Error(`preview server exited (${code})`)))
    setTimeout(() => reject(new Error('preview server did not start in 30s')), 30_000)
  })
}

/** Encode numbered PNG frames (constant 60fps) into a high-quality H.264 clip, holding the last frame. */
function encodeFrames(dir, out, holdSeconds) {
  const args = ['-v', 'error', '-y', '-framerate', String(FPS), '-i', path.join(dir, '%05d.png')]
  const vf = ['pad=ceil(iw/2)*2:ceil(ih/2)*2']
  if (holdSeconds > 0) vf.push(`tpad=stop_mode=clone:stop_duration=${holdSeconds}`)
  args.push('-vf', vf.join(','))
  args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', out)
  execFileSync('ffmpeg', args)
}

/** Encode timed states [{t, file}] into a constant-60fps clip (each state holds until the next). */
function encodeStates(states, endT, out) {
  const frameDir = out + '.frames'
  rmrf(frameDir)
  mkdirp(frameDir)
  const total = Math.round(endT * FPS)
  let si = 0
  for (let f = 0; f < total; f += 1) {
    const t = f / FPS
    while (si + 1 < states.length && states[si + 1].t <= t + 1e-6) si += 1
    fs.linkSync(states[si].file, path.join(frameDir, String(f).padStart(5, '0') + '.png'))
  }
  encodeFrames(frameDir, out, 0)
  rmrf(frameDir)
}

// ---------------------------------------------------------------- in-page performer
// Injected into the live panel. set(name, p) puts one chart at reveal progress p ∈ [0,1].
const PERFORMER = () => {
  const clamp = (x) => Math.max(0, Math.min(1, x))
  const expoOut = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x))
  const cubicInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
  const section = (title) =>
    [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent?.trim() === title)
  const stagger = (p, i, n, spread) => clamp((p - (i / Math.max(1, n - 1)) * spread) / (1 - spread))

  const performers = {
    hourly(p) {
      const cols = [...section('What Talky did, hour by hour').querySelectorAll('button[aria-pressed]')]
      cols.forEach((col, i) => {
        const l = expoOut(stagger(p, i, cols.length, 0.55))
        col.style.transformOrigin = '50% 100%'
        col.style.transform = `scaleY(${l})`
      })
    },
    heat(p) {
      const cells = [...section('When people message you').querySelectorAll('[role=gridcell]')]
      cells.forEach((cell, k) => {
        if (!cell.dataset.bg) {
          cell.dataset.bg = cell.style.background
          cell.dataset.shadow = cell.style.boxShadow || ''
        }
        const r = Math.floor(k / 24)
        const c = k % 24
        const order = (c + r * 1.5) / (23 + 6 * 1.5)
        const l = cubicInOut(clamp((p - order * 0.6) / 0.4))
        cell.style.background = `color-mix(in oklab, var(--seq-0) ${((1 - l) * 100).toFixed(1)}%, ${cell.dataset.bg})`
        cell.style.boxShadow = l > 0.98 ? cell.dataset.shadow : ''
      })
    },
    words(p) {
      const sec = section('Words per message, day by day')
      const rect = sec.querySelector('clipPath rect')
      rect.setAttribute('width', String(600 * cubicInOut(clamp(p))))
      rect.closest('div.relative').querySelectorAll(':scope > span.rounded-full[aria-hidden]').forEach((dot) => {
        dot.style.opacity = String(clamp((p - 0.92) / 0.08))
      })
      const cursorLine = sec.querySelector('svg > line:last-of-type')
      if (cursorLine) cursorLine.style.opacity = String(clamp((p - 0.92) / 0.08))
    },
    dumbbell(p) {
      const rows = [...section('You vs Talky').querySelectorAll('[role=img]')]
      rows.forEach((row, i) => {
        const l = expoOut(stagger(p, i, rows.length, 0.45))
        const kids = [...row.children]
        const connector = kids[1]
        const dots = kids.slice(2)
        dots.forEach((dot) => {
          if (!dot.dataset.left) dot.dataset.left = dot.style.left
          const final = parseFloat(dot.dataset.left)
          dot.style.left = `${final * l}%`
          dot.style.opacity = String(clamp(l * 4))
        })
        if (connector) connector.style.opacity = String(clamp((l - 0.85) / 0.15))
      })
    },
    lengths(p) {
      const bars = [...section('Message length').querySelectorAll('button span')]
      bars.forEach((bar, i) => {
        const l = expoOut(stagger(p, i, bars.length, 0.5))
        bar.style.transformOrigin = '50% 100%'
        bar.style.transform = `scaleY(${l})`
      })
    },
  }
  window.__promo = {
    set(name, p) {
      performers[name](p)
    },
    box(selectorOrTitle) {
      const el = section(selectorOrTitle) || document.querySelector(selectorOrTitle)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }
    },
  }
}

// ---------------------------------------------------------------- capture steps
async function newPage(browser, fmt, tz, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || fmt.viewport,
    deviceScaleFactor: fmt.dsf,
    colorScheme: opts.colorScheme || 'light',
    timezoneId: tz,
    reducedMotion: 'no-preference',
  })
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'light')
    } catch {}
    const style = document.createElement('style')
    style.textContent = `*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important}
      textarea{caret-color:transparent}`
    document.documentElement.appendChild(style)
  })
  const page = await ctx.newPage()
  return { ctx, page }
}

async function waitReady(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout: 20_000 })
  await page.evaluate(() => document.fonts.ready)
  await sleep(400)
}

const boxOf = async (page, locator) => {
  const b = await locator.boundingBox()
  return { x: b.x, y: b.y, w: b.width, h: b.height }
}
const centerOf = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

/** Plates + chart reveal clips for one page. */
async function capturePerformance(browser, fmt, name, tz, outDir, spec) {
  const { ctx, page } = await newPage(browser, fmt, tz)
  await page.clock.setFixedTime(spec.nowMs)
  await page.goto(`${spec.url}/${spec.route}`)
  await waitReady(page, spec.readyText)
  // Grow the viewport to the whole page so the plate is one continuous screen (sidebar included).
  const fullH = await page.evaluate(() => document.documentElement.scrollHeight)
  await page.setViewportSize({ width: fmt.viewport.width, height: fullH })
  await sleep(500)
  // Park the mouse where it hovers nothing.
  await page.mouse.move(fmt.viewport.width - 4, fullH - 4)
  await page.evaluate(PERFORMER)

  const layout = { pageW: fmt.viewport.width, pageH: fullH, regions: {}, clips: {} }
  for (const [key, sel] of Object.entries(spec.regions)) {
    layout.regions[key] = typeof sel === 'string' ? await page.evaluate((s) => window.__promo.box(s), sel) : await boxOf(page, sel(page))
  }

  // Plate "end" (as the UI really renders) and plate "start" (every performer at 0).
  await page.screenshot({ path: path.join(outDir, `${name}-end.png`) })
  for (const perf of spec.performances) await page.evaluate(([n]) => window.__promo.set(n, 0), [perf.name])
  await sleep(100)
  await page.screenshot({ path: path.join(outDir, `${name}-start.png`) })
  layout.plateStart = `${name}-start.png`
  layout.plateEnd = `${name}-end.png`

  for (const perf of spec.performances) {
    const pad = 6
    const r = await page.evaluate((s) => window.__promo.box(s), perf.region)
    const x0 = Math.max(0, Math.floor(r.x - pad))
    const y0 = Math.max(0, Math.floor(r.y - pad))
    const clip = { x: x0, y: y0, width: Math.ceil(r.x + r.w + pad) - x0, height: Math.ceil(r.y + r.h + pad) - y0 }
    const frameDir = path.join(WORK, `${spec.fmtName}-${perf.name}`)
    rmrf(frameDir)
    mkdirp(frameDir)
    const n = Math.round(perf.seconds * FPS)
    for (let f = 0; f <= n; f += 1) {
      await page.evaluate(([nm, p]) => window.__promo.set(nm, p), [perf.name, f / n])
      await page.screenshot({ path: path.join(frameDir, String(f).padStart(5, '0') + '.png'), clip })
    }
    const file = `${name}-${perf.name}.mp4`
    encodeFrames(frameDir, path.join(outDir, file), perf.hold)
    rmrf(frameDir)
    layout.clips[perf.name] = { file, x: clip.x, y: clip.y, w: clip.width, h: clip.height, seconds: perf.seconds, hold: perf.hold }
    console.log(`  ${spec.fmtName}/${file}`)
  }
  await ctx.close()
  return layout
}

/**
 * Interaction recorder: snapshots of the live page at virtual times. Page timers run on the
 * fake clock (advanced only by us); CSS animations are slowed by CDP so a burst of
 * screenshots samples them finely, then everything is resampled to 60fps.
 */
async function makeRecorder(page, dir, clip) {
  rmrf(dir)
  mkdirp(dir)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Animation.enable')
  const states = []
  let n = 0
  const rec = {
    states,
    async snap(t) {
      const file = path.join(dir, String(n++).padStart(5, '0') + '.png')
      await page.screenshot({ path: file, ...(clip ? { clip } : {}) })
      states.push({ t, file })
    },
    /** Sample `seconds` of UI time starting at t0, with CSS animations at `rate`. */
    async burst(t0, seconds, rate = 0.08) {
      await cdp.send('Animation.setPlaybackRate', { playbackRate: rate })
      const start = Date.now()
      let v = 0
      let lastAdvanced = 0
      while (v < seconds) {
        await rec.snap(t0 + v)
        v = ((Date.now() - start) / 1000) * rate
        const advanceMs = Math.floor(v * 1000) - lastAdvanced
        if (advanceMs > 0) {
          await page.clock.runFor(advanceMs)
          lastAdvanced += advanceMs
        }
      }
      await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 })
    },
  }
  return rec
}

async function settle(page, ms = 250) {
  // Let network + React finish, and fake-clock timers (e.g. mount effects) run.
  await sleep(ms)
  await page.clock.runFor(50)
  await sleep(60)
}

/** Live queue: open Riya's message, type a reply, Send — the item leaves the queue. */
async function captureQueue(browser, fmt, fmtName, tz, outDir, spec) {
  const { ctx, page } = await newPage(browser, fmt, tz)
  await page.clock.install({ time: spec.nowMs })
  await page.goto(`${spec.url}/queue`)
  await page.clock.runFor(300)
  await waitReady(page, 'Live queue')
  await page.clock.runFor(300)
  await page.mouse.move(fmt.viewport.width - 2, fmt.viewport.height - 2)
  await settle(page, 600)
  const rec = await makeRecorder(page, path.join(WORK, `${fmtName}-queue`))
  const cursor = []
  const at = (t, b, click = false) => cursor.push({ t, ...centerOf(b), click })

  const riya = page.locator('button', { hasText: 'are we still on for dinner tonight' }).first()
  const riyaBox = await boxOf(page, riya)
  await rec.snap(0)
  cursor.push({ t: 0, x: fmt.viewport.width + 40, y: fmt.viewport.height * 0.75, click: false })
  // hover → click Riya
  await page.mouse.move(centerOf(riyaBox).x, centerOf(riyaBox).y)
  await settle(page, 120)
  await rec.snap(0.85)
  at(0.85, riyaBox)
  await page.mouse.down()
  await rec.snap(1.0)
  await page.mouse.up()
  await settle(page, 900) // conversation context loads
  await rec.snap(1.08)
  at(1.0, riyaBox, true)

  const box = page.locator('textarea').first()
  await box.waitFor()
  if (fmt.mobile) {
    // Phone layout: the composer sits below the fold — scroll the real page to it (eased, 0.5s).
    const maxY = await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight)
    const steps = Math.round(0.5 * FPS)
    for (let i = 1; i <= steps; i += 1) {
      const k = i / steps
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
      await page.evaluate((y) => window.scrollTo(0, y), Math.round(maxY * e))
      await sleep(10)
      await rec.snap(1.15 + i / FPS)
    }
    await settle(page, 150)
  }
  const boxB = await boxOf(page, box)
  const typeAt = { x: boxB.x + 40, y: boxB.y + boxB.h / 2 }
  cursor.push({ t: 1.75, x: typeAt.x, y: typeAt.y, click: false })
  await page.mouse.move(typeAt.x, typeAt.y)
  await page.mouse.down()
  await page.mouse.up()
  await settle(page, 150)
  await rec.snap(1.8)
  cursor.push({ t: 1.8, x: typeAt.x, y: typeAt.y, click: true })

  // type, one character per 3 frames (~20 chars/s)
  let t = 2.0
  for (const ch of Array.from(REPLY)) {
    await page.keyboard.insertText(ch)
    await sleep(15)
    await rec.snap(t)
    t += 3 / FPS
  }
  const typedEnd = t
  // move the pointer away while typing (it parks just below the text)
  cursor.push({ t: typedEnd - 0.2, x: typeAt.x + 160, y: typeAt.y + 70, click: false })

  const send = page.getByRole('button', { name: /Send/ }).first()
  const sendB = await boxOf(page, send)
  const tHover = typedEnd + 0.55
  await page.mouse.move(centerOf(sendB).x, centerOf(sendB).y)
  await settle(page, 120)
  await rec.snap(tHover)
  at(tHover + 0.05, sendB)
  const tClick = tHover + 0.3
  await page.mouse.down()
  await rec.snap(tClick)
  at(tClick, sendB, true)
  await page.mouse.up()
  await sleep(350) // send + ack round-trip (real network)
  await rec.burst(tClick + 0.06, 1.1)
  // drift the pointer off toward the list
  cursor.push({ t: tClick + 0.9, x: centerOf(sendB).x - 120, y: centerOf(sendB).y + 60, click: false })
  const end = tClick + 3.0
  await rec.snap(tClick + 1.2)
  encodeStates(rec.states, end, path.join(outDir, 'queue.mp4'))
  await ctx.close()
  console.log(`  ${fmtName}/queue.mp4 (${end.toFixed(2)}s)`)
  return { file: 'queue.mp4', w: fmt.viewport.width, h: fmt.viewport.height, seconds: end, cursor, sendAt: tClick, riyaAt: 1.0, typeStart: 2.0, typeEnd: typedEnd }
}

/** Pause replies → banner; then the theme flip (dark still for the iris). */
async function captureControl(browser, fmt, fmtName, tz, outDir, spec) {
  const { ctx, page } = await newPage(browser, fmt, tz)
  await page.clock.install({ time: spec.nowMs })
  await page.goto(`${spec.url}/overview`)
  await page.clock.runFor(300)
  await waitReady(page, 'messages came in')
  await page.clock.runFor(300)
  // The real banner appears instantly; give it a short drop-in so the change reads on screen.
  await page.addStyleTag({
    content: `@keyframes promoDrop{from{clip-path:inset(0 0 100% 0);transform:translateY(-14px);opacity:0}to{clip-path:inset(0 0 0 0);transform:none;opacity:1}}
      [role=status]{animation:promoDrop .5s cubic-bezier(.16,1,.3,1) both}`,
  })
  await page.mouse.move(fmt.viewport.width - 2, fmt.viewport.height - 2)
  await settle(page, 500)
  const rec = await makeRecorder(page, path.join(WORK, `${fmtName}-control`))
  const cursor = []
  const pause = page.getByRole('button', { name: 'Pause replies' }).first()
  const pauseB = await boxOf(page, pause)
  const regions = { pause: pauseB }
  await page.screenshot({ path: path.join(outDir, 'control-light-start.png') })
  await rec.snap(0)
  cursor.push({ t: 0, x: fmt.viewport.width + 40, y: fmt.viewport.height * 0.55, click: false })
  await page.mouse.move(centerOf(pauseB).x, centerOf(pauseB).y)
  await settle(page, 120)
  await rec.snap(0.8)
  cursor.push({ t: 0.85, ...centerOf(pauseB), click: false })
  await page.mouse.down()
  await rec.snap(1.0)
  cursor.push({ t: 1.0, ...centerOf(pauseB), click: true })
  await page.mouse.up()
  await sleep(300)
  await rec.burst(1.06, 0.8)
  await settle(page, 200)
  await rec.snap(1.9)

  // Theme toggle: the sidebar's moon button (desktop) — on the phone layout it lives in the menu,
  // so the tall cut flips by colour flood instead of a click.
  const moon = page.getByRole('button', { name: 'Dark theme' }).first()
  let moonB = null
  if (!fmt.mobile && (await moon.isVisible())) {
    moonB = await boxOf(page, moon)
    regions.moon = moonB
    await page.mouse.move(centerOf(moonB).x, centerOf(moonB).y)
    await settle(page, 120)
    await rec.snap(2.55)
    cursor.push({ t: 2.6, ...centerOf(moonB), click: false })
    await page.mouse.down()
    await rec.snap(2.75)
    cursor.push({ t: 2.75, ...centerOf(moonB), click: true })
  }
  const lightEnd = 4.4
  encodeStates(rec.states, lightEnd, path.join(outDir, 'control.mp4'))
  // Dark still (paused, same page) for the iris/flood.
  if (moonB) {
    await page.mouse.up()
  } else {
    await page.evaluate(() => {
      localStorage.setItem('theme', 'dark')
      document.documentElement.classList.add('dark')
      document.documentElement.style.colorScheme = 'dark'
    })
  }
  await settle(page, 400)
  await page.mouse.move(fmt.viewport.width - 2, fmt.viewport.height - 2)
  await settle(page, 200)
  await page.screenshot({ path: path.join(outDir, 'control-dark.png') })
  await ctx.close()
  console.log(`  ${fmtName}/control.mp4 + control-dark.png`)
  return { file: 'control.mp4', dark: 'control-dark.png', w: fmt.viewport.width, h: fmt.viewport.height, seconds: lightEnd, cursor, regions, pauseAt: 1.0, moonAt: moonB ? 2.75 : null }
}

// ---------------------------------------------------------------- main
async function main() {
  mkdirp(WORK)
  const { child, info } = await startPreviewServer()
  console.log(`preview server ${info.url} tz=${info.tz} dir=${info.dir}`)
  const browser = await chromium.launch()
  try {
    // A fixed "now" for the browser clock, so relative times ("2m ago") stay put during capture.
    const nowMs = Date.now()
    const url = info.url
    for (const [fmtName, fmt] of Object.entries(FORMATS)) {
      if (ONLY.length && !ONLY.includes(fmtName)) continue
      const outDir = path.join(HF, 'assets', fmtName)
      rmrf(outDir)
      mkdirp(outDir)
      const layout = { format: fmtName, viewport: fmt.viewport, dsf: fmt.dsf }
      const common = { url, nowMs, fmtName }
      layout.overview = await capturePerformance(browser, fmt, 'overview', info.tz, outDir, {
        ...common,
        route: 'overview',
        readyText: 'messages came in',
        regions: {
          hourly: 'What Talky did, hour by hour',
          heat: 'When people message you',
          queuePanel: 'Claude queue',
          header: 'header',
          openQueue: (p) => p.getByRole('link', { name: /Open live queue/ }).first(),
        },
        performances: [
          { name: 'hourly', region: 'What Talky did, hour by hour', seconds: 1.5, hold: 12 },
          { name: 'heat', region: 'When people message you', seconds: 1.6, hold: 12 },
        ],
      })
      layout.voice = await capturePerformance(browser, fmt, 'voice', info.tz, outDir, {
        ...common,
        route: 'voice',
        readyText: 'You vs Talky',
        regions: {
          words: 'Words per message, day by day',
          dumbbell: 'You vs Talky',
          lengths: 'Message length',
          header: 'header',
        },
        performances: [
          { name: 'words', region: 'Words per message, day by day', seconds: 1.6, hold: 12 },
          { name: 'dumbbell', region: 'You vs Talky', seconds: 1.3, hold: 12 },
          { name: 'lengths', region: 'Message length', seconds: 1.1, hold: 12 },
        ],
      })
      layout.queue = await captureQueue(browser, fmt, fmtName, info.tz, outDir, common)
      layout.control = await captureControl(browser, fmt, fmtName, info.tz, outDir, common)
      fs.writeFileSync(
        path.join(HF, `layout-${fmtName}.js`),
        `// Generated by promo/scripts/capture.cjs — region boxes in CSS px of the captured page.\nwindow.PROMO_LAYOUT = window.PROMO_LAYOUT || {};\nwindow.PROMO_LAYOUT[${JSON.stringify(fmtName)}] = ${JSON.stringify(layout, null, 2)};\n`,
      )
    }
    // Brand fonts used by the panel (Geist, OFL) for the film's own type.
    const fontsDir = path.join(HF, 'assets', 'fonts')
    mkdirp(fontsDir)
    const distAssets = path.join(REPO, 'web-ui', 'dist', 'assets')
    for (const f of fs.readdirSync(distAssets)) {
      if (/^geist-(mono-)?latin-wght-normal-.*\.woff2$/.test(f)) {
        fs.copyFileSync(path.join(distAssets, f), path.join(fontsDir, f.startsWith('geist-mono') ? 'geist-mono.woff2' : 'geist.woff2'))
      }
    }
  } finally {
    await browser.close()
    child.kill('SIGTERM')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

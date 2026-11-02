#!/usr/bin/env node
/**
 * Renders both cuts with the HyperFrames CLI, then finishes them for delivery.
 *
 *   node promo/scripts/render.cjs            final: 1920×1080 + 1080×1920 @60fps
 *   node promo/scripts/render.cjs --draft    quick low-res preview (960-wide / 540-wide, 30fps)
 *   node promo/scripts/render.cjs wide       one cut only (wide | tall)
 *
 * Output: promo/renders/talky-promo-16x9.mp4, talky-promo-9x16.mp4 (H.264, yuv420p, faststart,
 * silent) and a poster PNG for each. Run `bun run promo:capture` first (it also composes).
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..', '..')
const BUILD = path.join(REPO, 'promo', 'hf', 'build')
const OUT = path.join(REPO, 'promo', 'renders')
const HYPERFRAMES = ['--yes', 'hyperframes@0.9.0']
const args = process.argv.slice(2)
const DRAFT = args.includes('--draft')
const only = args.filter((a) => !a.startsWith('-'))

const CUTS = [
  { fmt: 'wide', name: 'talky-promo-16x9', poster: 7.4, draftScale: '960:540' },
  { fmt: 'tall', name: 'talky-promo-9x16', poster: 7.4, draftScale: '540:960' },
]

const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { stdio: 'inherit', ...opts })

fs.mkdirSync(OUT, { recursive: true })
for (const cut of CUTS) {
  if (only.length && !only.includes(cut.fmt)) continue
  const project = path.join(BUILD, cut.fmt)
  if (!fs.existsSync(path.join(project, 'index.html'))) {
    throw new Error(`missing ${project}/index.html — run: bun run promo:capture`)
  }
  const raw = path.join(OUT, `${cut.name}${DRAFT ? '-draft' : ''}.raw.mp4`)
  const final = path.join(OUT, `${cut.name}${DRAFT ? '-draft' : ''}.mp4`)
  console.log(`\n▶ HyperFrames render: ${cut.fmt} → ${path.relative(REPO, final)}`)
  run('npx', [
    ...HYPERFRAMES,
    'render',
    project,
    '-o',
    raw,
    '--fps',
    DRAFT ? '30' : '60',
    '-q',
    DRAFT ? 'draft' : 'delivery',
    '--video-frame-format',
    'png', // UI footage: avoid JPEG extraction artifacts
    '--strict',
  ])
  // Delivery encode: H.264 High, yuv420p, faststart, no audio track (silent by design).
  const vf = DRAFT ? ['-vf', `scale=${cut.draftScale}:flags=lanczos`] : []
  run('ffmpeg', [
    '-v', 'error', '-y', '-i', raw, ...vf,
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow',
    '-crf', DRAFT ? '26' : '19', '-maxrate', DRAFT ? '3M' : '9M', '-bufsize', DRAFT ? '6M' : '18M',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', final,
  ])
  fs.rmSync(raw, { force: true })
  if (!DRAFT) {
    run('ffmpeg', ['-v', 'error', '-y', '-ss', String(cut.poster), '-i', final, '-frames:v', '1', path.join(OUT, `${cut.name}-poster.png`)])
  }
  const probe = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,r_frame_rate,pix_fmt,nb_frames:format=duration,size',
    '-of', 'default=nw=1', final,
  ]).toString()
  console.log(probe.trim().split('\n').join('  '))
}

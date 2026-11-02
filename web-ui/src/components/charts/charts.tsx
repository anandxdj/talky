/**
 * Small, dependency-free chart kit for the Talky console.
 *
 * Rules (from the dataviz method): thin marks with 4px rounded data-ends, 2px surface gaps
 * between touching fills, 2px lines, recessive hairline grid, text never wears the series
 * colour, a legend for every multi-series chart, and a hover/focus readout on every plot.
 * Colours come from CSS variables in `index.css`, so light/dark are both handled there.
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type Series = { key: string; label: string; color: string }

/* ------------------------------------------------------------------ legend */

export function Legend({
  items,
  shape = 'rect',
  className,
}: {
  items: Array<{ label: string; color: string }>
  shape?: 'rect' | 'line' | 'dot'
  className?: string
}) {
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground', className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              'inline-block shrink-0',
              shape === 'rect' && 'size-2.5 rounded-[3px]',
              shape === 'dot' && 'size-2.5 rounded-full',
              shape === 'line' && 'h-0.5 w-3.5 rounded-full',
            )}
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

/** Readout row shown above a plot; values lead, labels follow. */
export function Readout({ children }: { children: ReactNode }) {
  return (
    <div
      aria-live="polite"
      className="flex min-h-9 flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg bg-muted/70 px-3 py-2 text-[13px]"
    >
      {children}
    </div>
  )
}

export function ReadoutValue({ color, value, label }: { color?: string; value: ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {color ? <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: color }} /> : null}
      <strong className="tnum font-semibold">{value}</strong>
      <span className="text-muted-foreground">{label}</span>
    </span>
  )
}

/* --------------------------------------------------------------- sparkline */

export function Sparkline({
  values,
  width = 104,
  height = 36,
  color = 'var(--series-muted)',
  endColor = 'var(--series-replied)',
  className,
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
  endColor?: string
  className?: string
}) {
  if (values.length < 2) return <svg width={width} height={height} className={className} aria-hidden />
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => [
    4 + (i * (width - 8)) / (values.length - 1),
    height - 4 - ((v - min) / span) * (height - 8),
  ])
  const last = pts[pts.length - 1]!
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <polyline
        points={pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r={4} fill={endColor} stroke="var(--card)" strokeWidth={2} />
    </svg>
  )
}

/* --------------------------------------------------------- stacked columns */

export type ColumnDatum = {
  key: string
  tick: string
  values: Record<string, number>
  aria: string
}

/** Stacked columns with per-column hover/focus; segments stack bottom→top in `series` order. */
export function StackedColumns({
  data,
  series,
  height = 160,
  selected,
  onSelect,
  yTicks = 3,
}: {
  data: ColumnDatum[]
  series: Series[]
  height?: number
  selected: number
  onSelect: (index: number) => void
  yTicks?: number
}) {
  const totals = data.map((d) => series.reduce((sum, s) => sum + (d.values[s.key] ?? 0), 0))
  const rawMax = Math.max(1, ...totals)
  const step = niceStep(rawMax / yTicks)
  const max = step * Math.ceil(rawMax / step)
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step)
  return (
    <div className="flex gap-2">
      <div className="relative w-6 shrink-0 font-mono text-[11px] text-muted-foreground" style={{ height }} aria-hidden>
        {ticks.map((t) => (
          <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: height - (t / max) * height }}>
            {t}
          </span>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="relative" style={{ height }}>
          {ticks.map((t) => (
            <div
              key={t}
              aria-hidden
              className={cn('absolute inset-x-0 h-px', t === 0 ? 'bg-axis' : 'bg-grid')}
              style={{ top: height - (t / max) * height }}
            />
          ))}
          <div className="absolute inset-0 flex items-stretch gap-0.5">
            {data.map((d, i) => {
              const segs = series
                .map((s) => ({ ...s, v: d.values[s.key] ?? 0 }))
                .filter((s) => s.v > 0)
              return (
                <button
                  key={d.key}
                  type="button"
                  aria-label={d.aria}
                  aria-pressed={i === selected}
                  onMouseEnter={() => onSelect(i)}
                  onFocus={() => onSelect(i)}
                  onClick={() => onSelect(i)}
                  className={cn(
                    'flex min-w-0 flex-1 cursor-pointer flex-col-reverse items-center gap-0.5 rounded-t-[4px] outline-offset-2 transition-opacity',
                    i === selected ? 'bg-hover-band opacity-100' : 'opacity-70 hover:opacity-100',
                  )}
                >
                  {segs.map((s, k) => (
                    <span
                      key={s.key}
                      className="block w-full max-w-[22px]"
                      style={{
                        height: Math.max(1, (s.v / max) * height - 2),
                        background: s.color,
                        borderRadius: k === segs.length - 1 ? '4px 4px 0 0' : 0,
                      }}
                    />
                  ))}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex gap-0.5 font-mono text-[11px] text-muted-foreground" aria-hidden>
          {data.map((d) => (
            <span key={d.key} className="min-w-0 flex-1 text-center">
              {d.tick}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function niceStep(raw: number): number {
  if (raw <= 1) return 1
  const pow = 10 ** Math.floor(Math.log10(raw))
  const n = raw / pow
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return nice * pow
}

/* ----------------------------------------------------------------- heatmap */

const SEQ = ['--seq-0', '--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5', '--seq-6', '--seq-7'].map(
  (v) => `var(${v})`,
)

export function Heatmap({
  rows,
  colTicks,
  formatCell,
}: {
  rows: Array<{ label: string; values: number[] }>
  colTicks: string[]
  formatCell: (row: number, col: number, value: number) => string
}) {
  const max = Math.max(1, ...rows.flatMap((r) => r.values))
  const peak = useMemo(() => {
    let best = { r: 0, c: 0, v: -1 }
    rows.forEach((row, r) => row.values.forEach((v, c) => (v > best.v ? (best = { r, c, v }) : null)))
    return best
  }, [rows])
  const [cell, setCell] = useState<{ r: number; c: number } | null>(null)
  const active = cell ?? peak
  const step = (v: number) => (v <= 0 ? 0 : Math.min(7, Math.max(1, Math.ceil((v / max) * 7))))
  const gridRef = useRef<HTMLDivElement>(null)
  // Roving tabindex needs arrow keys, otherwise only one cell is reachable by keyboard.
  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const cols = rows[0]?.values.length ?? 0
    const moves: Record<string, [number, number]> = {
      ArrowRight: [0, 1],
      ArrowLeft: [0, -1],
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
    }
    let next: { r: number; c: number } | null = null
    if (e.key in moves) {
      const [dr, dc] = moves[e.key]!
      next = {
        r: Math.min(rows.length - 1, Math.max(0, active.r + dr)),
        c: Math.min(cols - 1, Math.max(0, active.c + dc)),
      }
    } else if (e.key === 'Home') next = { r: active.r, c: 0 }
    else if (e.key === 'End') next = { r: active.r, c: cols - 1 }
    if (!next) return
    e.preventDefault()
    setCell(next)
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-r="${next.r}"][data-c="${next.c}"]`)
      ?.focus()
  }
  return (
    <div className="flex flex-col gap-3">
      <Readout>
        <span className="font-mono text-muted-foreground">{cell ? 'Selected' : 'Busiest'}</span>
        <strong className="tnum">
          {formatCell(active.r, active.c, rows[active.r]?.values[active.c] ?? 0)}
        </strong>
      </Readout>
      <div className="overflow-x-auto">
        <div
          ref={gridRef}
          className="flex min-w-[560px] flex-col gap-0.5"
          role="grid"
          aria-label="Messages by weekday and hour"
          onKeyDown={onGridKeyDown}
        >
          {rows.map((row, r) => (
            <div key={row.label} className="flex items-center gap-0.5" role="row">
              <span className="w-9 shrink-0 font-mono text-[11px] text-muted-foreground" role="rowheader">
                {row.label}
              </span>
              {row.values.map((v, c) => {
                const on = active.r === r && active.c === c
                return (
                  <span
                    key={c}
                    role="gridcell"
                    data-r={r}
                    data-c={c}
                    tabIndex={on ? 0 : -1}
                    aria-label={formatCell(r, c, v)}
                    onMouseEnter={() => setCell({ r, c })}
                    onFocus={() => setCell({ r, c })}
                    className="h-5 flex-1 rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{
                      background: SEQ[step(v)],
                      boxShadow: on ? 'inset 0 0 0 2px var(--foreground)' : undefined,
                    }}
                  />
                )
              })}
            </div>
          ))}
          <div className="flex gap-0.5 pl-9.5 font-mono text-[11px] text-muted-foreground" aria-hidden>
            {colTicks.map((t, i) => (
              <span key={i} className="flex-1 text-center">
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span>Fewer</span>
        {SEQ.slice(1).map((c) => (
          <span key={c} aria-hidden className="h-2.5 w-4 rounded-[2px]" style={{ background: c }} />
        ))}
        <span>More</span>
      </div>
    </div>
  )
}

/* ----------------------------------------------------- segment bar + meter */

export function SegmentBar({
  parts,
  height = 8,
  label,
  className,
}: {
  parts: Array<{ value: number; color: string; label: string }>
  height?: number
  label: string
  className?: string
}) {
  const shown = parts.filter((p) => p.value > 0)
  return (
    <span role="img" aria-label={label} className={cn('flex gap-0.5', className)} style={{ height }}>
      {shown.length === 0 ? (
        <span className="flex-1 rounded-[2px] bg-muted" />
      ) : (
        shown.map((p) => (
          <span key={p.label} className="rounded-[2px]" style={{ flex: p.value, background: p.color }} />
        ))
      )}
    </span>
  )
}

export function Meter({ value, max = 100, label, className }: { value: number; max?: number; label: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn('flex h-1.5 rounded-full', className)}
      style={{ background: 'var(--meter-track)' }}
    >
      <span className="rounded-full" style={{ width: `${pct}%`, background: 'var(--meter-fill)' }} />
    </span>
  )
}

/* -------------------------------------------------------------- line chart */

export function LineChart({
  series,
  xLabels,
  height = 200,
  formatValue = (v) => String(v),
  ticks,
}: {
  series: Array<Series & { values: Array<number | null> }>
  xLabels: string[]
  height?: number
  formatValue?: (v: number) => string
  ticks?: string[]
}) {
  const clipId = useId()
  const n = xLabels.length
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null))
  const max = Math.max(1, ...all) * 1.1
  const [sel, setSel] = useState<number | null>(null)
  const lastWithData = useMemo(() => {
    for (let i = n - 1; i >= 0; i--) if (series.some((s) => s.values[i] !== null)) return i
    return n - 1
  }, [series, n])
  const at = sel ?? lastWithData
  const W = 600
  const x = (i: number) => (n <= 1 ? 0 : (i * W) / (n - 1))
  const y = (v: number) => height - (v / max) * height
  const path = (values: Array<number | null>) => {
    let d = ''
    let pen = false
    values.forEach((v, i) => {
      if (v === null) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `
      pen = true
    })
    return d.trim()
  }
  return (
    <div className="flex flex-col gap-3">
      <Readout>
        <span className="font-mono text-muted-foreground">{xLabels[at]}</span>
        {series.map((s) => (
          <ReadoutValue
            key={s.key}
            color={s.color}
            value={s.values[at] === null || s.values[at] === undefined ? '—' : formatValue(s.values[at]!)}
            label={s.label}
          />
        ))}
      </Readout>
      <div className="relative ml-9" style={{ height }}>
        <svg
          viewBox={`0 0 ${W} ${height}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          role="img"
          aria-label={`${series.map((s) => s.label).join(' and ')} over ${n} days`}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x="0" y="0" width={W} height={height} />
            </clipPath>
          </defs>
          {[0, 0.5, 1].map((f) => (
            <line
              key={f}
              x1={0}
              x2={W}
              y1={height * f}
              y2={height * f}
              stroke={f === 1 ? 'var(--axis)' : 'var(--grid)'}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            x1={x(at)}
            x2={x(at)}
            y1={0}
            y2={height}
            stroke="var(--foreground)"
            strokeOpacity={0.5}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {series.map((s) => (
            <path
              key={s.key}
              d={path(s.values)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              clipPath={`url(#${clipId})`}
            />
          ))}
        </svg>
        {series.map((s) =>
          s.values[at] !== null && s.values[at] !== undefined ? (
            <span
              key={s.key}
              aria-hidden
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: `${(x(at) / W) * 100}%`,
                top: y(s.values[at]!),
                background: s.color,
                boxShadow: '0 0 0 2px var(--card)',
              }}
            />
          ) : null,
        )}
        <div className="absolute inset-0 flex">
          {xLabels.map((label, i) => (
            <span
              key={label + i}
              className="h-full flex-1"
              onMouseEnter={() => setSel(i)}
              onMouseLeave={() => setSel(null)}
            />
          ))}
        </div>
        {[1, 0.5, 0].map((f) => (
          <span
            key={f}
            aria-hidden
            className="absolute -left-2 -translate-x-full -translate-y-1/2 font-mono text-[11px] text-muted-foreground"
            style={{ top: height * (1 - f) }}
          >
            {formatValue(max * f)}
          </span>
        ))}
      </div>
      {ticks ? (
        <div className="ml-9 flex justify-between font-mono text-[11px] text-muted-foreground" aria-hidden>
          {ticks.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------ grouped bars */

export function GroupedBars({
  groups,
  series,
  height = 150,
  unit = '%',
}: {
  groups: Array<{ label: string; values: Record<string, number> }>
  series: Series[]
  height?: number
  unit?: string
}) {
  const max = Math.max(10, ...groups.flatMap((g) => series.map((s) => g.values[s.key] ?? 0)))
  const top = Math.ceil(max / 10) * 10
  const [sel, setSel] = useState(0)
  const g = groups[sel]
  return (
    <div className="flex flex-col gap-3">
      <Readout>
        <span className="font-mono text-muted-foreground">{g?.label} words</span>
        {series.map((s) => (
          <ReadoutValue key={s.key} color={s.color} value={`${g?.values[s.key] ?? 0}${unit}`} label={s.label} />
        ))}
      </Readout>
      <div className="flex gap-2">
        <div className="relative w-8 shrink-0 font-mono text-[11px] text-muted-foreground" style={{ height }} aria-hidden>
          <span className="absolute right-0 -translate-y-1/2" style={{ top: 0 }}>
            {top}
            {unit}
          </span>
          <span className="absolute right-0 -translate-y-1/2" style={{ top: height / 2 }}>
            {top / 2}
            {unit}
          </span>
          <span className="absolute right-0 -translate-y-1/2" style={{ top: height }}>
            0
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="relative flex items-end gap-1.5 border-b border-axis" style={{ height }}>
            <div aria-hidden className="absolute inset-x-0 h-px bg-grid" style={{ top: 0 }} />
            <div aria-hidden className="absolute inset-x-0 h-px bg-grid" style={{ top: height / 2 }} />
            {groups.map((grp, i) => (
              <button
                key={grp.label}
                type="button"
                aria-label={`${grp.label} words: ${series.map((s) => `${s.label} ${grp.values[s.key] ?? 0}${unit}`).join(', ')}`}
                onMouseEnter={() => setSel(i)}
                onFocus={() => setSel(i)}
                onClick={() => setSel(i)}
                className={cn(
                  'relative flex h-full flex-1 cursor-pointer items-end justify-center gap-0.5 rounded-t-[4px]',
                  i === sel && 'bg-hover-band',
                )}
              >
                {series.map((s) => (
                  <span
                    key={s.key}
                    className="w-full max-w-[22px] rounded-t-[4px]"
                    style={{ height: ((grp.values[s.key] ?? 0) / top) * height, background: s.color }}
                  />
                ))}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5 font-mono text-[11px] text-muted-foreground" aria-hidden>
            {groups.map((grp) => (
              <span key={grp.label} className="flex-1 text-center">
                {grp.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- dumbbell */

export function DumbbellRow({
  label,
  a,
  b,
  max,
  format,
  colors,
  note,
}: {
  label: string
  a: number
  b: number
  max: number
  format: (v: number) => string
  colors: [string, string]
  note?: ReactNode
}) {
  const pa = Math.min(100, (a / max) * 100)
  const pb = Math.min(100, (b / max) * 100)
  return (
    <div className="flex flex-col gap-2 border-b pb-3 last:border-b-0 last:pb-0">
      <div className="flex items-baseline gap-2 text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {format(a)} → {format(b)}
        </span>
      </div>
      <div className="relative h-3.5" role="img" aria-label={`${label}: you ${format(a)}, Talky ${format(b)}`}>
        <div className="absolute inset-x-0 top-1.5 h-0.5 rounded bg-grid" />
        <div
          className="absolute top-1.5 h-0.5 rounded"
          style={{ left: `${Math.min(pa, pb)}%`, width: `${Math.abs(pa - pb)}%`, background: 'var(--series-muted)' }}
        />
        {[
          { p: pa, c: colors[0] },
          { p: pb, c: colors[1] },
        ].map((dot, i) => (
          <span
            key={i}
            className="absolute top-0 size-3.5 -translate-x-1/2 rounded-full"
            style={{ left: `${dot.p}%`, background: dot.c, boxShadow: '0 0 0 2px var(--card)' }}
          />
        ))}
      </div>
      {note}
    </div>
  )
}

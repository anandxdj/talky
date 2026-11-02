import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import {
  Heatmap,
  Legend,
  Meter,
  Readout,
  ReadoutValue,
  SegmentBar,
  Sparkline,
  StackedColumns,
  type Series,
} from '@/components/charts/charts'
import { EmptyState, PageHeader, Panel } from '@/components/talky/Page'
import { PauseRepliesButton } from '@/components/talky/PauseReplies'
import { Skeleton } from '@/components/ui/skeleton'
import { useTalkyConsole } from '@/context/TalkyConsoleContext'
import { formatDuration, initialOf, maskedJid, pad2, percent, relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { OverviewStats } from '@/types/api'

const OUTCOMES: Series[] = [
  { key: 'replied', label: 'Replied', color: 'var(--series-replied)' },
  { key: 'claude', label: 'Handed to Claude', color: 'var(--series-claude)' },
  { key: 'silent', label: 'Stayed silent', color: 'var(--series-silent)' },
]
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type EngineMode = 'gemini' | 'claude' | 'both'

function EngineSwitch() {
  const { claudeStatus, updateConfig } = useTalkyConsole()
  const [busy, setBusy] = useState(false)
  const mode: EngineMode = !claudeStatus?.mediatorEnabled
    ? 'gemini'
    : claudeStatus.mediatorExclusive
      ? 'claude'
      : 'both'
  const options: Array<{ value: EngineMode; label: string; hint: string }> = [
    { value: 'gemini', label: 'Gemini', hint: 'Talky replies on its own' },
    { value: 'claude', label: 'Claude', hint: 'Every allowed message goes to the Claude queue' },
    { value: 'both', label: 'Both', hint: 'Gemini replies and Claude also sees the queue' },
  ]
  const choose = async (next: EngineMode) => {
    if (next === mode || busy) return
    setBusy(true)
    await updateConfig({
      claudeMediatorEnabled: next !== 'gemini',
      claudeMediatorExclusive: next === 'claude',
    })
    setBusy(false)
  }
  return (
    <div role="radiogroup" aria-label="Reply engine" className="flex gap-0.5 rounded-[10px] bg-muted p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={mode === o.value}
          title={o.hint}
          disabled={busy || !claudeStatus}
          onClick={() => void choose(o.value)}
          className={cn(
            'min-h-9 rounded-lg px-3.5 text-[13px] transition-colors disabled:opacity-60',
            mode === o.value
              ? 'bg-card font-semibold text-foreground shadow-xs'
              : 'font-medium text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function delta(current: number, previous: number, unit: string, lowerIsBetter = false) {
  const diff = current - previous
  if (diff === 0) return { text: `same as last week`, good: true }
  const better = lowerIsBetter ? diff < 0 : diff > 0
  return { text: `${diff > 0 ? '+' : '−'}${Math.abs(diff)}${unit} vs last week`, good: better }
}

function StatTile({
  label,
  value,
  note,
  noteGood,
  spark,
  accent,
}: {
  label: string
  value: string
  note: string
  noteGood?: boolean
  spark: number[]
  accent: string
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border bg-card p-4">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="tnum text-[30px] leading-none font-semibold tracking-[-0.03em]">{value}</span>
          <span
            className={cn(
              'text-xs font-medium',
              noteGood === undefined ? 'text-muted-foreground' : noteGood ? 'text-ink-good' : 'text-ink-bad',
            )}
          >
            {note}
          </span>
        </div>
        <Sparkline values={spark} endColor={accent} className="ml-auto shrink-0" />
      </div>
    </div>
  )
}

function KeyFigures({ stats }: { stats: OverviewStats }) {
  const week = stats.daily.slice(-7)
  const today = stats.daily.at(-1)!
  const lastWeek = stats.daily.at(-8)
  const silenceRate = (d: { replied: number; claude: number; silent: number }) =>
    percent(d.silent, d.replied + d.claude + d.silent)
  const median = stats.today.medianReplySeconds
  const lastMedian = lastWeek?.medianReplySeconds ?? null
  const remaining = Math.max(0, stats.today.dailyLimit - stats.today.sentByTalky)
  return (
    <section aria-label="Key figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label="Messages sent by Talky"
        value={String(stats.today.sentByTalky)}
        note={`${remaining} left of the ${stats.today.dailyLimit}/day cap`}
        spark={week.map((d) => d.replied)}
        accent="var(--series-replied)"
      />
      <StatTile
        label="Handed to Claude"
        value={String(stats.today.claude)}
        note={stats.claude.pending > 0 ? `${stats.claude.pending} still waiting` : 'queue is clear'}
        noteGood={stats.claude.pending === 0}
        spark={week.map((d) => d.claude)}
        accent="var(--series-claude)"
      />
      <StatTile
        label="Median reply time"
        value={formatDuration(median)}
        note={
          median !== null && lastMedian !== null
            ? delta(Math.round(median), Math.round(lastMedian), 's', true).text
            : 'no replies to compare yet'
        }
        noteGood={median !== null && lastMedian !== null ? median <= lastMedian : undefined}
        spark={week.map((d) => d.medianReplySeconds ?? 0)}
        accent="var(--series-replied)"
      />
      <StatTile
        label="Silence rate"
        value={`${silenceRate(today)}%`}
        note={`${stats.today.silent} of ${stats.today.reachedEngine} decisions today`}
        spark={week.map(silenceRate)}
        accent="var(--series-replied)"
      />
    </section>
  )
}

function HourlyPanel({ stats }: { stats: OverviewStats }) {
  const [sel, setSel] = useState(() => new Date().getHours())
  const data = stats.hourly.map((h) => ({
    key: String(h.hour),
    tick: h.hour % 3 === 0 ? pad2(h.hour) : '',
    values: { replied: h.replied, claude: h.claude, silent: h.silent },
    aria: `${pad2(h.hour)}:00 — ${h.replied} replied, ${h.claude} to Claude, ${h.silent} silent, ${h.received} received`,
  }))
  const h = stats.hourly[sel]!
  return (
    <Panel
      id="hourly"
      title="What Talky did, hour by hour"
      description="Messages that reached the reply engine today, by outcome"
      actions={<Legend items={OUTCOMES} />}
      className="flex-[999_1_560px]"
    >
      <Readout>
        <span className="font-mono text-muted-foreground">
          {pad2(sel)}:00–{pad2((sel + 1) % 24)}:00
        </span>
        <ReadoutValue color="var(--series-replied)" value={h.replied} label="replied" />
        <ReadoutValue color="var(--series-claude)" value={h.claude} label="to Claude" />
        <ReadoutValue color="var(--series-muted)" value={h.silent} label="silent" />
        <ReadoutValue value={h.received} label="received" />
      </Readout>
      <StackedColumns data={data} series={OUTCOMES} selected={sel} onSelect={setSel} />
    </Panel>
  )
}

function PipelinePanel({ stats, unknownSenders }: { stats: OverviewStats; unknownSenders: number }) {
  const answered = stats.today.replied + stats.today.claude
  const steps = [
    { label: 'Received', v: stats.today.received, note: 'recorded inbound messages', color: 'var(--seq-2)' },
    { label: 'Reached the engine', v: stats.today.reachedEngine, note: 'allowed, not muted', color: 'var(--seq-4)' },
    {
      label: 'Answered',
      v: answered,
      note: `${stats.today.replied} Talky · ${stats.today.claude} Claude`,
      color: 'var(--seq-6)',
    },
  ]
  const max = Math.max(1, ...steps.map((s) => s.v))
  return (
    <Panel
      id="pipeline"
      title="Message pipeline"
      description="Where today's messages stopped"
      className="flex-[1_1_300px]"
    >
      {steps.map((s) => (
        <div key={s.label} className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2 text-[13px]">
            <span className="font-medium">{s.label}</span>
            <span className="ml-auto text-xs text-muted-foreground">{s.note}</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="h-[22px] rounded-r-[4px]"
              style={{ width: `${Math.max(3, (s.v / max) * 82)}%`, background: s.color }}
            />
            <span className="tnum font-mono text-[13px] font-semibold">{s.v}</span>
          </div>
        </div>
      ))}
      <p className="mt-auto border-t pt-3 text-[13px] text-muted-foreground">
        {unknownSenders > 0 ? (
          <>
            {unknownSenders} unknown sender{unknownSenders === 1 ? '' : 's'} waiting.{' '}
            <Link to="/queue?tab=unknown" className="font-medium text-foreground underline underline-offset-4">
              Review
            </Link>
          </>
        ) : (
          'No unknown senders waiting for review.'
        )}
      </p>
    </Panel>
  )
}

function QueuePanel() {
  const { claudePending } = useTalkyConsole()
  return (
    <Panel
      id="queue-card"
      tone="ink"
      title="Claude queue"
      actions={<span className="font-mono text-xs text-[#c3c2b7]">pending.jsonl</span>}
      className="flex-[1_1_300px]"
    >
      {claudePending.length === 0 ? (
        <p className="rounded-lg bg-[#222221] p-3 text-[13px] text-[#c3c2b7]">
          Nothing waiting. New messages appear here when the Claude engine is on.
        </p>
      ) : (
        claudePending.slice(0, 3).map((e) => (
          <Link
            key={e.id}
            to={`/queue?event=${encodeURIComponent(e.id)}`}
            className="flex flex-col gap-1 rounded-lg bg-[#222221] p-3 text-[#f0efec] hover:bg-[#2a2a28]"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <span className="truncate">{e.chatName || e.senderName || maskedJid(e.chatJid)}</span>
              <span className="ml-auto shrink-0 font-mono text-xs font-normal text-[#c3c2b7]">
                {relativeTime(e.timestampISO)}
              </span>
            </span>
            <span className="truncate text-[13px] text-[#c3c2b7]">{e.text || e.media?.fileName || '[media]'}</span>
          </Link>
        ))
      )}
      <Link
        to="/queue"
        className="mt-auto flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-series-claude text-sm font-semibold text-[#141413]"
      >
        Open live queue <ArrowRight className="size-4" aria-hidden />
      </Link>
    </Panel>
  )
}

function ChatsTable({ stats }: { stats: OverviewStats }) {
  const { groups } = useTalkyConsole()
  const names = useMemo(() => new Map(groups.map((g) => [g.jid, g.name])), [groups])
  return (
    <Panel
      id="who"
      title="Who Talky talks to"
      description="Most active chats · last 7 days"
      actions={
        <Link to="/conversations" className="text-[13px] font-medium underline-offset-4 hover:underline">
          All conversations
        </Link>
      }
      bodyClassName="-mx-4 md:-mx-5"
    >
      {stats.chats.length === 0 ? (
        <div className="px-4 md:px-5">
          <EmptyState>No conversations recorded in the last 7 days.</EmptyState>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-medium md:px-5">Chat</th>
                <th scope="col" className="px-3 py-2 font-medium">Inbound, 7 days</th>
                <th scope="col" className="px-3 py-2 font-medium">Handled by</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Median reply</th>
                <th scope="col" className="px-4 py-2 font-medium md:px-5">Reply share</th>
              </tr>
            </thead>
            <tbody>
              {stats.chats.map((c) => {
                const name = c.name || names.get(c.jid) || maskedJid(c.jid)
                const o = c.outcomes7d
                const handled = o.replied + o.claude
                const share = percent(handled, handled + o.silent)
                return (
                  <tr key={c.jid} className="border-t">
                    <td className="px-4 py-2.5 md:px-5">
                      <Link
                        to={`/conversations?jid=${encodeURIComponent(c.jid)}`}
                        className="flex items-center gap-2.5 hover:underline"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'flex size-8 shrink-0 items-center justify-center bg-muted text-[13px] font-semibold',
                            c.isGroup ? 'rounded-lg' : 'rounded-full',
                          )}
                        >
                          {initialOf(name)}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{name}</span>
                          <span className="text-xs text-muted-foreground">
                            {c.isGroup ? 'Group' : 'Direct'} · {relativeTime(c.lastAtISO)}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2.5">
                        <Sparkline
                          values={c.daily7d}
                          width={88}
                          height={24}
                          color="var(--series-replied)"
                          endColor="var(--series-replied)"
                        />
                        <span className="tnum font-mono text-[13px]">{c.received7d}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <SegmentBar
                        className="w-[120px]"
                        label={`${o.replied} replied, ${o.claude} to Claude, ${o.silent} silent`}
                        parts={[
                          { value: o.replied, color: 'var(--series-replied)', label: 'replied' },
                          { value: o.claude, color: 'var(--series-claude)', label: 'claude' },
                          { value: o.silent, color: 'var(--series-silent)', label: 'silent' },
                        ]}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[13px]">
                      {formatDuration(c.medianReplySeconds)}
                    </td>
                    <td className="px-4 py-2.5 md:px-5">
                      <span className="flex items-center gap-2.5">
                        <Meter value={share} label={`Reply share ${share}%`} className="w-24" />
                        <span className="tnum font-mono text-[13px]">{share}%</span>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="px-4 md:px-5">
        <Legend
          items={OUTCOMES.map((s) => ({ label: s.label, color: s.color }))}
          className="text-xs"
        />
      </div>
    </Panel>
  )
}

export function OverviewPage() {
  const { stats, unauthorized, offline } = useTalkyConsole()

  if (!stats) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-16 w-full max-w-2xl" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
        {offline ? (
          <EmptyState>
            Can't reach the Talky API. Start the bot with <code className="font-mono">bun run start</code>.
          </EmptyState>
        ) : null}
      </div>
    )
  }

  const t = stats.today
  const dateLine = new Date(stats.generatedAtISO).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  })

  return (
    <>
      <PageHeader
        eyebrow={`${dateLine} · today so far`}
        title={
          <>
            {t.received} message{t.received === 1 ? '' : 's'} came in. {t.reachedEngine} needed a call.
            <br />
            <span className="text-muted-foreground">
              Talky answered {t.replied}, Claude took {t.claude}, silence on {t.silent}.
            </span>
          </>
        }
        actions={
          <>
            <EngineSwitch />
            <PauseRepliesButton />
          </>
        }
      />

      <KeyFigures stats={stats} />

      <div className="flex flex-wrap gap-3">
        <HourlyPanel stats={stats} />
        <PipelinePanel stats={stats} unknownSenders={unauthorized.length} />
      </div>

      <div className="flex flex-wrap gap-3">
        <Panel
          id="heat"
          title="When people message you"
          description="Inbound messages · last 7 days · hover a cell"
          className="flex-[999_1_560px]"
        >
          <Heatmap
            rows={WEEKDAYS.map((label, i) => ({ label, values: stats.heatmap[i] ?? [] }))}
            colTicks={Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? pad2(h) : ''))}
            formatCell={(r, c, v) => `${WEEKDAYS[r]} ${pad2(c)}:00 · ${v} message${v === 1 ? '' : 's'}`}
          />
        </Panel>
        <QueuePanel />
      </div>

      <ChatsTable stats={stats} />
    </>
  )
}

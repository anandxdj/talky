import { TriangleAlert } from 'lucide-react'
import { DumbbellRow, GroupedBars, Legend, LineChart, type Series } from '@/components/charts/charts'
import { EmptyState, PageHeader, Panel } from '@/components/talky/Page'
import { Skeleton } from '@/components/ui/skeleton'
import { useTalkyConsole } from '@/context/TalkyConsoleContext'
import { PersonaPage } from '@/pages/PersonaPage'
import type { OverviewStats, VoiceTraits } from '@/types/api'

const WHO: Series[] = [
  { key: 'you', label: 'You', color: 'var(--series-replied)' },
  { key: 'talky', label: 'Talky', color: 'var(--series-claude)' },
]

/** A trait drifts when Talky is more than 25% away from you (and the gap is meaningful). */
function drift(you: number, talky: number, minGap: number): number | null {
  if (you <= 0 && talky <= 0) return null
  const gap = Math.abs(talky - you)
  if (gap < minGap) return null
  const rel = you > 0 ? gap / you : 1
  return rel > 0.25 ? Math.round(((talky - you) / Math.max(you, 0.01)) * 100) : null
}

function headline(you: VoiceTraits, talky: VoiceTraits): { title: string; sub: string } {
  if (you.messages < 5 || talky.messages < 5) {
    return {
      title: 'Not enough messages to compare voices yet.',
      sub: 'Turn on recordManualOutboundMessages (Access rules) so messages you type on your phone are logged, and give it a few days.',
    }
  }
  const issues: string[] = []
  const words = drift(you.wordsPerMessage, talky.wordsPerMessage, 1)
  if (words !== null) issues.push(words > 0 ? 'writes longer than you' : 'writes shorter than you')
  const emoji = drift(you.emojiPer10, talky.emojiPer10, 0.5)
  if (emoji !== null) issues.push(emoji > 0 ? 'uses more emoji' : 'uses fewer emoji')
  const burst = drift(you.messagesPerBurst, talky.messagesPerBurst, 0.4)
  if (burst !== null) issues.push(burst > 0 ? 'splits into more messages' : 'sends fewer, longer bursts')
  const lower = Math.abs(you.lowercaseShare - talky.lowercaseShare) > 15
  if (lower) issues.push(talky.lowercaseShare > you.lowercaseShare ? 'starts lowercase more often' : 'capitalises more than you')
  if (issues.length === 0) {
    return { title: 'Talky writes like you.', sub: 'Length, emoji, bursts and casing are all within 25% of your own messages.' }
  }
  return {
    title: `Talky ${issues.slice(0, 2).join(' and ')}.`,
    sub: 'Compare the traits below, then tighten the rules in communication_rules.md.',
  }
}

function Fingerprint({ stats }: { stats: OverviewStats }) {
  const { you, talky, lengthBuckets, wordsTrend, windowDays } = stats.voice
  const h = headline(you, talky)
  const fmtDay = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const tickIdx = [0, Math.floor(windowDays / 3), Math.floor((2 * windowDays) / 3), windowDays - 1]
  const flag = (pct: number | null, text: (p: number) => string) =>
    pct === null ? undefined : (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <TriangleAlert className="size-3.5 shrink-0" style={{ color: 'var(--status-warning)' }} aria-label="Warning" />
        {text(pct)}
      </span>
    )
  const traits = [
    {
      label: 'Words per message',
      a: you.wordsPerMessage,
      b: talky.wordsPerMessage,
      max: Math.max(12, you.wordsPerMessage, talky.wordsPerMessage) * 1.1,
      fmt: (v: number) => v.toFixed(1),
      note: flag(drift(you.wordsPerMessage, talky.wordsPerMessage, 1), (p) => `Talky writes ${Math.abs(p)}% ${p > 0 ? 'longer' : 'shorter'}`),
    },
    {
      label: 'Messages per burst',
      a: you.messagesPerBurst,
      b: talky.messagesPerBurst,
      max: Math.max(4, you.messagesPerBurst, talky.messagesPerBurst) * 1.1,
      fmt: (v: number) => v.toFixed(1),
      note: flag(drift(you.messagesPerBurst, talky.messagesPerBurst, 0.4), (p) => `${Math.abs(p)}% ${p > 0 ? 'more' : 'fewer'} messages per burst`),
    },
    {
      label: 'Emoji per 10 messages',
      a: you.emojiPer10,
      b: talky.emojiPer10,
      max: Math.max(2, you.emojiPer10, talky.emojiPer10) * 1.1,
      fmt: (v: number) => v.toFixed(1),
      note: flag(drift(you.emojiPer10, talky.emojiPer10, 0.5), (p) => `${p > 0 ? 'More' : 'Fewer'} emoji than you (${Math.abs(p)}%)`),
    },
    {
      label: 'Lowercase starts',
      a: you.lowercaseShare,
      b: talky.lowercaseShare,
      max: 100,
      fmt: (v: number) => `${v}%`,
      note:
        Math.abs(you.lowercaseShare - talky.lowercaseShare) > 15
          ? flag(talky.lowercaseShare - you.lowercaseShare, (p) => `${Math.abs(p)} points ${p > 0 ? 'more' : 'less'} lowercase`)
          : undefined,
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow={`Voice fingerprint · last ${windowDays} days · ${you.messages} of yours vs ${talky.messages} by Talky`}
        title={h.title}
        subtitle={h.sub}
      />

      <div className="flex flex-wrap gap-3">
        <Panel
          id="trend"
          title="Words per message, day by day"
          description="Messages you typed on your phone vs messages Talky sent"
          actions={<Legend items={WHO} shape="line" />}
          className="flex-[999_1_520px]"
        >
          <LineChart
            series={WHO.map((s) => ({ ...s, values: wordsTrend.map((d) => d[s.key as 'you' | 'talky']) }))}
            xLabels={wordsTrend.map((d) => fmtDay(d.dateISO))}
            formatValue={(v) => v.toFixed(1)}
            ticks={tickIdx.map((i) => fmtDay(wordsTrend[i]!.dateISO))}
          />
        </Panel>
        <Panel
          id="traits"
          title="You vs Talky"
          actions={<Legend items={WHO} shape="dot" />}
          className="flex-[1_1_320px]"
        >
          {traits.map((t) => (
            <DumbbellRow
              key={t.label}
              label={t.label}
              a={t.a}
              b={t.b}
              max={t.max}
              format={t.fmt}
              colors={['var(--series-replied)', 'var(--series-claude)']}
              note={t.note}
            />
          ))}
        </Panel>
      </div>

      <Panel
        id="length"
        title="Message length"
        description="Share of messages by word count"
        actions={<Legend items={WHO} />}
      >
        <GroupedBars
          groups={lengthBuckets.map((b) => ({ label: b.label, values: { you: b.you, talky: b.talky } }))}
          series={WHO}
        />
      </Panel>
    </>
  )
}

export function VoicePage() {
  const { stats, offline } = useTalkyConsole()
  return (
    <>
      {stats ? (
        <Fingerprint stats={stats} />
      ) : offline ? (
        <EmptyState>Voice stats need the bot running (bun run start).</EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full max-w-2xl" />
          <Skeleton className="h-72 w-full" />
        </div>
      )}
      <div className="mt-4 border-t pt-8">
        <PersonaPage />
      </div>
    </>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, FileText, Mic, Send, UserCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, PageHeader } from '@/components/talky/Page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useTalkyConsole } from '@/context/TalkyConsoleContext'
import { useIsMobile } from '@/hooks/use-mobile'
import { useRepliesPause } from '@/hooks/use-replies-pause'
import { apiJson } from '@/lib/api'
import { initialOf, maskedJid, relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ChatEntry, ClaudeEvent } from '@/types/api'

/** Response target: an event older than this is shown as overdue. */
const TARGET_MINUTES = 15

type ContextPayload = {
  jid: string
  isGroup: boolean
  persona: { contactProfile?: string; groupProfile?: string; communicationRules?: string }
  history: ChatEntry[]
  memories: Array<{ fact: string; confidence: number; source: string }>
  ownerMemories: Array<{ fact: string; confidence: number; source: string }>
}

/** Server limit for one mediated send (MEDIATED_SEND_MAX_PARTS in src/reply/parse.ts). */
const MAX_PARTS = 5

function chatTitle(e: ClaudeEvent): string {
  return e.chatName || e.senderName || maskedJid(e.chatJid)
}

function ageMinutes(iso: string): number {
  return Math.max(0, (Date.now() - Date.parse(iso)) / 60_000)
}

function QueueItem({
  event,
  waitingSinceISO,
  count,
  active,
  onSelect,
}: {
  event: ClaudeEvent
  /** Oldest unanswered event in the thread — the response target runs from here, not the newest. */
  waitingSinceISO: string
  count: number
  active: boolean
  onSelect: () => void
}) {
  const age = ageMinutes(waitingSinceISO)
  const late = age >= TARGET_MINUTES
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full flex-col gap-2 border-b px-4 py-3.5 text-left transition-colors',
        active ? 'bg-hover-band' : 'hover:bg-muted/60',
      )}
    >
      <span className="flex w-full items-center gap-2">
        <span className="truncate text-sm font-semibold">{chatTitle(event)}</span>
        <span className="shrink-0 rounded bg-muted px-1.5 font-mono text-[11px] text-muted-foreground">
          {event.isGroup ? (event.mentionedMe ? '@YOU' : 'GROUP') : 'DM'}
        </span>
        {count > 1 ? (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">×{count}</span>
        ) : null}
        <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{relativeTime(event.timestampISO)}</span>
      </span>
      <span className="line-clamp-2 text-[13px] leading-snug text-foreground/80">
        {event.voiceTranscript ? <Mic className="mr-1 inline size-3.5 align-[-2px]" aria-label="Voice note" /> : null}
        {event.text || event.media?.fileName || `[${event.media?.kind ?? 'media'}]`}
      </span>
      <span className="flex w-full items-center gap-2">
        <span className="flex h-1 flex-1 rounded-full bg-muted">
          <span
            className="rounded-full"
            style={{
              width: `${Math.min(100, (age / TARGET_MINUTES) * 100)}%`,
              background: late ? 'var(--status-critical)' : 'var(--series-muted)',
            }}
          />
        </span>
        <span className="text-[11px] text-muted-foreground">
          {late ? `over ${TARGET_MINUTES}m target` : `${Math.ceil(TARGET_MINUTES - age)}m to target`}
        </span>
      </span>
    </button>
  )
}

function TraceStep({ n, title, detail }: { n: number; title: string; detail: string }) {
  return (
    <li className="flex gap-3">
      <span className="flex flex-col items-center">
        <span className="flex size-[22px] items-center justify-center rounded-full bg-primary font-mono text-[11px] text-primary-foreground">
          {n}
        </span>
        <span className="min-h-3.5 w-px flex-1 bg-border" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 pb-4">
        <span className="text-[13px] font-semibold">{title}</span>
        <span className="text-[13px] leading-snug break-words text-muted-foreground">{detail}</span>
      </span>
    </li>
  )
}

function ConversationPane({
  events,
  onDone,
  onBack,
}: {
  events: ClaudeEvent[]
  onDone: () => void
  onBack: () => void
}) {
  const { claudeStatus, refresh } = useTalkyConsole()
  const { paused } = useRepliesPause()
  const head = events[events.length - 1]!
  const [ctx, setCtx] = useState<ContextPayload | null>(null)
  const [ctxError, setCtxError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    setCtx(null)
    setCtxError(null)
    const q = new URLSearchParams({
      jid: head.chatJid,
      senderJid: head.senderJid,
      query: head.text.slice(0, 200) || 'general',
      limit: '30',
    })
    apiJson<ContextPayload>(`/api/claude/context?${q}`)
      .then((c) => alive && setCtx(c))
      .catch((e: unknown) => alive && setCtxError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [head.chatJid, head.senderJid, head.text])

  const ids = events.map((e) => e.id)
  const parts = draft.split('|||').map((p) => p.trim()).filter(Boolean)

  const ack = async () => {
    await apiJson('/api/claude/ack', { method: 'POST', body: JSON.stringify({ ids }) })
  }

  // A ref, not `busy`: two quick ⌘↵ presses run before React re-renders with busy=true.
  const inFlight = useRef(false)
  const send = async () => {
    // Same rules as the Send button — the keyboard shortcut must not bypass them.
    if (inFlight.current || parts.length === 0 || parts.length > MAX_PARTS) return
    inFlight.current = true
    setBusy(true)
    try {
      try {
        await apiJson('/api/claude/send', {
          method: 'POST',
          // A human typed this, so it goes out even while automatic replies are paused.
          body: JSON.stringify({ to: head.chatJid, text: draft, force: true }),
        })
      } catch (e) {
        toast.error(`Send failed: ${e instanceof Error ? e.message : String(e)}`)
        return
      }
      // Sent from here on: never say "failed" (a retry would message the contact twice).
      const sent = `Sent ${parts.length} message${parts.length === 1 ? '' : 's'} to ${chatTitle(head)}`
      setDraft('')
      try {
        await ack()
        toast.success(sent)
        onDone()
      } catch (e) {
        toast.warning(
          `${sent}, but it could not be marked handled (${e instanceof Error ? e.message : String(e)}). Use Stay silent to clear it — do not send again.`,
        )
      }
      void refresh()
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const staySilent = async () => {
    setBusy(true)
    try {
      await ack()
      toast.message(`Marked ${ids.length} message${ids.length === 1 ? '' : 's'} as handled without replying`)
      void refresh()
      onDone()
    } catch (e) {
      toast.error(`Could not update the queue: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const history = ctx?.history.slice(-30) ?? []
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [ctx])
  const pendingIds = new Set(events.map((e) => e.timestampISO))

  return (
    <div className="flex min-w-0 flex-[999_1_420px] flex-wrap">
      <section aria-label={`Conversation with ${chatTitle(head)}`} className="flex h-[calc(100dvh-170px)] min-h-[520px] min-w-0 flex-[999_1_400px] flex-col md:h-[calc(100dvh-230px)]">
        <header className="flex flex-wrap items-center gap-3 border-b bg-card px-4 py-3 md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="Back to queue">
            <ArrowLeft />
          </Button>
          <span aria-hidden className={cn('flex size-9 items-center justify-center bg-muted font-semibold', head.isGroup ? 'rounded-lg' : 'rounded-full')}>
            {initialOf(chatTitle(head))}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[15px] font-semibold">{chatTitle(head)}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">{head.chatJid}</span>
          </span>
          <Link
            to={`/conversations?jid=${encodeURIComponent(head.chatJid)}`}
            className="ml-auto text-[13px] font-medium underline-offset-4 hover:underline"
          >
            Full history
          </Link>
        </header>

        <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-5 md:px-6">
          {!ctx && !ctxError ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="ml-auto h-10 w-1/2" />
              <Skeleton className="h-10 w-3/5" />
            </div>
          ) : null}
          {ctxError ? <EmptyState>Couldn't load chat context: {ctxError}</EmptyState> : null}
          {history.map((m, i) => {
            const mine = m.role === 'outgoing'
            const isPending = !mine && pendingIds.has(m.timestampISO)
            return (
              <div key={`${m.timestampISO}-${i}`} className={cn('flex max-w-[80%] flex-col gap-1', mine ? 'self-end items-end' : 'self-start')}>
                <div
                  className={cn(
                    'rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
                    mine
                      ? 'rounded-br-[4px] bg-primary text-primary-foreground'
                      : 'rounded-bl-[4px] border bg-card',
                    isPending && 'ring-2 ring-series-claude',
                  )}
                >
                  {m.text}
                </div>
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                  {mine ? (
                    <span aria-hidden className="size-2 rounded-[2px]" style={{ background: m.manualOutbound ? 'var(--series-muted)' : 'var(--series-replied)' }} />
                  ) : null}
                  {new Date(m.timestampISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {mine ? (m.manualOutbound ? ' · you' : ' · talky') : isPending ? ' · waiting' : ''}
                </span>
              </div>
            )
          })}
        </div>

        <div className="m-3 overflow-hidden rounded-xl border bg-card shadow-sm md:m-5">
          <div className="flex flex-wrap items-center gap-2 bg-[#141413] px-4 py-2.5 text-[13px] text-[#f0efec] dark:bg-[#0b0b0a]">
            <span aria-hidden className="size-2 rounded-[2px] bg-series-claude" />
            <span className="font-semibold">Reply as you</span>
            <span className="text-[#c3c2b7]">
              {parts.length > MAX_PARTS
                ? `${parts.length} messages — max ${MAX_PARTS}`
                : parts.length > 1
                  ? `${parts.length} messages`
                  : 'Separate messages with |||'}
            </span>
            {paused ? (
              <span className="font-mono text-xs text-[var(--status-warning)]">
                replies paused · this send still goes out
              </span>
            ) : null}
            {!claudeStatus?.connected ? (
              <span className="ml-auto font-mono text-xs text-[#f08a7a]">WhatsApp not connected</span>
            ) : null}
          </div>
          <label className="block px-4 pt-3">
            <span className="sr-only">Reply text</span>
            <Textarea
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send()
              }}
              placeholder="Write the reply in your own voice…"
              className="resize-y bg-background"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <Button variant="ghost" disabled={busy} onClick={() => void staySilent()}>
              <X /> Stay silent
            </Button>
            <Button className="ml-auto" disabled={busy || parts.length === 0 || parts.length > MAX_PARTS} onClick={() => void send()}>
              <Send /> Send
              <kbd className="ml-1 hidden rounded bg-primary-foreground/15 px-1.5 font-mono text-[11px] sm:inline">⌘↵</kbd>
            </Button>
          </div>
        </div>
      </section>

      <aside aria-labelledby="why-title" className="flex min-w-0 flex-[1_1_300px] flex-col gap-5 border-t bg-card p-5 lg:max-h-[calc(100dvh-230px)] lg:overflow-y-auto lg:border-t-0 lg:border-l">
        <div className="flex flex-col gap-0.5">
          <h2 id="why-title" className="text-[15px] font-semibold">Why it's in the queue</h2>
          <span className="font-mono text-xs break-all text-muted-foreground">{head.id}</span>
        </div>
        <ol className="flex flex-col">
          <TraceStep
            n={1}
            title="Received"
            detail={`${new Date(head.timestampISO).toLocaleString()} · ${head.isGroup ? (head.mentionedMe ? 'group, you were mentioned' : 'group message') : 'direct message'}`}
          />
          <TraceStep n={2} title="Passed access rules" detail="Chat is allowed and not muted." />
          {head.media ? (
            <TraceStep
              n={3}
              title={head.voiceTranscript ? 'Voice note transcribed' : 'Attachment saved'}
              detail={`${head.media.fileName ?? head.media.kind} · ${head.media.mimeType}`}
            />
          ) : null}
          <TraceStep
            n={head.media ? 4 : 3}
            title="Queued for Claude"
            detail={
              claudeStatus?.mediatorExclusive
                ? 'Claude-only mode, so Gemini did not reply.'
                : 'Gemini may also have replied (Both mode).'
            }
          />
          <TraceStep
            n={head.media ? 5 : 4}
            title="Context available"
            detail={
              ctx
                ? `${ctx.history.length} recent messages · ${ctx.memories.length} contact memories · ${ctx.ownerMemories.length} owner memories`
                : 'Loading…'
            }
          />
        </ol>

        {head.media ? (
          <a
            href={`/api/claude/media?file=${encodeURIComponent(head.media.path.split(/[\\/]/).pop() ?? '')}`}
            onClick={(e) => {
              // Media is token-protected: fetch it through the authenticated fetch and open a blob.
              e.preventDefault()
              const url = e.currentTarget.getAttribute('href')!
              const fileName = head.media?.fileName ?? 'attachment'
              void fetch(url)
                .then(async (r) => {
                  if (!r.ok) throw new Error(`HTTP ${r.status}`)
                  const blob = await r.blob()
                  const objectUrl = URL.createObjectURL(blob)
                  if (blob.type === 'application/octet-stream') {
                    // Not viewable in the browser: download it under its real name.
                    const a = document.createElement('a')
                    a.href = objectUrl
                    a.download = fileName
                    a.click()
                  } else {
                    window.open(objectUrl, '_blank', 'noopener')
                  }
                  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
                })
                .catch((err: unknown) =>
                  toast.error(`Could not open ${fileName}: ${err instanceof Error ? err.message : String(err)}`),
                )
            }}
            className="flex items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted/60"
          >
            {head.media.kind === 'audio' ? <Mic className="size-5" aria-hidden /> : <FileText className="size-5" aria-hidden />}
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{head.media.fileName ?? 'Attachment'}</span>
              <span className="text-xs text-muted-foreground">Open attachment</span>
            </span>
          </a>
        ) : null}

        <div className="flex flex-col gap-2">
          <h3 className="eyebrow">Remembered</h3>
          {ctx && ctx.memories.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No memories for this contact yet.</p>
          ) : null}
          {ctx?.memories.slice(0, 4).map((m) => (
            <p key={m.fact} className="rounded-lg border bg-background p-2.5 text-[13px] leading-snug">
              {m.fact}
            </p>
          ))}
        </div>

        {ctx && (ctx.persona.contactProfile || ctx.persona.groupProfile) ? (
          <details className="text-[13px]">
            <summary className="cursor-pointer font-medium">How you talk here</summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
              {ctx.persona.contactProfile || ctx.persona.groupProfile}
            </pre>
          </details>
        ) : null}
      </aside>
    </div>
  )
}

function UnknownSenders() {
  const { unauthorized, resolveUnauthorized } = useTalkyConsole()
  if (unauthorized.length === 0) {
    return <EmptyState>No unknown senders. Messages from chats outside your access rules show up here.</EmptyState>
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {unauthorized.map((u) => (
        <li key={u.jid} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <div className="flex items-start gap-3">
            <span aria-hidden className={cn('flex size-9 shrink-0 items-center justify-center bg-muted font-semibold', u.kind === 'group' ? 'rounded-lg' : 'rounded-full')}>
              {initialOf(u.name || u.jid)}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{u.name || 'Unknown'}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">{u.jid}</span>
            </div>
            <span className="ml-auto shrink-0 rounded bg-muted px-1.5 font-mono text-[11px] text-muted-foreground">
              {u.kind === 'group' ? 'GROUP' : 'DM'} ×{u.count}
            </span>
          </div>
          {u.lastPreview ? <p className="line-clamp-2 text-[13px]">“{u.lastPreview}”</p> : null}
          <p className="text-xs text-muted-foreground">
            {u.lastReason} · {relativeTime(u.lastSeen)}
          </p>
          <div className="mt-auto flex gap-2">
            <Button size="sm" onClick={() => void resolveUnauthorized(u.jid, 'allow', u.kind)}>
              <UserCheck /> Allow
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void resolveUnauthorized(u.jid, 'discard', u.kind)}>
              Dismiss
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function QueuePage() {
  const { claudePending, claudeStatus, unauthorized } = useTalkyConsole()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'unknown' ? 'unknown' : 'waiting'
  const selectedEvent = params.get('event')
  const isMobile = useIsMobile()

  /** One row per chat; the newest pending event represents the chat. */
  const threads = useMemo(() => {
    const byChat = new Map<string, ClaudeEvent[]>()
    for (const e of [...claudePending].sort((a, b) => a.timestampISO.localeCompare(b.timestampISO))) {
      byChat.set(e.chatJid, [...(byChat.get(e.chatJid) ?? []), e])
    }
    return Array.from(byChat.values()).sort((a, b) => a[0]!.timestampISO.localeCompare(b[0]!.timestampISO))
  }, [claudePending])

  const selectedThread =
    threads.find((t) => t.some((e) => e.id === selectedEvent)) ?? (selectedEvent === null && !isMobile ? threads[0] : undefined)

  const setTab = (next: 'waiting' | 'unknown') =>
    setParams((p) => {
      const n = new URLSearchParams(p)
      if (next === 'unknown') n.set('tab', 'unknown')
      else n.delete('tab')
      return n
    })
  const select = (id: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p)
      if (id) n.set('event', id)
      else n.delete('event')
      return n
    })

  const oldest = threads[0]?.[0]

  return (
    <>
      <PageHeader
        eyebrow={claudeStatus?.mediatorEnabled ? 'Claude engine on' : 'Claude engine off'}
        title="Live queue"
        subtitle={
          claudeStatus?.mediatorEnabled
            ? `${claudePending.length} message${claudePending.length === 1 ? '' : 's'} waiting${oldest ? ` · oldest ${relativeTime(oldest.timestampISO)}` : ''}. Claude sessions pick these up via the mediator API; you can also answer here.`
            : 'Turn on the Claude engine from Overview to route allowed messages here instead of auto-replying.'
        }
        actions={
          <div role="tablist" aria-label="Queue" className="flex gap-0.5 rounded-[10px] bg-muted p-[3px]">
            {(
              [
                ['waiting', `Waiting · ${threads.length}`],
                ['unknown', `Unknown senders · ${unauthorized.length}`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  'min-h-9 rounded-lg px-3.5 text-[13px]',
                  tab === value ? 'bg-card font-semibold shadow-xs' : 'font-medium text-muted-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      {tab === 'unknown' ? (
        <UnknownSenders />
      ) : threads.length === 0 ? (
        <EmptyState>Nothing waiting. You're all caught up.</EmptyState>
      ) : (
        <div className="-mx-4 flex min-h-[600px] flex-wrap overflow-hidden border-y bg-background md:mx-0 md:rounded-xl md:border">
          <section
            aria-label="Waiting chats"
            className={cn(
              'min-w-0 flex-[1_1_280px] border-r bg-card md:block md:max-h-[calc(100dvh-230px)] md:overflow-y-auto',
              selectedThread ? 'hidden' : 'block',
            )}
          >
            {threads.map((t) => {
              const head = t[t.length - 1]!
              return (
                <QueueItem
                  key={head.chatJid}
                  event={head}
                  waitingSinceISO={t[0]!.timestampISO}
                  count={t.length}
                  active={selectedThread === t}
                  onSelect={() => select(head.id)}
                />
              )
            })}
          </section>
          {selectedThread ? (
            <ConversationPane
              key={selectedThread[0]!.chatJid}
              events={selectedThread}
              onDone={() => select(null)}
              onBack={() => select(null)}
            />
          ) : (
            <div className="hidden flex-[999_1_420px] items-center justify-center text-sm text-muted-foreground md:flex">
              Select a chat to answer it.
            </div>
          )}
        </div>
      )}
    </>
  )
}

import { Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRepliesPause } from '@/hooks/use-replies-pause'
import { cn } from '@/lib/utils'

/** Primary header button: "Pause replies" / "Resume replies". */
export function PauseRepliesButton({ className }: { className?: string }) {
  const { paused, busy, ready, setPaused } = useRepliesPause()
  const Icon = paused ? Play : Pause
  return (
    <Button
      type="button"
      onClick={() => void setPaused(!paused)}
      disabled={busy || !ready}
      aria-pressed={paused}
      title={
        paused
          ? 'Talky is recording but not answering. Click to let it reply again.'
          : 'Stop all automatic replies. Messages are still recorded and queued.'
      }
      className={cn('h-[42px] gap-2 rounded-[10px] px-4 text-[13px] font-semibold', className)}
    >
      <Icon aria-hidden />
      {paused ? 'Resume replies' : 'Pause replies'}
    </Button>
  )
}

/** Slim banner across the top of the content area while replies are paused. */
export function PausedBanner() {
  const { paused, busy, setPaused } = useRepliesPause()
  if (!paused) return null
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-l-4 border-l-[var(--status-warning)] bg-card px-4 py-2.5 text-[13px] md:px-8"
    >
      <Pause aria-hidden className="size-4 shrink-0 text-ink-warn" />
      <span className="min-w-0 flex-1 basis-56 text-foreground">
        <span className="font-semibold">Replies are paused</span>
        <span className="text-muted-foreground"> — Talky is recording messages but not answering.</span>
      </span>
      <Button
        type="button"
        size="sm"
        onClick={() => void setPaused(false)}
        disabled={busy}
        className="gap-1.5 font-semibold"
      >
        <Play aria-hidden />
        Resume
      </Button>
    </div>
  )
}

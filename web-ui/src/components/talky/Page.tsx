import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Page title block: mono eyebrow, a sentence-style headline, optional subline and actions. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end gap-4">
      <div className="mr-auto flex min-w-0 flex-col gap-1.5">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1 className="text-2xl leading-tight font-semibold tracking-[-0.03em] text-balance md:text-[32px]">
          {title}
        </h1>
        {subtitle ? <p className="max-w-3xl text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

/** A surface card with a title row. `tone="ink"` renders the dark emphasis variant. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  tone = 'default',
  id,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  tone?: 'default' | 'ink'
  id?: string
}) {
  const headingId = id ? `${id}-title` : undefined
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'flex min-w-0 flex-col gap-4 rounded-xl border p-4 md:p-5',
        tone === 'ink'
          ? 'border-transparent bg-[#141413] text-[#f0efec] dark:bg-[#0b0b0a] dark:border-[#262624]'
          : 'bg-card text-card-foreground',
        className,
      )}
    >
      {title || actions ? (
        <div className="flex flex-wrap items-start gap-3">
          <div className="mr-auto flex min-w-0 flex-col gap-0.5">
            {title ? (
              <h2 id={headingId} className="text-[15px] font-semibold">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className={cn('text-[13px]', tone === 'ink' ? 'text-[#c3c2b7]' : 'text-muted-foreground')}>
                {description}
              </p>
            ) : null}
          </div>
          {actions}
        </div>
      ) : null}
      <div className={cn('flex min-w-0 flex-col gap-3', bodyClassName)}>{children}</div>
    </section>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

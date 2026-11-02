/** Talky mark: three message lines with a single "speaking" dot. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden>
      <rect width="28" height="28" rx="8" fill="#F0EFEC" />
      <path d="M8 10.5h12M8 14h8M8 17.5h5" stroke="#141413" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="20" cy="18" r="2.5" fill="var(--series-claude)" />
    </svg>
  )
}

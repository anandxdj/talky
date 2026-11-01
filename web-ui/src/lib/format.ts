/** Display helpers shared by pages and charts. */

export function jidLabel(jid: string): string {
  const [user] = jid.split('@')
  return user || jid
}

export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us')
}

/** Mask the middle of a phone-like JID user part for on-screen display. */
export function maskedJid(jid: string): string {
  const user = jidLabel(jid)
  if (!/^\d{8,}$/.test(user)) return user
  return `${user.slice(0, 4)}•••${user.slice(-3)}`
}

export function initialOf(name: string): string {
  const ch = name.trim().match(/\p{L}|\p{N}/u)?.[0]
  return ch ? ch.toUpperCase() : '?'
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (m < 60) return s ? `${m}m ${String(s).padStart(2, '0')}s` : `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function relativeTime(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  const diff = Math.max(0, nowMs - ms) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86_400)}d ago`
}

export function compactNumber(n: number): string {
  if (Math.abs(n) < 10_000) return n.toLocaleString()
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

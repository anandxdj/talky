import crypto from "node:crypto";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomBetween(min: number, max: number): number {
  // crypto.randomInt throws on non-integer bounds; delays scaled by "slower" instructions
  // (×1.5) or a fractional value in config.yaml are not integers. Same result for integers.
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  if (hi <= lo) return lo;
  const value = crypto.randomInt(lo, hi + 1);
  return value;
}

export function sanitizeJid(jid: string): string {
  return jid.replace(/[^a-zA-Z0-9@._-]/g, "_");
}

export function compactText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/**
 * Word tokens in any script. `\W` is ASCII-only, so Bengali/Devanagari/Arabic words (whose
 * vowel signs are combining marks) were split apart or dropped and never matched.
 */
const WORD_SPLIT = /[^\p{L}\p{M}\p{N}_]+/u;

export function tokenOverlapScore(text: string, query: string): number {
  const a = new Set(text.toLowerCase().split(WORD_SPLIT).filter(Boolean));
  const b = new Set(query.toLowerCase().split(WORD_SPLIT).filter(Boolean));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of b) {
    if (a.has(token)) overlap += 1;
  }
  return overlap / b.size;
}

/** Jaccard similarity on word tokens (length > 2), used for memory deduplication. */
export function jaccardTokenSimilarity(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(WORD_SPLIT).filter((t) => t.length > 2));
  const tb = new Set(b.toLowerCase().split(WORD_SPLIT).filter((t) => t.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const token of ta) {
    if (tb.has(token)) overlap += 1;
  }
  const union = ta.size + tb.size - overlap;
  return union === 0 ? 0 : overlap / union;
}

export function previewText(value: string, maxLength = 120): string {
  const compact = compactText(value);
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// WAMessage.messageTimestamp is either a number (seconds) or a protobuf Long.
// Returns unix seconds or null when the value is missing/unparseable.
export function extractMessageTimestampSeconds(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.floor(parsed) : null;
  }
  if (typeof value === "object") {
    const maybe = value as { toNumber?: () => number; low?: number; high?: number };
    if (typeof maybe.toNumber === "function") {
      const n = maybe.toNumber();
      return Number.isFinite(n) ? Math.floor(n) : null;
    }
    if (typeof maybe.low === "number") return Math.floor(maybe.low);
  }
  return null;
}

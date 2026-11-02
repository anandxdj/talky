import { existsSync, readFileSync } from "node:fs";
import { CLAUDE_HANDLED_PATH, listPendingClaudeEvents } from "../claude-bridge.js";
import { loadConfig } from "../config.js";
import { readAllChatHistories, readDecisionEvents, type DebugLogEvent } from "../storage.js";

/**
 * Dashboard analytics derived from data Talky already writes to disk:
 *   - data/chats/*.md            → inbound / outbound lines (outbound split into Talky vs "you")
 *   - data/logs/decisions.md     → per-message reply decision (YES = replied, else silent)
 *   - data/claude/*.jsonl        → messages handed to the Claude mediator
 * Everything is bucketed in the server's local time (the server is the user's machine).
 * Pure functions take their inputs explicitly so they can be unit-tested.
 */

export type StatsChatEntry = {
  timestampISO: string;
  role: "incoming" | "outgoing";
  senderJid: string;
  text: string;
  manualOutbound?: boolean;
};

export type StatsClaudeEvent = {
  timestampISO: string;
  chatJid: string;
  chatName?: string;
  senderName?: string;
  isGroup?: boolean;
  handledAtISO?: string;
};

export type OutcomeCounts = { replied: number; claude: number; silent: number };

export type VoiceTraits = {
  messages: number;
  wordsPerMessage: number;
  messagesPerBurst: number;
  emojiPer10: number;
  lowercaseShare: number;
};

export type OverviewStats = {
  generatedAtISO: string;
  today: OutcomeCounts & {
    received: number;
    reachedEngine: number;
    sentByTalky: number;
    sentByYou: number;
    dailyLimit: number;
    medianReplySeconds: number | null;
  };
  /** 24 entries, local hour of today. */
  hourly: Array<OutcomeCounts & { hour: number; received: number }>;
  /** Last 14 days, oldest first. */
  daily: Array<OutcomeCounts & { dateISO: string; received: number; medianReplySeconds: number | null }>;
  /** heatmap[weekday 0=Mon..6=Sun][hour] = inbound messages over the last 7 days. */
  heatmap: number[][];
  chats: Array<{
    jid: string;
    name: string | null;
    isGroup: boolean;
    received7d: number;
    daily7d: number[];
    outcomes7d: OutcomeCounts;
    medianReplySeconds: number | null;
    lastAtISO: string | null;
  }>;
  claude: { pending: number; oldestPendingISO: string | null; handledToday: number };
  voice: {
    windowDays: number;
    you: VoiceTraits;
    talky: VoiceTraits;
    lengthBuckets: Array<{ label: string; you: number; talky: number }>;
    /** Daily average words per message over the window, oldest first (null = no messages). */
    wordsTrend: Array<{ dateISO: string; you: number | null; talky: number | null }>;
  };
};

const DAY_MS = 86_400_000;
const REPLY_MATCH_WINDOW_MS = 30 * 60_000;
const BURST_GAP_MS = 90_000;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const LENGTH_BUCKETS: Array<{ label: string; max: number }> = [
  { label: "1–3", max: 3 },
  { label: "4–7", max: 7 },
  { label: "8–15", max: 15 },
  { label: "16–30", max: 30 },
  { label: "30+", max: Number.POSITIVE_INFINITY }
];

export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function localDateKey(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Monday = 0 … Sunday = 6. */
function weekdayMonFirst(ms: number): number {
  return (new Date(ms).getDay() + 6) % 7;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "[empty]") return 0;
  return trimmed.split(/\s+/).length;
}

/** Chat files are keyed by sanitised JID; recover a display JID (`_` was only ever substituted). */
function isGroupKey(key: string): boolean {
  return key.endsWith("@g.us");
}

function emptyOutcomes(): OutcomeCounts {
  return { replied: 0, claude: 0, silent: 0 };
}

function decisionOutcome(event: DebugLogEvent): keyof OutcomeCounts | null {
  if (event.source !== "decision" || !event.decision) return null;
  if (event.decision === "SELF_CHAT") return null;
  return event.decision === "YES" ? "replied" : "silent";
}

/**
 * Pairs each run of inbound lines with the next Talky (non-manual) reply in the same chat.
 * An inbound older than the 30-minute window is dropped when a newer one arrives, and a
 * manual reply from the phone clears the run without counting.
 */
export function replyDelayPairs(entries: StatsChatEntry[]): Array<{ replyMs: number; seconds: number }> {
  const pairs: Array<{ replyMs: number; seconds: number }> = [];
  let pendingInboundMs: number | null = null;
  for (const entry of entries) {
    const ts = Date.parse(entry.timestampISO);
    if (!Number.isFinite(ts)) continue;
    if (entry.role === "incoming") {
      if (pendingInboundMs === null || ts - pendingInboundMs > REPLY_MATCH_WINDOW_MS) {
        pendingInboundMs = ts;
      }
      continue;
    }
    if (!entry.manualOutbound && pendingInboundMs !== null) {
      const delta = ts - pendingInboundMs;
      if (delta >= 0 && delta <= REPLY_MATCH_WINDOW_MS) pairs.push({ replyMs: ts, seconds: delta / 1000 });
    }
    pendingInboundMs = null;
  }
  return pairs;
}

/** Reply delays (seconds) for replies sent at or after `sinceMs`. Entries must be time-sorted. */
export function replyDelaysSeconds(entries: StatsChatEntry[], sinceMs = 0): number[] {
  return replyDelayPairs(entries)
    .filter((pair) => pair.replyMs >= sinceMs)
    .map((pair) => pair.seconds);
}

export function computeVoiceTraits(messages: Array<{ ms: number; chat: string; text: string }>): VoiceTraits {
  if (messages.length === 0) {
    return { messages: 0, wordsPerMessage: 0, messagesPerBurst: 0, emojiPer10: 0, lowercaseShare: 0 };
  }
  const sorted = [...messages].sort((a, b) => a.ms - b.ms);
  let bursts = 0;
  let lastChat = "";
  let lastMs = -Infinity;
  let words = 0;
  let emoji = 0;
  let lowercase = 0;
  let lettered = 0;
  for (const message of sorted) {
    if (message.chat !== lastChat || message.ms - lastMs > BURST_GAP_MS) bursts += 1;
    lastChat = message.chat;
    lastMs = message.ms;
    words += wordCount(message.text);
    emoji += (message.text.match(EMOJI_RE) ?? []).length;
    const firstLetter = message.text.match(/\p{L}/u)?.[0];
    if (firstLetter) {
      lettered += 1;
      if (firstLetter === firstLetter.toLowerCase() && firstLetter !== firstLetter.toUpperCase()) {
        lowercase += 1;
      }
    }
  }
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    messages: sorted.length,
    wordsPerMessage: round1(words / sorted.length),
    messagesPerBurst: round1(sorted.length / Math.max(1, bursts)),
    emojiPer10: round1((emoji / sorted.length) * 10),
    lowercaseShare: lettered === 0 ? 0 : Math.round((lowercase / lettered) * 100)
  };
}

export function computeOverviewStats(input: {
  chats: Record<string, StatsChatEntry[]>;
  decisions: DebugLogEvent[];
  claudePending: StatsClaudeEvent[];
  claudeHandled: StatsClaudeEvent[];
  dailyLimit: number;
  nowMs: number;
  voiceWindowDays?: number;
}): OverviewStats {
  const { nowMs } = input;
  const todayStart = startOfLocalDay(nowMs);
  const weekStart = todayStart - 6 * DAY_MS;
  const fortnightStart = todayStart - 13 * DAY_MS;
  const voiceDays = input.voiceWindowDays ?? 30;
  const voiceStart = todayStart - (voiceDays - 1) * DAY_MS;

  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, received: 0, ...emptyOutcomes() }));
  const dailyKeys = Array.from({ length: 14 }, (_, i) => localDateKey(fortnightStart + i * DAY_MS + DAY_MS / 2));
  const dailyIndex = new Map(dailyKeys.map((key, i) => [key, i]));
  const daily = dailyKeys.map((dateISO) => ({
    dateISO,
    received: 0,
    ...emptyOutcomes(),
    medianReplySeconds: null as number | null,
    _delays: [] as number[]
  }));
  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));

  type ChatAcc = OverviewStats["chats"][number];
  const chatAcc = new Map<string, ChatAcc & { _delays: number[] }>();
  const chatFor = (jid: string): ChatAcc & { _delays: number[] } => {
    let acc = chatAcc.get(jid);
    if (!acc) {
      acc = {
        jid,
        name: null,
        isGroup: isGroupKey(jid),
        received7d: 0,
        daily7d: new Array<number>(7).fill(0),
        outcomes7d: emptyOutcomes(),
        medianReplySeconds: null,
        lastAtISO: null,
        _delays: []
      };
      chatAcc.set(jid, acc);
    }
    return acc;
  };

  let receivedToday = 0;
  let sentByTalky = 0;
  let sentByYou = 0;
  const todayDelays: number[] = [];
  const youMessages: Array<{ ms: number; chat: string; text: string }> = [];
  const talkyMessages: Array<{ ms: number; chat: string; text: string }> = [];
  const wordsByDay = new Map<string, { you: number[]; talky: number[] }>();

  for (const [jid, entries] of Object.entries(input.chats)) {
    const acc = chatFor(jid);
    for (const entry of entries) {
      const ms = Date.parse(entry.timestampISO);
      if (!Number.isFinite(ms) || ms > nowMs + 60_000) continue;
      if (!acc.lastAtISO || ms > Date.parse(acc.lastAtISO)) acc.lastAtISO = entry.timestampISO;

      if (entry.role === "incoming") {
        if (ms >= todayStart) {
          receivedToday += 1;
          hourly[new Date(ms).getHours()]!.received += 1;
        }
        const di = dailyIndex.get(localDateKey(ms));
        if (di !== undefined) daily[di]!.received += 1;
        if (ms >= weekStart) {
          heatmap[weekdayMonFirst(ms)]![new Date(ms).getHours()]! += 1;
          acc.received7d += 1;
          const dayOffset = Math.floor((startOfLocalDay(ms) - weekStart) / DAY_MS);
          if (dayOffset >= 0 && dayOffset < 7) acc.daily7d[dayOffset]! += 1;
        }
        continue;
      }

      if (ms >= todayStart) {
        if (entry.manualOutbound) sentByYou += 1;
        else sentByTalky += 1;
      }
      if (ms >= voiceStart) {
        const sample = { ms, chat: jid, text: entry.text };
        const bucket = entry.manualOutbound ? youMessages : talkyMessages;
        bucket.push(sample);
        const key = localDateKey(ms);
        const day = wordsByDay.get(key) ?? { you: [], talky: [] };
        (entry.manualOutbound ? day.you : day.talky).push(wordCount(entry.text));
        wordsByDay.set(key, day);
      }
    }

    const sorted = [...entries].sort((a, b) => Date.parse(a.timestampISO) - Date.parse(b.timestampISO));
    for (const pair of replyDelayPairs(sorted)) {
      if (pair.replyMs >= weekStart) acc._delays.push(pair.seconds);
      if (pair.replyMs >= todayStart) todayDelays.push(pair.seconds);
      const di = dailyIndex.get(localDateKey(pair.replyMs));
      if (di !== undefined) daily[di]!._delays.push(pair.seconds);
    }
  }

  // Decisions → replied / silent.
  let reachedEngine = 0;
  const todayOutcomes = emptyOutcomes();
  for (const event of input.decisions) {
    const outcome = decisionOutcome(event);
    if (!outcome) continue;
    const ms = Date.parse(event.timestampISO);
    if (!Number.isFinite(ms)) continue;
    if (ms >= todayStart) {
      reachedEngine += 1;
      todayOutcomes[outcome] += 1;
      hourly[new Date(ms).getHours()]![outcome] += 1;
    }
    const di = dailyIndex.get(localDateKey(ms));
    if (di !== undefined) daily[di]![outcome] += 1;
    if (ms >= weekStart && event.chatJid) chatFor(event.chatJid).outcomes7d[outcome] += 1;
  }

  // Claude mediator → claude.
  const allClaude = [...input.claudePending, ...input.claudeHandled];
  let handledToday = 0;
  for (const event of allClaude) {
    const ms = Date.parse(event.timestampISO);
    if (!Number.isFinite(ms)) continue;
    if (ms >= todayStart) {
      reachedEngine += 1;
      todayOutcomes.claude += 1;
      hourly[new Date(ms).getHours()]!.claude += 1;
    }
    const di = dailyIndex.get(localDateKey(ms));
    if (di !== undefined) daily[di]!.claude += 1;
    const acc = chatFor(event.chatJid);
    if (ms >= weekStart) acc.outcomes7d.claude += 1;
    if (event.chatName && !acc.name) acc.name = event.chatName;
    if (typeof event.isGroup === "boolean") acc.isGroup = event.isGroup;
    if (event.handledAtISO && Date.parse(event.handledAtISO) >= todayStart) handledToday += 1;
  }

  const oldestPending = input.claudePending
    .map((event) => event.timestampISO)
    .filter((iso) => Number.isFinite(Date.parse(iso)))
    .sort()[0] ?? null;

  const chats = Array.from(chatAcc.values())
    .map(({ _delays, ...rest }) => ({ ...rest, medianReplySeconds: roundOrNull(median(_delays)) }))
    .filter((chat) => chat.received7d > 0 || chat.outcomes7d.claude > 0 || chat.outcomes7d.replied > 0)
    .sort((a, b) => b.received7d - a.received7d)
    .slice(0, 12);

  const lengthBuckets = LENGTH_BUCKETS.map((bucket) => ({ label: bucket.label, you: 0, talky: 0 }));
  const bucketShares = (messages: Array<{ text: string }>, key: "you" | "talky") => {
    const counted = messages.map((m) => wordCount(m.text)).filter((n) => n > 0);
    if (counted.length === 0) return;
    const counts = new Array<number>(LENGTH_BUCKETS.length).fill(0);
    for (const n of counted) counts[LENGTH_BUCKETS.findIndex((b) => n <= b.max)]! += 1;
    counts.forEach((count, i) => {
      lengthBuckets[i]![key] = Math.round((count / counted.length) * 100);
    });
  };
  bucketShares(youMessages, "you");
  bucketShares(talkyMessages, "talky");

  const avg = (xs: number[] | undefined) =>
    xs && xs.length > 0 ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
  const wordsTrend = Array.from({ length: voiceDays }, (_, i) => {
    const key = localDateKey(voiceStart + i * DAY_MS + DAY_MS / 2);
    const day = wordsByDay.get(key);
    return { dateISO: key, you: avg(day?.you), talky: avg(day?.talky) };
  });

  return {
    generatedAtISO: new Date(nowMs).toISOString(),
    today: {
      ...todayOutcomes,
      received: receivedToday,
      reachedEngine,
      sentByTalky,
      sentByYou,
      dailyLimit: input.dailyLimit,
      medianReplySeconds: roundOrNull(median(todayDelays))
    },
    hourly,
    daily: daily.map(({ _delays, ...rest }) => ({ ...rest, medianReplySeconds: roundOrNull(median(_delays)) })),
    heatmap,
    chats,
    claude: { pending: input.claudePending.length, oldestPendingISO: oldestPending, handledToday },
    voice: {
      windowDays: voiceDays,
      you: computeVoiceTraits(youMessages),
      talky: computeVoiceTraits(talkyMessages),
      lengthBuckets,
      wordsTrend
    }
  };
}

function roundOrNull(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

function readHandledClaudeEvents(): StatsClaudeEvent[] {
  if (!existsSync(CLAUDE_HANDLED_PATH)) return [];
  const out: StatsClaudeEvent[] = [];
  for (const line of readFileSync(CLAUDE_HANDLED_PATH, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as StatsClaudeEvent;
      if (parsed && typeof parsed.timestampISO === "string" && typeof parsed.chatJid === "string") {
        out.push(parsed);
      }
    } catch {
      // A torn final line is expected if the process died mid-write; skip it.
    }
  }
  return out;
}

let cache: { atMs: number; value: OverviewStats } | null = null;
const CACHE_MS = 10_000;

/** Reads every source from disk; cached for 10s because the UI polls. */
export function loadOverviewStats(nowMs = Date.now()): OverviewStats {
  if (cache && nowMs - cache.atMs < CACHE_MS) return cache.value;
  const value = computeOverviewStats({
    chats: readAllChatHistories(),
    decisions: readDecisionEvents(),
    claudePending: listPendingClaudeEvents(),
    claudeHandled: readHandledClaudeEvents(),
    dailyLimit: loadConfig().dailyMessageLimit,
    nowMs
  });
  cache = { atMs: nowMs, value };
  return value;
}

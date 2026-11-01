import { describe, expect, test } from "bun:test";
import {
  computeOverviewStats,
  computeVoiceTraits,
  median,
  replyDelaysSeconds,
  type StatsChatEntry
} from "../src/web/stats";

/** Local-time timestamp helper (stats bucket by the server's local time). */
function at(dayOffset: number, hour: number, minute = 0, second = 0): string {
  const d = new Date(2026, 10, 1, hour, minute, second); // 1 Nov 2026 local
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString();
}
const NOW = new Date(2026, 10, 1, 21, 0, 0).getTime();

describe("median", () => {
  test("handles empty, odd and even lists", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("replyDelaysSeconds", () => {
  test("measures from the first unanswered inbound to the next Talky reply", () => {
    const entries: StatsChatEntry[] = [
      { timestampISO: at(0, 10, 0, 0), role: "incoming", senderJid: "a", text: "hi" },
      { timestampISO: at(0, 10, 0, 20), role: "incoming", senderJid: "a", text: "you there?" },
      { timestampISO: at(0, 10, 0, 45), role: "outgoing", senderJid: "me", text: "yes" },
      // Manual reply from the phone resets without counting.
      { timestampISO: at(0, 11, 0, 0), role: "incoming", senderJid: "a", text: "ok" },
      { timestampISO: at(0, 11, 0, 5), role: "outgoing", senderJid: "me", text: "k", manualOutbound: true },
      // Reply after the 30-minute window is not a reply delay.
      { timestampISO: at(0, 12, 0, 0), role: "incoming", senderJid: "a", text: "later" },
      { timestampISO: at(0, 13, 0, 0), role: "outgoing", senderJid: "me", text: "sorry" }
    ];
    expect(replyDelaysSeconds(entries)).toEqual([45]);
  });
});

describe("computeVoiceTraits", () => {
  test("words, bursts, emoji and lowercase share", () => {
    const base = new Date(2026, 10, 1, 9).getTime();
    const traits = computeVoiceTraits([
      { ms: base, chat: "c1", text: "haan dekha" },
      { ms: base + 10_000, chat: "c1", text: "nice 😂" },
      { ms: base + 600_000, chat: "c1", text: "Sure thing then" },
      { ms: base + 610_000, chat: "c2", text: "ok" }
    ]);
    expect(traits.messages).toBe(4);
    expect(traits.wordsPerMessage).toBe(2); // (2+2+3+1)/4
    expect(traits.messagesPerBurst).toBe(1.3); // 4 msgs / 3 bursts
    expect(traits.emojiPer10).toBe(2.5);
    expect(traits.lowercaseShare).toBe(75);
  });

  test("empty input is all zeros", () => {
    expect(computeVoiceTraits([]).messages).toBe(0);
  });
});

describe("computeOverviewStats", () => {
  const chats: Record<string, StatsChatEntry[]> = {
    "911111111111@s.whatsapp.net": [
      { timestampISO: at(0, 9, 0), role: "incoming", senderJid: "a", text: "morning" },
      { timestampISO: at(0, 9, 1), role: "outgoing", senderJid: "me", text: "gm" },
      { timestampISO: at(-1, 20, 0), role: "incoming", senderJid: "a", text: "yesterday" },
      { timestampISO: at(0, 18, 0), role: "outgoing", senderJid: "me", text: "Typed this myself", manualOutbound: true }
    ],
    "12345@g.us": [{ timestampISO: at(0, 20, 30), role: "incoming", senderJid: "b", text: "anyone?" }]
  };

  const stats = computeOverviewStats({
    chats,
    decisions: [
      { timestampISO: at(0, 9, 0), source: "decision", chatJid: "911111111111@s.whatsapp.net", decision: "YES", message: "", raw: "" },
      { timestampISO: at(0, 20, 30), source: "decision", chatJid: "12345@g.us", decision: "NO", message: "", raw: "" },
      { timestampISO: at(0, 8, 0), source: "decision", chatJid: "self", decision: "SELF_CHAT", message: "", raw: "" }
    ],
    claudePending: [{ timestampISO: at(0, 20, 45), chatJid: "12345@g.us", chatName: "Work", isGroup: true }],
    claudeHandled: [
      { timestampISO: at(0, 19, 0), chatJid: "911111111111@s.whatsapp.net", handledAtISO: at(0, 19, 2) }
    ],
    dailyLimit: 150,
    nowMs: NOW
  });

  test("today totals combine chat lines, decisions and the Claude queue", () => {
    expect(stats.today.received).toBe(2);
    expect(stats.today.replied).toBe(1);
    expect(stats.today.silent).toBe(1);
    expect(stats.today.claude).toBe(2);
    expect(stats.today.reachedEngine).toBe(4);
    expect(stats.today.sentByTalky).toBe(1);
    expect(stats.today.sentByYou).toBe(1);
    expect(stats.today.medianReplySeconds).toBe(60);
    expect(stats.today.dailyLimit).toBe(150);
  });

  test("hourly buckets by local hour; SELF_CHAT is excluded", () => {
    expect(stats.hourly).toHaveLength(24);
    expect(stats.hourly[9]).toMatchObject({ received: 1, replied: 1 });
    expect(stats.hourly[20]).toMatchObject({ received: 1, silent: 1, claude: 1 });
    expect(stats.hourly[8]).toMatchObject({ replied: 0, silent: 0 });
  });

  test("14-day series ends today and heatmap covers 7 days", () => {
    expect(stats.daily).toHaveLength(14);
    expect(stats.daily.at(-1)?.received).toBe(2);
    expect(stats.daily.at(-2)?.received).toBe(1);
    const total = stats.heatmap.flat().reduce((a, b) => a + b, 0);
    expect(total).toBe(3);
  });

  test("per-chat rows pick up names and group flags from Claude events", () => {
    const work = stats.chats.find((c) => c.jid === "12345@g.us");
    expect(work).toMatchObject({ name: "Work", isGroup: true, received7d: 1 });
    expect(work?.outcomes7d).toEqual({ replied: 0, claude: 1, silent: 1 });
    expect(stats.claude).toEqual({ pending: 1, oldestPendingISO: at(0, 20, 45), handledToday: 1 });
  });

  test("voice compares manual (you) vs automatic (Talky) messages", () => {
    expect(stats.voice.you.messages).toBe(1);
    expect(stats.voice.talky.messages).toBe(1);
    expect(stats.voice.you.wordsPerMessage).toBe(3);
    expect(stats.voice.lengthBuckets[0]).toEqual({ label: "1–3", you: 100, talky: 100 });
    expect(stats.voice.wordsTrend).toHaveLength(30);
  });
});

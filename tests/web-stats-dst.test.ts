import { afterAll, describe, expect, test } from "bun:test";
import { computeOverviewStats, type StatsChatEntry } from "../src/web/stats";

// Stats bucket by the server's local time; pin a zone with a DST change inside the windows.
const previousTz = process.env.TZ;
process.env.TZ = "America/New_York";
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const inbound = (iso: string): StatsChatEntry => ({ timestampISO: iso, role: "incoming", senderJid: "a", text: "hi" });

function run(nowIso: string, entries: StatsChatEntry[]) {
  return computeOverviewStats({
    chats: { "a@s.whatsapp.net": entries },
    decisions: [],
    claudePending: [],
    claudeHandled: [],
    dailyLimit: 100,
    nowMs: Date.parse(nowIso)
  });
}

describe("stats windows across DST (BUG-02)", () => {
  test("sanity: the zone really observes DST here", () => {
    expect(new Date(2026, 9, 27).getTimezoneOffset()).toBe(240);
    expect(new Date(2026, 10, 2).getTimezoneOffset()).toBe(300);
  });

  test("fall back (US, 1 Nov 2026): every one of the last 7 local days gets its own slot", () => {
    // Today is Mon 2 Nov; the window is Tue 27 Oct .. Mon 2 Nov.
    const entries = [27, 28, 29, 30, 31].map((d) => inbound(local(2026, 10, d, 0, 30)));
    entries.push(inbound(local(2026, 11, 1, 0, 30)), inbound(local(2026, 11, 2, 0, 30)));
    const stats = run(local(2026, 11, 2, 12), entries);
    const chat = stats.chats[0]!;
    expect(chat.received7d).toBe(7);
    expect(chat.daily7d).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(stats.heatmap.flat().reduce((a, b) => a + b, 0)).toBe(7);
    expect(stats.heatmap[1]![0]).toBe(1); // Tue 27 Oct 00:30 → Tuesday, hour 0
  });

  test("spring forward (US, 8 Mar 2026): the day before the window does not leak in", () => {
    const entries = [inbound(local(2026, 3, 2, 23, 30)), inbound(local(2026, 3, 3, 0, 30))];
    const stats = run(local(2026, 3, 9, 12), entries);
    const chat = stats.chats[0]!;
    expect(chat.received7d).toBe(1);
    expect(chat.daily7d).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect(stats.heatmap[0]![23]).toBe(0); // Mon 2 Mar is outside the window
  });

  test("14-day series has 14 consecutive local dates across the change", () => {
    const stats = run(local(2026, 11, 2, 12), []);
    expect(stats.daily.map((d) => d.dateISO)).toEqual([
      "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26",
      "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"
    ]);
  });
});

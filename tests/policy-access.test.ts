import { describe, expect, test } from "bun:test";
import {
  buildDirectIdentifiers,
  evaluateChatPolicy,
  isDirectJidAllowed,
  isGroupJidAllowed,
  shouldMediateChat,
  type ChatPolicyConfig,
  type LidLookup
} from "../src/policy/access";
import { lidDigitsForPhone, phoneDigitsForLid } from "../src/lid-map";

const PHONE = "919876543210";
const LID = "124245216596056";
const PHONE_JID = `${PHONE}@s.whatsapp.net`;
const LID_JID = `${LID}@lid`;

/** Stub of the wa_auth lid-mapping files: one known contact. */
const lidLookup: LidLookup = {
  lidDigitsForPhone: (digits) => (digits === PHONE ? LID : null),
  phoneDigitsForLid: (digits) => (digits === LID ? PHONE : null)
};
const noLidMapping: LidLookup = {
  lidDigitsForPhone: () => null,
  phoneDigitsForLid: () => null
};

describe("isGroupJidAllowed", () => {
  test("case- and whitespace-insensitive exact match", () => {
    expect(isGroupJidAllowed("12036@g.us", [" 12036@G.US "])).toBe(true);
    expect(isGroupJidAllowed("12036@g.us", ["99999@g.us"])).toBe(false);
    expect(isGroupJidAllowed("12036@g.us", [])).toBe(false);
  });

  test("no prefix/substring matching", () => {
    expect(isGroupJidAllowed("12036@g.us", ["1203@g.us"])).toBe(false);
  });
});

describe("buildDirectIdentifiers", () => {
  test("phone JID expands to user part and both server forms", () => {
    const ids = buildDirectIdentifiers(PHONE_JID, noLidMapping);
    expect([...ids].sort()).toEqual([PHONE, `${PHONE}@lid`, PHONE_JID].sort());
  });

  test("strips device suffix and lowercases", () => {
    const ids = buildDirectIdentifiers(` ${PHONE}:12@S.WHATSAPP.NET `, noLidMapping);
    expect(ids.has(PHONE_JID)).toBe(true);
    expect(ids.has(PHONE)).toBe(true);
  });

  test("adds the mapped LID / phone identities when a mapping exists", () => {
    const fromPhone = buildDirectIdentifiers(PHONE_JID, lidLookup);
    expect(fromPhone.has(LID_JID)).toBe(true);
    expect(fromPhone.has(LID)).toBe(true);
    const fromLid = buildDirectIdentifiers(LID_JID, lidLookup);
    expect(fromLid.has(PHONE_JID)).toBe(true);
  });

  test("empty input yields no identifiers", () => {
    expect(buildDirectIdentifiers("   ", lidLookup).size).toBe(0);
  });
});

describe("isDirectJidAllowed", () => {
  test("exact JID match", () => {
    expect(isDirectJidAllowed(PHONE_JID, [PHONE_JID], noLidMapping)).toBe(true);
  });

  test("not allowed when absent / allowlist empty / only blank entries", () => {
    expect(isDirectJidAllowed(PHONE_JID, ["911111111111@s.whatsapp.net"], noLidMapping)).toBe(false);
    expect(isDirectJidAllowed(PHONE_JID, [], noLidMapping)).toBe(false);
    expect(isDirectJidAllowed(PHONE_JID, ["", "  "], noLidMapping)).toBe(false);
  });

  test("bare digits in the allowlist match the phone JID", () => {
    expect(isDirectJidAllowed(PHONE_JID, [PHONE], noLidMapping)).toBe(true);
  });

  test("device-suffixed incoming JID matches", () => {
    expect(isDirectJidAllowed(`${PHONE}:3@s.whatsapp.net`, [PHONE_JID], noLidMapping)).toBe(true);
  });

  test("LID-aware: phone allowlist entry matches incoming @lid chat (and vice versa)", () => {
    expect(isDirectJidAllowed(LID_JID, [PHONE_JID], lidLookup)).toBe(true);
    expect(isDirectJidAllowed(PHONE_JID, [LID_JID], lidLookup)).toBe(true);
    expect(isDirectJidAllowed(LID_JID, [PHONE], lidLookup)).toBe(true);
  });

  test("without a mapping, a different-digit LID does not match the phone entry", () => {
    expect(isDirectJidAllowed(LID_JID, [PHONE_JID], noLidMapping)).toBe(false);
  });

  test("mapping for one contact does not leak to another", () => {
    expect(isDirectJidAllowed("555555555555@lid", [PHONE_JID], lidLookup)).toBe(false);
  });
});

describe("lid-map lookups", () => {
  test("non-digit input never touches the mapping files", () => {
    expect(lidDigitsForPhone("abc")).toBeNull();
    expect(phoneDigitsForLid("12a")).toBeNull();
    expect(lidDigitsForPhone("")).toBeNull();
  });
});

function policyConfig(overrides: Partial<ChatPolicyConfig> = {}): ChatPolicyConfig {
  return {
    mutedGroupJids: [],
    allowedGroupJids: [],
    selfChatEnabled: false,
    directChatMode: "allowlist",
    allowedDirectJids: [],
    ...overrides
  };
}

function evaluate(
  config: ChatPolicyConfig,
  chatJid: string,
  isGroup: boolean,
  opts: { ownJid?: string; selfPeers?: string[] } = {}
) {
  const calls: string[] = [];
  const result = evaluateChatPolicy({
    config,
    chatJid,
    isGroup,
    ownJid: opts.ownJid ?? "",
    isSelfChatPeer: (jid) => {
      calls.push(jid);
      return (opts.selfPeers ?? []).includes(jid);
    },
    lidLookup
  });
  return { ...result, selfChecks: calls.length };
}

describe("evaluateChatPolicy — groups", () => {
  const G = "12036@g.us";

  test("muted group is denied even if allowlisted", () => {
    const r = evaluate(policyConfig({ mutedGroupJids: [G], allowedGroupJids: [G] }), G, true);
    expect(r).toMatchObject({ allowed: false, reason: "group is muted" });
  });

  test("no group allowlist means every (unmuted) group is allowed", () => {
    expect(evaluate(policyConfig(), G, true)).toMatchObject({
      allowed: true,
      reason: "group allowed (no allowlist configured)"
    });
  });

  test("group allowlist is enforced", () => {
    expect(evaluate(policyConfig({ allowedGroupJids: [G] }), G, true).allowed).toBe(true);
    expect(evaluate(policyConfig({ allowedGroupJids: ["9@g.us"] }), G, true)).toMatchObject({
      allowed: false,
      reason: "group not in allowedGroupJids"
    });
  });

  test("directChatMode does not affect groups", () => {
    expect(evaluate(policyConfig({ directChatMode: "none" }), G, true).allowed).toBe(true);
  });
});

describe("evaluateChatPolicy — direct chats", () => {
  test("directChatMode=none denies, =all allows", () => {
    expect(evaluate(policyConfig({ directChatMode: "none" }), PHONE_JID, false)).toMatchObject({
      allowed: false,
      reason: "directChatMode=none"
    });
    expect(evaluate(policyConfig({ directChatMode: "all" }), PHONE_JID, false)).toMatchObject({
      allowed: true,
      reason: "directChatMode=all"
    });
  });

  test("allowlist mode allows listed contacts only (LID-aware)", () => {
    const config = policyConfig({ allowedDirectJids: [PHONE_JID] });
    expect(evaluate(config, PHONE_JID, false).allowed).toBe(true);
    expect(evaluate(config, LID_JID, false).allowed).toBe(true);
    expect(evaluate(config, "911111111111@s.whatsapp.net", false)).toMatchObject({
      allowed: false,
      reason: "direct not in allowlist (mode=allowlist, allowlistSize=1)"
    });
  });

  test("self-chat is allowed even with directChatMode=none when enabled", () => {
    const own = "910000000000@s.whatsapp.net";
    const r = evaluate(
      policyConfig({ directChatMode: "none", selfChatEnabled: true }),
      own,
      false,
      { ownJid: own, selfPeers: [own] }
    );
    expect(r).toMatchObject({ allowed: true, reason: "self-chat allowed (selfChatEnabled=true)" });
  });

  test("self-chat peer check is skipped when disabled or own JID unknown", () => {
    const own = "910000000000@s.whatsapp.net";
    const disabled = evaluate(policyConfig({ directChatMode: "none" }), own, false, {
      ownJid: own,
      selfPeers: [own]
    });
    expect(disabled).toMatchObject({ allowed: false, selfChecks: 0 });
    const noOwn = evaluate(
      policyConfig({ directChatMode: "none", selfChatEnabled: true }),
      own,
      false,
      { ownJid: "", selfPeers: [own] }
    );
    expect(noOwn).toMatchObject({ allowed: false, selfChecks: 0 });
  });
});

describe("shouldMediateChat", () => {
  test("disabled mediator never mediates", () => {
    expect(
      shouldMediateChat({ claudeMediatorEnabled: false, claudeMediatorChats: [] }, PHONE_JID, lidLookup)
    ).toBe(false);
  });

  test("empty filter mediates every chat", () => {
    const config = { claudeMediatorEnabled: true, claudeMediatorChats: [] };
    expect(shouldMediateChat(config, PHONE_JID, lidLookup)).toBe(true);
    expect(shouldMediateChat(config, "12036@g.us", lidLookup)).toBe(true);
  });

  test("filter restricts groups by exact JID and DMs LID-aware", () => {
    const config = { claudeMediatorEnabled: true, claudeMediatorChats: ["12036@g.us", PHONE_JID] };
    expect(shouldMediateChat(config, "12036@g.us", lidLookup)).toBe(true);
    expect(shouldMediateChat(config, "99999@g.us", lidLookup)).toBe(false);
    expect(shouldMediateChat(config, LID_JID, lidLookup)).toBe(true);
    expect(shouldMediateChat(config, "911111111111@s.whatsapp.net", lidLookup)).toBe(false);
  });

  test("a group is not matched by a DM filter entry with the same digits", () => {
    const config = { claudeMediatorEnabled: true, claudeMediatorChats: ["12036@s.whatsapp.net"] };
    expect(shouldMediateChat(config, "12036@g.us", lidLookup)).toBe(false);
  });
});

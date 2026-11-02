// Chat access policy: who Talky may read/reply to/mediate.
//
// `jidNormalizedUser` is imported from Baileys' standalone jid-utils module (the same
// function the "baileys" entry point re-exports) so this module stays loadable without
// pulling in the full Baileys/libsignal runtime — e.g. from unit tests.
import { jidNormalizedUser } from "baileys/lib/WABinary/jid-utils.js";
import { lidDigitsForPhone, phoneDigitsForLid } from "../lid-map";
import type { AppConfig } from "../types";

/** Phone⇔LID digit lookups (see src/lid-map.ts). Injectable for tests. */
export type LidLookup = {
  lidDigitsForPhone: (phoneDigits: string) => string | null;
  phoneDigitsForLid: (lidDigits: string) => string | null;
};

const defaultLidLookup: LidLookup = { lidDigitsForPhone, phoneDigitsForLid };

export function isGroupJidAllowed(chatJid: string, allowedGroupJids: string[]): boolean {
  const needle = chatJid.trim().toLowerCase();
  return allowedGroupJids.some((g) => g.trim().toLowerCase() === needle);
}

export function isDirectJidAllowed(
  chatJid: string,
  allowlist: string[],
  lidLookup: LidLookup = defaultLidLookup
): boolean {
  const incoming = buildDirectIdentifiers(chatJid, lidLookup);
  for (const raw of allowlist) {
    const allowed = buildDirectIdentifiers(raw, lidLookup);
    for (const value of allowed) {
      if (incoming.has(value)) return true;
    }
  }
  return false;
}

export function buildDirectIdentifiers(
  input: string,
  lidLookup: LidLookup = defaultLidLookup
): Set<string> {
  const values = new Set<string>();
  const raw = input.trim().toLowerCase();
  if (!raw) return values;

  values.add(raw);
  const normalized = jidNormalizedUser(raw).toLowerCase();
  values.add(normalized);

  const userPart = normalized.split("@")[0];
  if (userPart) {
    values.add(userPart);
    values.add(`${userPart}@s.whatsapp.net`);
    values.add(`${userPart}@lid`);

    // WhatsApp delivers many chats under a LID that differs from the phone JID.
    // Consult the wa_auth lid-mapping so allowlisting either form covers both
    // (e.g. 916291233974@s.whatsapp.net ⇔ 124245216596056@lid).
    for (const mapped of [
      lidLookup.lidDigitsForPhone(userPart),
      lidLookup.phoneDigitsForLid(userPart)
    ]) {
      if (!mapped) continue;
      values.add(mapped);
      values.add(`${mapped}@s.whatsapp.net`);
      values.add(`${mapped}@lid`);
    }
  }

  return values;
}

export type ChatPolicyConfig = Pick<
  AppConfig,
  "mutedGroupJids" | "allowedGroupJids" | "selfChatEnabled" | "directChatMode" | "allowedDirectJids"
>;

/**
 * Inbound chat policy (body of WhatsAppAgent.evaluateChatPolicy). `isSelfChatPeer` is only
 * consulted for DMs when self-chat is enabled and the own JID is known, exactly as before.
 */
export function evaluateChatPolicy(args: {
  config: ChatPolicyConfig;
  chatJid: string;
  isGroup: boolean;
  ownJid: string;
  isSelfChatPeer: (chatJid: string) => boolean;
  lidLookup?: LidLookup;
}): { allowed: boolean; reason: string } {
  const { config, chatJid, isGroup } = args;
  if (isGroup) {
    if (config.mutedGroupJids.includes(chatJid)) {
      return { allowed: false, reason: "group is muted" };
    }
    if (config.allowedGroupJids.length === 0) {
      return { allowed: true, reason: "group allowed (no allowlist configured)" };
    }
    const allowed = isGroupJidAllowed(chatJid, config.allowedGroupJids);
    return {
      allowed,
      reason: allowed
        ? "group matched allowlist"
        : "group not in allowedGroupJids"
    };
  }
  // Self-chat (notebook): allow when enabled and DM peer matches any linked identity (@s.whatsapp.net / @lid / selfSenderJids).
  if (config.selfChatEnabled && args.ownJid.length > 0 && args.isSelfChatPeer(chatJid)) {
    return { allowed: true, reason: "self-chat allowed (selfChatEnabled=true)" };
  }
  if (config.directChatMode === "none") {
    return { allowed: false, reason: "directChatMode=none" };
  }
  if (config.directChatMode === "all") {
    return { allowed: true, reason: "directChatMode=all" };
  }
  const allowed = isDirectJidAllowed(chatJid, config.allowedDirectJids, args.lidLookup);
  return {
    allowed,
    reason: allowed
      ? "direct matched allowlist"
      : `direct not in allowlist (mode=allowlist, allowlistSize=${config.allowedDirectJids.length})`
  };
}

/** Whether an (already policy-allowed) chat is routed to the Claude mediator queue. */
export function shouldMediateChat(
  config: Pick<AppConfig, "claudeMediatorEnabled" | "claudeMediatorChats">,
  chatJid: string,
  lidLookup?: LidLookup
): boolean {
  if (!config.claudeMediatorEnabled) return false;
  const filter = config.claudeMediatorChats;
  if (filter.length === 0) return true;
  if (chatJid.endsWith("@g.us")) return isGroupJidAllowed(chatJid, filter);
  // LID-aware: a filter entry in either phone or @lid form matches both.
  return isDirectJidAllowed(chatJid, filter, lidLookup);
}

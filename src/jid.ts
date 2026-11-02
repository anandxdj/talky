import { compactText } from "./utils";

const PHONE_SUFFIX = "@s.whatsapp.net";
const LID_SUFFIX = "@lid";
const GROUP_SUFFIX = "@g.us";
const BROADCAST_SUFFIX = "@broadcast";

export type NormalizedJidKind = "phone" | "lid" | "group" | "broadcast" | "raw";

export type NormalizedJid = {
  jid: string;
  kind: NormalizedJidKind;
  digits: string;
};

function stripCosmetic(input: string): string {
  return input.trim().replace(/[\s()\-]/g, "").replace(/^\+/, "");
}

export function isJidLike(input: string): boolean {
  return input.includes("@");
}

export function normalizeJidInput(input: string): NormalizedJid {
  const raw = (input ?? "").trim();
  if (!raw) {
    throw new Error("jid/phone input is empty");
  }

  if (raw.endsWith(GROUP_SUFFIX)) {
    return { jid: raw, kind: "group", digits: raw.slice(0, -GROUP_SUFFIX.length) };
  }
  if (raw.endsWith(BROADCAST_SUFFIX)) {
    return { jid: raw, kind: "broadcast", digits: raw.slice(0, -BROADCAST_SUFFIX.length) };
  }
  if (raw.endsWith(LID_SUFFIX)) {
    const user = raw.slice(0, -LID_SUFFIX.length).split(":")[0] ?? "";
    return { jid: `${user}${LID_SUFFIX}`, kind: "lid", digits: user };
  }
  if (raw.endsWith(PHONE_SUFFIX)) {
    const user = raw.slice(0, -PHONE_SUFFIX.length).split(":")[0] ?? "";
    const digits = stripCosmetic(user);
    if (!/^\d+$/.test(digits)) {
      throw new Error(`invalid phone JID: ${raw}`);
    }
    return { jid: `${digits}${PHONE_SUFFIX}`, kind: "phone", digits };
  }
  if (isJidLike(raw)) {
    return { jid: raw, kind: "raw", digits: raw.split("@")[0] ?? "" };
  }

  const digits = stripCosmetic(raw);
  if (!/^\d{6,15}$/.test(digits)) {
    throw new Error(
      `cannot parse "${input}" as a phone number — expected 6–15 digits or a full JID`
    );
  }
  return { jid: `${digits}${PHONE_SUFFIX}`, kind: "phone", digits };
}

export function toPhoneJid(input: string): string {
  const parsed = normalizeJidInput(input);
  if (parsed.kind === "phone") return parsed.jid;
  if (parsed.kind === "lid" || parsed.kind === "raw") {
    if (/^\d+$/.test(parsed.digits)) return `${parsed.digits}${PHONE_SUFFIX}`;
  }
  throw new Error(`cannot convert ${parsed.kind} JID to phone JID: ${input}`);
}

export function shouldIgnoreIncomingJid(jid?: string | null): boolean {
  if (!jid) return false;
  return (
    jid === "status@broadcast" ||
    jid.endsWith("@broadcast") ||
    jid.endsWith("@newsletter")
  );
}

export function buildMediaSendTargets(chatJid: string): string[] {
  const targets = new Set<string>();
  targets.add(chatJid);

  if (chatJid.endsWith("@g.us")) {
    return [...targets];
  }

  const user = compactText(chatJid.split("@")[0] ?? "");
  if (!user) {
    return [...targets];
  }

  if (chatJid.endsWith("@lid")) {
    targets.add(`${user}@s.whatsapp.net`);
  } else if (chatJid.endsWith("@s.whatsapp.net")) {
    targets.add(`${user}@lid`);
  }

  return [...targets];
}

export function toDirectTargetJid(input: string): string {
  const { jid } = normalizeJidInput(input);
  return jid;
}

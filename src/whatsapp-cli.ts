// Standalone one-shot WhatsApp CLI commands (groups:list, groups:active, direct:poke,
// contact:resolve). Each opens its own short-lived Baileys socket; none touch the
// long-running WhatsAppAgent. Re-exported from ./whatsapp for existing importers.
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} from "baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { AUTH_DIR } from "./config";
import type { AppConfig, AppEnv } from "./types";
import { MemoryService } from "./memory";
import { GeminiClient } from "./gemini";
import { randomBetween, sleep } from "./utils";
import { normalizeJidInput, shouldIgnoreIncomingJid, toDirectTargetJid } from "./jid";
import { normalizeReplyOutput } from "./reply/parse";

export async function listJoinedGroups(): Promise<void> {
  const logger = pino({ level: "warn" });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    fireInitQueries: false,
    syncFullHistory: false,
    shouldIgnoreJid: shouldIgnoreIncomingJid,
    shouldSyncHistoryMessage: () => false,
    logger
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async (update: any) => {
    if (update?.qr) {
      console.log("\nScan this QR in WhatsApp > Linked devices:\n");
      qrcode.generate(update.qr, { small: true });
    }
    if (update?.connection === "open") {
      const rows = await fetchJoinedGroups(sock);
      console.log(JSON.stringify(rows, null, 2));
      process.exit(0);
    }
    if (update?.connection === "close") {
      const code = update?.lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error("Logged out. Remove wa_auth and run again.");
        process.exit(1);
      }
      if (code === DisconnectReason.connectionReplaced || code === 440) {
        console.error("Connection replaced. Ensure only one Talky process is running.");
        process.exit(1);
      }
    }
  });

  await new Promise(() => undefined);
}

export async function listActiveGroups(config: AppConfig): Promise<void> {
  const logger = pino({ level: "warn" });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    fireInitQueries: false,
    syncFullHistory: false,
    shouldIgnoreJid: shouldIgnoreIncomingJid,
    shouldSyncHistoryMessage: () => false,
    logger
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async (update: any) => {
    if (update?.qr) {
      console.log("\nScan this QR in WhatsApp > Linked devices:\n");
      qrcode.generate(update.qr, { small: true });
    }
    if (update?.connection === "open") {
      const rows = await fetchJoinedGroups(sock);
      const active = rows.filter((group) => {
        if (config.mutedGroupJids.includes(group.jid)) return false;
        if (config.allowedGroupJids.length === 0) return true;
        return config.allowedGroupJids.includes(group.jid);
      });
      console.log(JSON.stringify(active, null, 2));
      process.exit(0);
    }
    if (update?.connection === "close") {
      const code = update?.lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error("Logged out. Remove wa_auth and run again.");
        process.exit(1);
      }
      if (code === DisconnectReason.connectionReplaced || code === 440) {
        console.error("Connection replaced. Ensure only one Talky process is running.");
        process.exit(1);
      }
    }
  });

  await new Promise(() => undefined);
}

export async function sendDirectProactiveMessage(args: {
  target: string;
  config: AppConfig;
  env: AppEnv;
}): Promise<void> {
  const logger = pino({ level: "warn" });
  const targetJid = toDirectTargetJid(args.target);
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    fireInitQueries: false,
    syncFullHistory: false,
    shouldIgnoreJid: shouldIgnoreIncomingJid,
    shouldSyncHistoryMessage: () => false,
    logger
  });

  const gemini = new GeminiClient(args.env.geminiApiKey);
  const memory = new MemoryService(args.env.mem0ApiKey);

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async (update: any) => {
    if (update?.qr) {
      console.log("\nScan this QR in WhatsApp > Linked devices:\n");
      qrcode.generate(update.qr, { small: true });
    }
    if (update?.connection === "open") {
      const memories = await memory.retrieve(targetJid, "conversation starter", 3);
      const memoryText =
        memories.length === 0
          ? "none"
          : memories.map((item, index) => `${index + 1}. ${item.fact}`).join("\n");
      let text = "Ki re boss, bhalo? Ajke ki update?";
      try {
        const output = await gemini.generate({
          model: args.config.model,
          systemInstruction: [
            `You are ${args.config.botName}.`,
            "Write one short funny Banglish/Benglish WhatsApp opener.",
            "Keep it warm, casual, and natural. Max 1-2 short lines.",
            "No NO_REPLY token."
          ].join("\n"),
          parts: [{ text: `Target JID: ${targetJid}\nRelevant memory:\n${memoryText}` }],
          temperature: 0.8,
          maxOutputTokens: 80
        });
        const cleaned = normalizeReplyOutput(output);
        if (cleaned) text = cleaned;
      } catch {
        // fallback text already set
      }

      await sock.sendPresenceUpdate("composing", targetJid);
      await sleep(randomBetween(900, 1800));
      await sock.sendPresenceUpdate("paused", targetJid);
      await sock.sendMessage(targetJid, { text });
      console.log(`Proactive message sent to ${targetJid}: ${text}`);
      process.exit(0);
    }
    if (update?.connection === "close") {
      const code = update?.lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error("Logged out. Remove wa_auth and run again.");
        process.exit(1);
      }
      if (code === DisconnectReason.connectionReplaced || code === 440) {
        console.error("Connection replaced. Ensure only one Talky process is running.");
        process.exit(1);
      }
    }
  });

  await new Promise(() => undefined);
}

export async function fetchJoinedGroups(
  sock: any
): Promise<Array<{ jid: string; name: string }>> {
  const groups = await sock.groupFetchAllParticipating();
  return Object.values(groups).map((group: any) => ({
    jid: group.id,
    name: group.subject
  }));
}

export type ContactResolution = {
  input: string;
  phoneJid: string | null;
  lidJid: string | null;
  exists: boolean;
  warnings: string[];
};

export async function resolveContactJid(input: string): Promise<ContactResolution> {
  const warnings: string[] = [];
  const parsed = normalizeJidInput(input);

  if (parsed.kind === "group" || parsed.kind === "broadcast") {
    throw new Error(`contact:resolve expects a user JID/phone, got ${parsed.kind}: ${input}`);
  }

  const initialPhoneJid = parsed.kind === "phone" ? parsed.jid : null;
  const initialLidJid = parsed.kind === "lid" ? parsed.jid : null;

  const logger = pino({ level: "warn" });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    fireInitQueries: false,
    syncFullHistory: false,
    shouldIgnoreJid: shouldIgnoreIncomingJid,
    shouldSyncHistoryMessage: () => false,
    logger
  });
  sock.ev.on("creds.update", saveCreds);

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("connection timeout — is wa_auth valid? try `bun run start` once first"));
      }, 30_000);
      sock.ev.on("connection.update", (update: any) => {
        if (update?.qr) {
          clearTimeout(timer);
          reject(new Error("no active session — run `bun run start` and scan the QR first"));
        }
        if (update?.connection === "open") {
          clearTimeout(timer);
          resolve();
        }
        if (update?.connection === "close") {
          const code = update?.lastDisconnect?.error?.output?.statusCode;
          if (code === DisconnectReason.loggedOut) {
            clearTimeout(timer);
            reject(new Error("logged out — run `bun run relink` for a fresh QR"));
          }
        }
      });
    });

    let phoneJid = initialPhoneJid;
    let exists = false;
    if (parsed.kind === "phone" || (parsed.kind === "lid" && /^\d+$/.test(parsed.digits))) {
      const lookupDigits = parsed.digits;
      try {
        const results = await sock.onWhatsApp(lookupDigits);
        const match = results?.find((entry: any) => entry?.exists);
        if (match) {
          phoneJid = match.jid ?? `${lookupDigits}@s.whatsapp.net`;
          exists = true;
        } else {
          warnings.push(`WhatsApp says this number is not registered: ${lookupDigits}`);
          phoneJid = phoneJid ?? `${lookupDigits}@s.whatsapp.net`;
        }
      } catch (error) {
        warnings.push(
          `onWhatsApp lookup failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    let lidJid = initialLidJid;
    if (!lidJid && phoneJid) {
      try {
        const lidStore = (sock as any).signalRepository?.lidMapping;
        if (lidStore?.getLIDForPN) {
          const lid = await lidStore.getLIDForPN(phoneJid);
          if (typeof lid === "string" && lid) {
            lidJid = lid.split(":")[0].endsWith("@lid") ? lid.split(":")[0] : lid;
          } else {
            warnings.push("no @lid mapping cached yet — exchange at least one message with this contact first");
          }
        }
      } catch (error) {
        warnings.push(
          `LID lookup failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return {
      input,
      phoneJid,
      lidJid,
      exists,
      warnings
    };
  } finally {
    try {
      sock.ev.removeAllListeners("connection.update");
      sock.end(undefined as any);
    } catch {
      // ignore
    }
  }
}

#!/usr/bin/env bun
/**
 * Preview / test server for the web control panel.
 *
 * Starts the REAL control server (`src/web/control-server.ts`) against a FAKE WhatsApp runtime
 * and a seeded temp working directory, so the panel can be exercised (by hand or by the
 * Playwright suite in tests/e2e/) without a live WhatsApp session or Gemini key.
 *
 *   bun scripts/preview-server.ts [--port 4180] [--scenario default] [--dir /tmp/x] [--reuse]
 *
 * Scenarios (comma-separate to combine, e.g. `unicode,paused`):
 *   default       realistic data: 4 chats, today's traffic, pending Claude events, persona
 *   empty         fresh install — no chats, logs, queue, persona profiles or unknown senders
 *   disconnected  WhatsApp socket closed (sends fail)
 *   needs-qr      WhatsApp waiting for QR pairing
 *   paused        repliesPaused: true in config.yaml
 *   huge          60 chats × 120 messages, 40 groups, long pending queue
 *   unicode       Bengali / Devanagari / Arabic (RTL) / emoji names and very long text
 *   malformed     garbage lines mixed into chats, decisions and the queue jsonl files
 *
 * config.ts resolves data/, persona/ and config.yaml from process.cwd() at import time, so this
 * script chdirs into the temp dir BEFORE importing any Talky module.
 *
 * Test hooks (all inside the working dir):
 *   data/preview-sends.jsonl   every send/session action the fake runtime received
 *   data/preview-state.json    { "connection": "open"|"close"|"connecting", "qr": string|null }
 *                              — re-read on every status call, so tests can flip it live
 *   preview-manifest.json      expected numbers for the seeded data (independent oracle)
 *
 * On ready it prints one line: `PREVIEW_READY {"port":…,"dir":…,"token":…}`.
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify as toYaml } from "yaml";

type Scenario = "default" | "empty" | "disconnected" | "needs-qr" | "paused" | "huge" | "unicode" | "malformed";

const REPO_ROOT = path.resolve(import.meta.dir, "..");

function parseArgs(argv: string[]) {
  const out: { port: number; scenarios: Set<Scenario>; dir: string | null; reuse: boolean } = {
    port: 4180,
    scenarios: new Set<Scenario>(["default"]),
    dir: null,
    reuse: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--port") out.port = Number.parseInt(next(), 10);
    else if (arg === "--scenario") out.scenarios = new Set(next().split(",").map((s) => s.trim()) as Scenario[]);
    else if (arg === "--dir") out.dir = path.resolve(next());
    else if (arg === "--reuse") out.reuse = true;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------------------------

type ChatLine = { ts: Date; role: "incoming" | "outgoing"; sender: string; text: string; user?: boolean };

export const OWN_JID = "919000000001@s.whatsapp.net";
export const DEEP = "919876543210@s.whatsapp.net";
export const PRIYA = "919812345678@s.whatsapp.net";
export const RAHUL_LID = "123456789012345@lid";
export const GROUP = "120363000000000001@g.us";

/** Local-calendar date arithmetic (DST-safe): midnight `daysAgo` local days before `now`. */
function localMidnight(now: Date, daysAgo: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 0, 0, 0, 0);
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A time `daysAgo` local days back at local `hour:minute`, never later than `now`. */
function at(now: Date, daysAgo: number, hour: number, minute = 0): Date {
  const d = localMidnight(now, daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.getTime() > now.getTime() ? new Date(now.getTime() - 60_000) : d;
}

function chatFile(jid: string, lines: ChatLine[]): string {
  const body = lines
    .sort((a, b) => a.ts.getTime() - b.ts.getTime())
    .map((l) => `- ${l.ts.toISOString()} | ${l.role} | ${l.sender}${l.user ? " | user" : ""}\n  ${l.text}\n`)
    .join("");
  return `# Chat: ${jid}\n\n${body}`;
}

function event(
  id: string,
  ts: Date,
  chatJid: string,
  senderJid: string,
  text: string,
  extra: Record<string, unknown> = {}
) {
  return {
    id,
    timestampISO: ts.toISOString(),
    chatJid,
    senderJid,
    senderName: extra.senderName ?? "Deep",
    chatName: extra.chatName ?? extra.senderName ?? "Deep",
    isGroup: chatJid.endsWith("@g.us"),
    mentionedMe: false,
    text,
    ...extra
  };
}

function seed(dir: string, scenarios: Set<Scenario>, now: Date) {
  const data = path.join(dir, "data");
  for (const sub of ["chats", "logs", "claude", "media", "memory"]) mkdirSync(path.join(data, sub), { recursive: true });
  mkdirSync(path.join(dir, "persona", "contacts"), { recursive: true });
  mkdirSync(path.join(dir, "persona", "groups"), { recursive: true });
  writeFileSync(path.join(dir, ".env"), "GEMINI_API_KEY=x\n");

  const empty = scenarios.has("empty");
  const unicode = scenarios.has("unicode");
  const huge = scenarios.has("huge");
  const malformed = scenarios.has("malformed");

  const names = {
    deep: unicode ? "দীপ্তি 🌸 Deep" : "Deep",
    priya: unicode ? "प्रिया शर्मा" : "Priya",
    rahul: unicode ? "محمد رحيم" : "Rahul",
    group: unicode ? "Weekend Plans 🎉 — শনিবার পরিকল্পনা আর অনেক লম্বা গ্রুপের নাম যেটা কখনো শেষ হয় না" : "Weekend Plans"
  };

  const config: Record<string, unknown> = {
    botName: "talky",
    model: "gemini-2.0-flash",
    directChatMode: "allowlist",
    allowedDirectJids: [DEEP, PRIYA],
    allowedGroupJids: [GROUP],
    mutedGroupJids: [],
    selfSenderJids: [],
    dailyMessageLimit: 200,
    claudeMediatorEnabled: true,
    claudeMediatorExclusive: false,
    claudeMediatorChats: [],
    repliesPaused: scenarios.has("paused")
  };

  const manifest = {
    now: now.toISOString(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    today: { received: 0, sentByTalky: 0, sentByYou: 0, replied: 0, silent: 0, claude: 0 },
    hourlyReceived: new Array<number>(24).fill(0),
    /** Last 14 local days, oldest first: { dateISO, received } */
    daily: Array.from({ length: 14 }, (_, i) => ({ dateISO: localDateKey(localMidnight(now, 13 - i)), received: 0 })),
    heatmapTotal: 0,
    /** chat jid → inbound per local day, last 7 days oldest first */
    daily7d: {} as Record<string, number[]>,
    pending: 0,
    chats: [] as string[]
  };

  const chats: Record<string, ChatLine[]> = {};
  const decisions: string[] = [];
  const pending: unknown[] = [];
  const handled: unknown[] = [];

  const addIncoming = (jid: string, sender: string, ts: Date, text: string, decision?: "YES" | "NO") => {
    (chats[jid] ??= []).push({ ts, role: "incoming", sender, text });
    const dayIdx = manifest.daily.findIndex((d) => d.dateISO === localDateKey(ts));
    if (dayIdx >= 0) manifest.daily[dayIdx]!.received += 1;
    const week = manifest.daily7d[jid] ?? (manifest.daily7d[jid] = new Array<number>(7).fill(0));
    if (dayIdx >= 7) {
      week[dayIdx - 7]! += 1;
      manifest.heatmapTotal += 1;
    }
    if (ts.getTime() >= localMidnight(now, 0).getTime()) {
      manifest.today.received += 1;
      manifest.hourlyReceived[ts.getHours()]! += 1;
    }
    if (decision) {
      decisions.push(`- ${ts.toISOString()} | chat=${jid} | sender=${sender} | decision=${decision}`);
      if (ts.getTime() >= localMidnight(now, 0).getTime()) {
        if (decision === "YES") manifest.today.replied += 1;
        else manifest.today.silent += 1;
      }
    }
  };
  const addOutgoing = (jid: string, ts: Date, text: string, user = false) => {
    (chats[jid] ??= []).push({ ts, role: "outgoing", sender: OWN_JID, text, user });
    if (ts.getTime() >= localMidnight(now, 0).getTime()) {
      if (user) manifest.today.sentByYou += 1;
      else manifest.today.sentByTalky += 1;
    }
  };

  if (!empty) {
    // --- Deep: busy DM, today + every day of the last fortnight -------------------------------
    for (let d = 13; d >= 1; d -= 1) {
      addIncoming(DEEP, DEEP, at(now, d, 10, 5), `day ${d} morning ping`, d % 2 ? "YES" : "NO");
      addOutgoing(DEEP, at(now, d, 10, 7), `ok got it`);
      // Just after local midnight — the day-boundary bucket the stats must not shift.
      addIncoming(DEEP, DEEP, at(now, d, 0, 20), `late night msg ${d}`);
    }
    addIncoming(DEEP, DEEP, at(now, 0, 0, 10), "you up? 🌙", "NO");
    addIncoming(DEEP, DEEP, at(now, 0, 9, 0), "hey, did you see the pdf I sent?", "YES");
    addOutgoing(DEEP, at(now, 0, 9, 2), "haan dekha, checking now");
    addOutgoing(DEEP, at(now, 0, 9, 30), "sent from my phone", true);
    addIncoming(
      DEEP,
      DEEP,
      at(now, 0, 9, 40),
      unicode
        ? "আমি কাল আসব না 🙏 — कल मिलते हैं, ठीक है? مرحبا بالعالم ".repeat(12)
        : "also can you check the invoice before friday, the numbers look off ".repeat(8)
    );

    // --- Priya: quieter DM ---------------------------------------------------------------------
    addIncoming(PRIYA, PRIYA, at(now, 3, 18, 0), "movie tonight?", "YES");
    addOutgoing(PRIYA, at(now, 3, 18, 1), "sure 🍿");
    addIncoming(PRIYA, PRIYA, at(now, 0, 7, 15), "good morning ☀️", "NO");

    // --- Rahul: @lid identity, not allowlisted (only history) ----------------------------------
    addIncoming(RAHUL_LID, RAHUL_LID, at(now, 5, 22, 45), "bhai notes bhej de");

    // --- Group ------------------------------------------------------------------------------------
    addIncoming(GROUP, DEEP, at(now, 1, 20, 0), "who's in for saturday?", "NO");
    addIncoming(GROUP, PRIYA, at(now, 0, 8, 30), "@talky are you coming?", "YES");
    addOutgoing(GROUP, at(now, 0, 8, 31), "yes! count me in");

    // --- Pending Claude events: a 2-message DM thread and a group mention with a PDF ----------
    const pdfPath = path.join(data, "media", "2026-06-05T10-15-00-000Z_deep_ABC.pdf");
    writeFileSync(pdfPath, "%PDF-1.4\n% preview fixture\n");
    pending.push(
      event("1000-AAA111", at(now, 0, 9, 0), DEEP, DEEP, "hey, did you see the pdf I sent?", {
        senderName: names.deep,
        chatName: names.deep,
        media: { kind: "document", mimeType: "application/pdf", path: pdfPath, fileName: "notes.pdf", caption: "" }
      }),
      event("1001-AAA222", at(now, 0, 9, 40), DEEP, DEEP, "also can you check the invoice before friday", {
        senderName: names.deep,
        chatName: names.deep
      }),
      event("1002-BBB111", at(now, 0, 8, 30), GROUP, PRIYA, "@talky are you coming?", {
        senderName: names.priya,
        chatName: names.group,
        mentionedMe: true
      })
    );
    handled.push(
      { ...event("0999-OLD001", at(now, 0, 7, 15), PRIYA, PRIYA, "good morning ☀️", { senderName: names.priya, chatName: names.priya }), handledAtISO: at(now, 0, 7, 20).toISOString() },
      { ...event("0998-OLD002", at(now, 2, 11, 0), DEEP, DEEP, "old one", {}), handledAtISO: at(now, 2, 11, 5).toISOString() }
    );
    manifest.today.claude = 3 + 1; // pending today + handled today

    writeFileSync(
      path.join(data, "unauthorized-candidates.json"),
      JSON.stringify(
        {
          "918888888888@s.whatsapp.net": {
            jid: "918888888888@s.whatsapp.net",
            kind: "direct",
            firstSeen: at(now, 1, 12).toISOString(),
            lastSeen: at(now, 0, 6).toISOString(),
            count: 3,
            lastReason: "direct chat not in allowlist",
            name: unicode ? "অচেনা নম্বর" : "Unknown Caller",
            lastPreview: "hello? is this Suman?"
          },
          "120363999999999999@g.us": {
            jid: "120363999999999999@g.us",
            kind: "group",
            firstSeen: at(now, 2, 12).toISOString(),
            lastSeen: at(now, 0, 5).toISOString(),
            count: 12,
            lastReason: "group not in allowlist",
            name: "College Alumni 2019",
            lastPreview: "reunion photos"
          }
        },
        null,
        2
      )
    );

    // --- Persona -------------------------------------------------------------------------------
    writeFileSync(path.join(dir, "persona", "soul.md"), "# Soul\n\nI am Suman. Casual, direct, a bit sarcastic.\n");
    writeFileSync(
      path.join(dir, "persona", "communication_rules.md"),
      "# Communication Rules\n\n- Mostly Hinglish.\n- Short replies, lowercase.\n"
    );
    writeFileSync(path.join(dir, "persona", "recent_memory.md"), "# Recent memory\n\n- Exams next week.\n");
    writeFileSync(path.join(dir, "persona", "contacts", `${DEEP}.md`), `# ${names.deep}\n\nClose friend from college.\n`);
    writeFileSync(path.join(dir, "persona", "groups", `${GROUP}.md`), `# ${names.group}\n\nWeekend plans group.\n`);
  } else {
    // Fresh install: persona scaffold files exist but are empty (what persona:init creates).
    writeFileSync(path.join(dir, "persona", "soul.md"), "");
    writeFileSync(path.join(dir, "persona", "communication_rules.md"), "");
    writeFileSync(path.join(dir, "persona", "recent_memory.md"), "");
  }

  if (huge) {
    for (let c = 0; c < 60; c += 1) {
      const jid = c % 3 === 0 ? `1203630000000${String(c).padStart(5, "0")}@g.us` : `9170000${String(c).padStart(5, "0")}@s.whatsapp.net`;
      for (let m = 0; m < 120; m += 1) {
        const ts = new Date(now.getTime() - (m * 97 + c * 13) * 60_000);
        if (m % 2) addOutgoing(jid, ts, `reply ${m} in chat ${c}`);
        else addIncoming(jid, jid.endsWith("@g.us") ? DEEP : jid, ts, `message ${m} in chat ${c} `.repeat(1 + (m % 5)));
      }
    }
    for (let i = 0; i < 40; i += 1) {
      pending.push(event(`2000-HUGE${i}`, new Date(now.getTime() - i * 60_000), `9170000${String(i).padStart(5, "0")}@s.whatsapp.net`, DEEP, `queued ${i}`, { senderName: `Contact ${i}` }));
    }
  }

  for (const [jid, lines] of Object.entries(chats)) {
    writeFileSync(path.join(data, "chats", `${jid}.md`), chatFile(jid, lines));
  }
  writeFileSync(path.join(data, "logs", "decisions.md"), `# Decision Log\n\n${decisions.join("\n")}${decisions.length ? "\n" : ""}`);
  writeFileSync(path.join(data, "claude", "pending.jsonl"), pending.map((e) => JSON.stringify(e)).join("\n") + (pending.length ? "\n" : ""));
  writeFileSync(path.join(data, "claude", "handled.jsonl"), handled.map((e) => JSON.stringify(e)).join("\n") + (handled.length ? "\n" : ""));

  if (malformed) {
    appendFileSync(path.join(data, "chats", `${DEEP}.md`), "- not a timestamp | sideways | ???\n  junk\n- \n|||\n- 2026-13-45T99:99:99Z | incoming\n");
    writeFileSync(path.join(data, "chats", "garbage.md"), "\u0000\u0001 binary-ish �\n- | | |\n");
    appendFileSync(path.join(data, "logs", "decisions.md"), "- garbage line without fields\n- 2026-01-01 | chat= | decision=\n");
    appendFileSync(path.join(data, "claude", "pending.jsonl"), '{"id": "torn-line", "chatJid": \n[1,2,3]\nnull\n"string"\n');
    appendFileSync(path.join(data, "claude", "handled.jsonl"), "{not json}\n");
  }

  manifest.pending = pending.length;
  manifest.chats = Object.keys(chats);
  writeFileSync(path.join(dir, "config.yaml"), toYaml(config));
  writeFileSync(path.join(dir, "preview-manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(
    path.join(data, "preview-state.json"),
    JSON.stringify({
      connection: scenarios.has("disconnected") ? "close" : scenarios.has("needs-qr") ? "connecting" : "open",
      qr: scenarios.has("needs-qr") ? "2@preview-qr-code-for-pairing,AbCdEf==,GhIjKl==" : null
    })
  );
  return { names };
}

// ---------------------------------------------------------------------------------------------
// Fake runtime
// ---------------------------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir ?? mkdtempSync(path.join(tmpdir(), "talky-preview-"));
  mkdirSync(dir, { recursive: true });
  if (!args.reuse || !existsSync(path.join(dir, "config.yaml"))) {
    seed(dir, args.scenarios, new Date());
  }
  const distLink = path.join(dir, "web-ui", "dist");
  if (!existsSync(distLink)) {
    mkdirSync(path.dirname(distLink), { recursive: true });
    symlinkSync(path.join(REPO_ROOT, "web-ui", "dist"), distLink, "dir");
  }

  process.env.WEB_UI_PORT = String(args.port);
  process.chdir(dir);

  // Imported only now: config.ts snapshots process.cwd() at module load.
  const { loadConfig } = await import("../src/config.js");
  const { appendChatHistory } = await import("../src/storage.js");
  const { splitMediatedText } = await import("../src/reply/parse.js");
  const { toDirectTargetJid } = await import("../src/jid.js");
  const { startControlServer } = await import("../src/web/control-server.js");
  const { loadOrCreateControlToken } = await import("../src/web/auth.js");

  const statePath = path.join(dir, "data", "preview-state.json");
  const sendsPath = path.join(dir, "data", "preview-sends.jsonl");
  const readState = (): { connection: "open" | "close" | "connecting"; qr: string | null } => {
    try {
      return JSON.parse(readFileSync(statePath, "utf-8"));
    } catch {
      return { connection: "open", qr: null };
    }
  };
  const record = (entry: Record<string, unknown>) =>
    appendFileSync(sendsPath, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  const requireOpen = () => {
    if (readState().connection !== "open") throw new Error("WhatsApp socket not connected");
  };

  let config = loadConfig();
  const groups = args.scenarios.has("huge")
    ? Array.from({ length: 40 }, (_, i) => ({ jid: `1203630000000${String(i * 3).padStart(5, "0")}@g.us`, name: `Group ${i}` }))
    : [
        { jid: GROUP, name: args.scenarios.has("unicode") ? "Weekend Plans 🎉 — শনিবার" : "Weekend Plans" },
        { jid: "120363999999999999@g.us", name: "College Alumni 2019" }
      ];

  const runtime = {
    getUiSessionSnapshot() {
      const state = readState();
      return {
        whatsappQr: state.qr,
        whatsappNeedsQr: state.qr !== null,
        whatsappConnected: state.connection === "open",
        whatsappConnection: state.connection,
        whatsappUiNote: state.qr ? "Scan the QR with WhatsApp → Linked devices." : null
      };
    },
    async getGroups(_force = false) {
      return readState().connection === "open" ? groups : [];
    },
    getOwnJid() {
      return OWN_JID;
    },
    async retrieveMemoriesForClaude(scopeJid: string, _query: string, _limit: number) {
      return [{ fact: `${scopeJid} likes chai`, confidence: 0.8, source: "preview" }];
    },
    async retrieveOwnerMemoriesForClaude(_query: string, _limit: number) {
      return [{ fact: "Owner has exams next week", confidence: 0.9, source: "preview" }];
    },
    updateConfig(next: typeof config) {
      config = next;
      record({ action: "updateConfig", repliesPaused: next.repliesPaused });
    },
    isRepliesPaused() {
      return config.repliesPaused === true;
    },
    async sendMediatedText(to: string, text: string) {
      requireOpen();
      const jid = toDirectTargetJid(to);
      const chunks = splitMediatedText(text);
      if (chunks.length === 0) throw new Error("text is empty");
      for (const chunk of chunks) {
        appendChatHistory({ chatJid: jid, senderJid: OWN_JID, timestampISO: new Date().toISOString(), role: "outgoing", text: chunk });
      }
      record({ action: "sendText", to, jid, text, chunks });
      return { jid, parts: chunks.length };
    },
    async sendMediatedFile(a: { to: string; absolutePath: string; fileName?: string; caption?: string }) {
      requireOpen();
      const jid = toDirectTargetJid(a.to);
      record({ action: "sendFile", jid, ...a });
      return { jid, fileName: a.fileName ?? path.basename(a.absolutePath) };
    },
    async repairSession() {
      record({ action: "repairSession" });
    },
    async resetAuthFolderAndReconnect() {
      record({ action: "relink" });
    },
    async factoryResetAndReconnect() {
      record({ action: "factoryReset" });
    }
  };

  // The control server only calls the methods above; the cast documents that this is a fake.
  startControlServer(runtime as unknown as Parameters<typeof startControlServer>[0]);
  const token = loadOrCreateControlToken();
  console.log(`PREVIEW_READY ${JSON.stringify({ port: args.port, dir, token, pid: process.pid })}`);
}

if (import.meta.main) {
  await main();
}

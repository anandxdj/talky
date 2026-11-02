/**
 * Promo preview server: runs the REAL Talky control server (src/web/control-server.ts)
 * and the REAL built web panel (web-ui/dist) against a fake WhatsApp runtime and a
 * seeded, entirely fictional data set — so the promo can film the actual UI without
 * a WhatsApp account.
 *
 *   bun promo/scripts/preview-server.ts [--port 4319] [--dir <tmpdir>]
 *
 * Prints one JSON line on stdout once ready: { ready, url, port, dir, tz, token }.
 *
 * Determinism: all sample data comes from a seeded PRNG. The server picks a time zone
 * (Etc/GMT±N) so that "now" is ~20:40 local time, which keeps the "today, hour by hour"
 * chart full no matter when the capture runs. Capture with the same `tz` in the browser.
 *
 * Every name and number here is a placeholder (+1 555-01xx numbers are reserved for fiction).
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..", "..");
const args = process.argv.slice(2);
const argOf = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const PORT = Number(argOf("--port", "4319"));
const TARGET_LOCAL_HOUR = 20; // "now" lands at ~20:xx local

// ---------- time zone so that local time is evening ----------
function pickTimeZone(): { tz: string; offsetH: number } {
  const utcHour = new Date().getUTCHours();
  let offset = (TARGET_LOCAL_HOUR - utcHour + 24) % 24; // 0..23
  if (offset > 14) offset -= 24; // valid Etc/GMT range is -12..+14
  // Etc/GMT sign is inverted: Etc/GMT-5 == UTC+5.
  const tz = offset === 0 ? "Etc/UTC" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
  return { tz, offsetH: offset };
}
const { tz: TZ } = pickTimeZone();
process.env.TZ = TZ;

// ---------- temp working dir (config.ts resolves data/ etc. from process.cwd()) ----------
const DIR = argOf("--dir", "") || mkdtempSync(join(tmpdir(), "talky-promo-"));
if (existsSync(join(DIR, "data"))) rmSync(join(DIR, "data"), { recursive: true, force: true });
for (const d of ["data/chats", "data/logs", "data/claude", "data/memory", "persona/contacts", "persona/groups", "web-ui"]) {
  mkdirSync(join(DIR, d), { recursive: true });
}
const distLink = join(DIR, "web-ui", "dist");
if (!existsSync(distLink)) symlinkSync(join(REPO, "web-ui", "dist"), distLink, "dir");

// ---------- seeded PRNG ----------
let seed = 20261102;
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const between = (a: number, b: number) => a + rand() * (b - a);

// ---------- cast (all fictional) ----------
const OWNER = "15550100000@s.whatsapp.net";
type Chat = {
  jid: string;
  name: string;
  isGroup: boolean;
  weight: number; // relative traffic
  weekendBias: number; // >1 = busier on weekends
  members?: Array<{ jid: string; name: string }>;
  incoming: readonly string[];
};
const RIYA = "15550100001@s.whatsapp.net";
const ARJUN = "15550100002@s.whatsapp.net";
const MUM = "15550100003@s.whatsapp.net";
const WORK = "120363000000000001@g.us";
const COLLEGE = "120363000000000002@g.us";

const CHATS: Chat[] = [
  {
    jid: RIYA, name: "Riya", isGroup: false, weight: 1.25, weekendBias: 1.3,
    incoming: [
      "hey! free this weekend?", "did you finish the book yet 📚", "lol same", "ok wait sending the link",
      "kal coffee? ☕", "omg you have to see this", "haha no way", "how was the interview??",
      "missing our goa trip ngl", "call later?", "send me that playlist pls 🎧", "accha listen",
    ],
  },
  {
    jid: ARJUN, name: "Arjun", isGroup: false, weight: 0.9, weekendBias: 1.5,
    incoming: [
      "bro match dekha?", "gym tomorrow 7am?", "send the notes yaar", "😂😂", "where are you",
      "bhai ps5 lena hai kya", "free for a quick call?", "ok done", "kya scene hai aaj",
    ],
  },
  {
    jid: MUM, name: "Mum", isGroup: false, weight: 0.7, weekendBias: 1.2,
    incoming: [
      "Beta, did you eat?", "Call me when you are free", "Papa is asking about Sunday",
      "Good morning 🌸", "Take an umbrella, it will rain", "Did you reach home?", "Sending aunty's number",
    ],
  },
  {
    jid: WORK, name: "Product squad", isGroup: true, weight: 1.5, weekendBias: 0.25,
    members: [
      { jid: "15550100011@s.whatsapp.net", name: "Neha" },
      { jid: "15550100012@s.whatsapp.net", name: "Kabir" },
      { jid: "15550100013@s.whatsapp.net", name: "Meera" },
    ],
    incoming: [
      "standup in 10", "pushed the fix, can someone review?", "deploy is green ✅", "who has the figma link",
      "lunch order?", "moving the sync to 4pm", "metrics look good this week", "PR is up 🙏",
    ],
  },
  {
    jid: COLLEGE, name: "CSE '22 gang", isGroup: true, weight: 1.1, weekendBias: 1.8,
    members: [
      { jid: "15550100021@s.whatsapp.net", name: "Dev" },
      { jid: "15550100022@s.whatsapp.net", name: "Ishaan" },
      { jid: "15550100023@s.whatsapp.net", name: "Tara" },
    ],
    incoming: [
      "reunion plan kab?", "😂😂😂", "who's coming saturday", "guys check this meme", "throwback 📸",
      "goa again?", "happy birthday Tara!! 🎉", "itna late kaun reply karta hai",
    ],
  },
];

// The owner's own style (manual) vs Talky's replies in the same voice: similar length,
// lowercase, light emoji. That similarity is what the "Voice" page shows.
const YOU_LINES = [
  "Haan done", "Sure, I'll check and get back to you tonight", "wait let me see what time the show starts and i'll tell you",
  "Ok will do 👍", "honestly just tired, long day at work but all good 🙂", "haan done", "yes!! let's do it", "ok will call in 10", "lol", "sending now", "omw 🏃",
  "sure, 7 works", "haha true", "na yaar, next week?", "ate already, don't worry ma", "nice 🙌",
  "link bhej", "kal pakka", "yep", "ha ha", "in a meeting, call you after",
];
const TALKY_LINES = [
  "Sure, I'll check and tell you by tonight", "Ok will do", "let me check what time it starts and i'll tell you",
  "long day but all good, just tired 🙂", "Haan done", "haan sure, 7 works", "yes!! count me in", "will call you in 10", "haha", "sending it now",
  "omw 🏃", "ok done", "lol true", "next week? this one's packed", "ate already ma, don't worry",
  "nice 🙌", "bhej raha hu", "kal pakka", "yep", "sounds good", "reviewing it now",
];

// ---------- activity curve ----------
// Inbound messages per hour (relative). Morning bump, lunch, big evening peak.
const HOUR_SHAPE = [
  0.15, 0.08, 0.04, 0.02, 0.02, 0.05, 0.25, 0.7, 1.1, 1.3, 1.25, 1.2, 1.5, 1.3, 1.05, 1.0, 1.1, 1.3,
  1.6, 1.9, 2.1, 1.9, 1.3, 0.6,
];
const DAY_MS = 86_400_000;
const now = Date.now();
const todayStart = (() => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); })();
const DAYS = 32;

type Line = { ms: number; role: "incoming" | "outgoing"; sender: string; text: string; manual?: boolean };
const chatLines = new Map<string, Line[]>(CHATS.map((c) => [c.jid, []]));
const decisions: string[] = [];
const handled: object[] = [];
let idSeq = 0;
const eventId = (ms: number) => `${ms}-${(0xabc000 + ++idSeq).toString(16).toUpperCase()}PROMO`;

for (let day = DAYS - 1; day >= 0; day -= 1) {
  const dayStart = todayStart - day * DAY_MS;
  const weekday = new Date(dayStart + DAY_MS / 2).getDay(); // 0=Sun
  const weekend = weekday === 0 || weekday === 6;
  for (let hour = 0; hour < 24; hour += 1) {
    for (const chat of CHATS) {
      const lambda = HOUR_SHAPE[hour]! * chat.weight * (weekend ? chat.weekendBias : 1) * 0.55;
      // Poisson-ish draw
      let n = 0;
      let p = Math.exp(-lambda);
      let acc = p;
      const u = rand();
      while (u > acc && n < 8) { n += 1; p *= lambda / n; acc += p; }
      for (let k = 0; k < n; k += 1) {
        const ms = Math.floor(dayStart + hour * 3_600_000 + between(0, 3_500_000));
        if (ms > now - 4 * 60_000) continue; // nothing in the last few minutes (the queue covers that)
        const sender = chat.isGroup ? pick(chat.members!).jid : chat.jid;
        const text = pick(chat.incoming);
        chatLines.get(chat.jid)!.push({ ms, role: "incoming", sender, text });

        // What happened next?
        const r = rand();
        const mentioned = chat.isGroup && rand() < 0.22;
        if (!chat.isGroup || mentioned) {
          if (r < 0.5) {
            // Talky replied in your voice
            const replyMs = ms + Math.floor(between(18_000, 160_000));
            if (replyMs < now) {
              chatLines.get(chat.jid)!.push({ ms: replyMs, role: "outgoing", sender: OWNER, text: pick(TALKY_LINES) });
              if (rand() < 0.3) chatLines.get(chat.jid)!.push({ ms: replyMs + 9_000, role: "outgoing", sender: OWNER, text: pick(TALKY_LINES) });
              decisions.push(`- ${new Date(ms + 1500).toISOString()} | chat=${chat.jid} | sender=${sender} | decision=YES`);
            }
          } else if (r < 0.7) {
            // Handed to the Claude mediator queue, answered from there
            const handledMs = ms + Math.floor(between(40_000, 400_000));
            if (handledMs < now) {
              const senderName = chat.isGroup ? chat.members!.find((m) => m.jid === sender)!.name : chat.name;
              handled.push({
                id: eventId(ms), timestampISO: new Date(ms).toISOString(), chatJid: chat.jid, senderJid: sender,
                senderName, chatName: chat.name, isGroup: chat.isGroup, mentionedMe: mentioned, text,
                handledAtISO: new Date(handledMs).toISOString(),
              });
              chatLines.get(chat.jid)!.push({ ms: handledMs, role: "outgoing", sender: OWNER, text: pick(TALKY_LINES) });
            }
          } else if (r < 0.93) {
            // You answered yourself from the phone
            const replyMs = ms + Math.floor(between(60_000, 900_000));
            if (replyMs < now) {
              chatLines.get(chat.jid)!.push({ ms: replyMs, role: "outgoing", sender: OWNER, text: pick(YOU_LINES), manual: true });
              if (rand() < 0.4) chatLines.get(chat.jid)!.push({ ms: replyMs + 12_000, role: "outgoing", sender: OWNER, text: pick(YOU_LINES), manual: true });
            }
            decisions.push(`- ${new Date(ms + 1500).toISOString()} | chat=${chat.jid} | sender=${sender} | decision=NO`);
          } else {
            decisions.push(`- ${new Date(ms + 1500).toISOString()} | chat=${chat.jid} | sender=${sender} | decision=NO`);
          }
        } else {
          decisions.push(`- ${new Date(ms + 1500).toISOString()} | chat=${chat.jid} | sender=${sender} | decision=NO`);
          if (rand() < 0.12) {
            const replyMs = ms + Math.floor(between(60_000, 1_200_000));
            if (replyMs < now) chatLines.get(chat.jid)!.push({ ms: replyMs, role: "outgoing", sender: OWNER, text: pick(YOU_LINES), manual: true });
          }
        }
      }
    }
  }
}

// ---------- the live queue: a few messages waiting right now ----------
const ago = (min: number) => now - min * 60_000;
const pending = [
  { min: 2, chat: RIYA, sender: RIYA, senderName: "Riya", chatName: "Riya", isGroup: false, mentionedMe: false,
    text: "are we still on for dinner tonight? 🍜" },
  { min: 7, chat: MUM, sender: MUM, senderName: "Mum", chatName: "Mum", isGroup: false, mentionedMe: false,
    text: "Beta call me when you are free, Papa wants to plan Sunday" },
  { min: 12, chat: WORK, sender: "15550100011@s.whatsapp.net", senderName: "Neha", chatName: "Product squad", isGroup: true,
    mentionedMe: true, text: "@Sam can you take a look at the PR before standup?" },
  { min: 26, chat: ARJUN, sender: ARJUN, senderName: "Arjun", chatName: "Arjun", isGroup: false, mentionedMe: false,
    text: "bro match dekha kal? that last over 😂" },
].map((p) => ({
  id: eventId(ago(p.min)), timestampISO: new Date(ago(p.min)).toISOString(), chatJid: p.chat, senderJid: p.sender,
  senderName: p.senderName, chatName: p.chatName, isGroup: p.isGroup, mentionedMe: p.mentionedMe, text: p.text,
}));
// A little recent context so the conversation pane reads naturally.
chatLines.get(RIYA)!.push(
  { ms: ago(48), role: "incoming", sender: RIYA, text: "finally done with work 😮‍💨" },
  { ms: ago(47), role: "outgoing", sender: OWNER, text: "same, what a day" },
  { ms: ago(46), role: "incoming", sender: RIYA, text: "that ramen place near your office opened btw" },
  { ms: ago(45), role: "outgoing", sender: OWNER, text: "ooh let's go tonight?" },
);
for (const p of pending) {
  chatLines.get(p.chatJid)!.push({ ms: Date.parse(p.timestampISO), role: "incoming", sender: p.senderJid, text: p.text });
}

// ---------- write files ----------
for (const chat of CHATS) {
  const lines = chatLines.get(chat.jid)!.sort((a, b) => a.ms - b.ms);
  const body = lines
    .map((l) => `- ${new Date(l.ms).toISOString()} | ${l.role} | ${l.sender}${l.role === "outgoing" && l.manual ? " | user" : ""}\n  ${l.text}\n`)
    .join("");
  writeFileSync(join(DIR, "data/chats", `${chat.jid}.md`), `# Chat: ${chat.jid}\n${body}`);
}
decisions.sort();
writeFileSync(join(DIR, "data/logs/decisions.md"), `# Decisions\n${decisions.join("\n")}\n`);
writeFileSync(join(DIR, "data/claude/pending.jsonl"), pending.map((e) => JSON.stringify(e)).join("\n") + "\n");
writeFileSync(join(DIR, "data/claude/handled.jsonl"), handled.map((e) => JSON.stringify(e)).join("\n") + "\n");
writeFileSync(
  join(DIR, "data/claude/signal.json"),
  JSON.stringify({ seq: pending.length, pendingCount: pending.length, lastEventAtISO: pending[0]!.timestampISO }),
);

writeFileSync(
  join(DIR, "config.yaml"),
  `botName: talky
model: gemini-2.5-flash
runtimeLogMode: minimal
directChatMode: allowlist
recordManualOutboundMessages: true
selfSenderJids:
  - ${OWNER}
allowedGroupJids:
  - ${WORK}
  - ${COLLEGE}
allowedDirectJids:
  - ${RIYA}
  - ${ARJUN}
  - ${MUM}
dailyMessageLimit: 150
claudeMediatorEnabled: true
claudeMediatorExclusive: true
claudeMediatorChats: []
repliesPaused: false
`,
);
writeFileSync(join(DIR, ".env"), "GEMINI_API_KEY=x\n");
writeFileSync(
  join(DIR, "persona/soul.md"),
  `# Soul\n\nI'm Sam. Warm, quick, a bit sarcastic with friends. I keep things short and I never sound like a bot.\n`,
);
writeFileSync(
  join(DIR, "persona/communication_rules.md"),
  `# Communication rules\n\n- Mostly lowercase, short lines, one thought per message.\n- Hinglish with friends, plain English at work.\n- At most one emoji, and only when it fits.\n- With Mum: always respectful, always reply.\n`,
);
writeFileSync(
  join(DIR, "persona/recent_memory.md"),
  `# Recent Memory\n\n- Current priorities: launch week at work\n- Ongoing commitments: dinner with Riya, Sunday lunch with family\n`,
);
writeFileSync(join(DIR, `persona/contacts/${RIYA}.md`), `# Riya\n\nClose friend since college. Food plans, books, playlists.\n`);
writeFileSync(join(DIR, `persona/contacts/${MUM}.md`), `# Mum\n\nCall back when she asks. Never one-word replies.\n`);
writeFileSync(join(DIR, `persona/groups/${WORK}.md`), `# Product squad\n\nWork group. Reply only when mentioned; English, no slang.\n`);

// ---------- start the real control server with a fake runtime ----------
process.chdir(DIR);
process.env.WEB_UI_PORT = String(PORT);

let config: Record<string, unknown> | null = null;
const fakeRuntime = {
  getUiSessionSnapshot: () => ({
    whatsappQr: null, whatsappNeedsQr: false, whatsappConnected: true, whatsappConnection: "open", whatsappUiNote: null,
  }),
  getGroups: async () => [
    { jid: WORK, name: "Product squad" },
    { jid: COLLEGE, name: "CSE '22 gang" },
  ],
  getOwnJid: () => OWNER,
  retrieveMemoriesForClaude: async () => [],
  retrieveOwnerMemoriesForClaude: async () => [],
  updateConfig: (cfg: Record<string, unknown>) => { config = cfg; },
  isRepliesPaused: () => Boolean((config as { repliesPaused?: boolean } | null)?.repliesPaused),
  sendMediatedText: async (to: string, text: string) => {
    const jid = to.includes("@") ? to : `${to.replace(/\D/g, "")}@s.whatsapp.net`;
    const parts = text.split("|||").map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      appendFileSync(join(DIR, "data/chats", `${jid}.md`), `- ${new Date().toISOString()} | outgoing | ${OWNER} | user\n  ${part}\n`);
    }
    return { jid, parts: parts.length };
  },
  sendMediatedFile: async () => ({ ok: true }),
  repairSession: async () => {},
  factoryResetAndReconnect: async () => {},
  resetAuthFolderAndReconnect: async () => {},
};

const { loadConfig } = await import(join(REPO, "src/config.ts"));
config = loadConfig();
const { startControlServer } = await import(join(REPO, "src/web/control-server.ts"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
startControlServer(fakeRuntime as any);

// Wait for the token file, then announce readiness.
const { readFileSync } = await import("node:fs");
let token = "";
for (let i = 0; i < 50 && !token; i += 1) {
  try { token = readFileSync(join(DIR, "data/control-token"), "utf-8").trim(); } catch { await Bun.sleep(100); }
}
console.log(JSON.stringify({ ready: true, url: `http://127.0.0.1:${PORT}`, port: PORT, dir: DIR, tz: TZ, token }));

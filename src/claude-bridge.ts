import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { DATA_DIR } from "./config";
import type { AppConfig, IncomingMedia } from "./types";
import { sanitizeJid } from "./utils";

/**
 * Claude mediator bridge.
 *
 * Talky's message loop enqueues every allowed inbound message here so an external
 * Claude Code agent can act as the responder through Talky's live Baileys session:
 *   - data/claude/pending.jsonl  — events waiting for Claude (one JSON object per line)
 *   - data/claude/handled.jsonl  — acked events (audit trail)
 *   - data/claude/signal.json    — cheap poll target: { seq, pendingCount, lastEventAtISO }
 *   - data/media/                — incoming attachments persisted to disk
 *
 * Claude consumes the queue via the /api/claude/* control-server endpoints (or the
 * files directly) and replies via POST /api/claude/send. See CLAUDE.md.
 */

export const CLAUDE_BRIDGE_DIR = path.join(DATA_DIR, "claude");
export const CLAUDE_PENDING_PATH = path.join(CLAUDE_BRIDGE_DIR, "pending.jsonl");
export const CLAUDE_HANDLED_PATH = path.join(CLAUDE_BRIDGE_DIR, "handled.jsonl");
export const CLAUDE_SIGNAL_PATH = path.join(CLAUDE_BRIDGE_DIR, "signal.json");
export const MEDIA_INBOX_DIR = path.join(DATA_DIR, "media");

export type ClaudeBridgeMedia = {
  kind: IncomingMedia["kind"];
  mimeType: string;
  /** Absolute path of the saved attachment under data/media/. */
  path: string;
  fileName?: string;
  caption?: string;
};

export type ClaudeBridgeEvent = {
  id: string;
  timestampISO: string;
  chatJid: string;
  senderJid: string;
  /** Display name of the sender (push name / contact store), when known. */
  senderName?: string;
  /** Group subject or contact display name for the chat, when known. */
  chatName?: string;
  isGroup: boolean;
  mentionedMe: boolean;
  /** Transcribed text (or plain text). For voice notes this is the Gemini transcription. */
  text: string;
  /** True when text is a Gemini transcription of a voice note, not the original text message. */
  voiceTranscript?: boolean;
  media?: ClaudeBridgeMedia;
};

/**
 * Effective on-disk locations. Default to the exported constants above; tests may point the
 * bridge at a temp directory via setClaudeBridgeDataDirForTests(). Production never changes them.
 */
type BridgePaths = {
  bridgeDir: string;
  pendingPath: string;
  handledPath: string;
  signalPath: string;
  mediaDir: string;
};

const DEFAULT_BRIDGE_PATHS: BridgePaths = {
  bridgeDir: CLAUDE_BRIDGE_DIR,
  pendingPath: CLAUDE_PENDING_PATH,
  handledPath: CLAUDE_HANDLED_PATH,
  signalPath: CLAUDE_SIGNAL_PATH,
  mediaDir: MEDIA_INBOX_DIR
};

let bridgePaths: BridgePaths = DEFAULT_BRIDGE_PATHS;

/**
 * Test-only hook: use `<dataDir>/claude/*` and `<dataDir>/media/` instead of the real data/
 * directory. Pass null to restore the defaults.
 */
export function setClaudeBridgeDataDirForTests(dataDir: string | null): void {
  if (dataDir === null) {
    bridgePaths = DEFAULT_BRIDGE_PATHS;
    return;
  }
  const bridgeDir = path.join(dataDir, "claude");
  bridgePaths = {
    bridgeDir,
    pendingPath: path.join(bridgeDir, "pending.jsonl"),
    handledPath: path.join(bridgeDir, "handled.jsonl"),
    signalPath: path.join(bridgeDir, "signal.json"),
    mediaDir: path.join(dataDir, "media")
  };
}

function ensureBridgeDirs(): void {
  for (const dir of [bridgePaths.bridgeDir, bridgePaths.mediaDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

function readJsonlEvents(filePath: string): ClaudeBridgeEvent[] {
  if (!existsSync(filePath)) return [];
  const events: ClaudeBridgeEvent[] = [];
  for (const line of readFileSync(filePath, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as ClaudeBridgeEvent;
      if (parsed && typeof parsed.id === "string" && typeof parsed.chatJid === "string") {
        events.push(parsed);
      }
    } catch {
      // skip corrupt line (e.g. a partial write from a crash)
    }
  }
  return events;
}

/**
 * Replace `filePath` atomically: write a sibling temp file, then rename it over the target, so
 * readers (the HTTP API, scripts/wait-for-events.ts) and a crash mid-write can only ever see the
 * complete old or complete new content — never a truncated queue. If the rename fails
 * (e.g. Windows refusing to replace a file another process holds open), fall back to the previous
 * direct write rather than failing the caller.
 */
function writeFileAtomicSync(filePath: string, content: string): void {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmpPath, content, "utf-8");
  try {
    renameSync(tmpPath, filePath);
    return;
  } catch {
    // fall through to the non-atomic write below (previous behaviour)
  }
  try {
    writeFileSync(filePath, content, "utf-8");
  } finally {
    rmSync(tmpPath, { force: true });
  }
}

/**
 * If a previous process crashed mid-append, the file may end in a partial line with no newline.
 * Appending straight after it would glue the next (valid) event onto that corrupt line and lose it,
 * so terminate the partial line first. The partial line itself is skipped by readJsonlEvents.
 */
function terminatePartialLastLine(filePath: string): void {
  if (!existsSync(filePath)) return;
  const fd = openSync(filePath, "r");
  try {
    const { size } = fstatSync(fd);
    if (size === 0) return;
    const last = Buffer.alloc(1);
    readSync(fd, last, 0, 1, size - 1);
    if (last[0] === 0x0a) return;
  } finally {
    closeSync(fd);
  }
  appendFileSync(filePath, "\n", "utf-8");
}

function bumpSignal(pendingCount: number, lastEventAtISO: string): void {
  let seq = 0;
  try {
    if (existsSync(bridgePaths.signalPath)) {
      const prior = JSON.parse(readFileSync(bridgePaths.signalPath, "utf-8")) as { seq?: number };
      seq = typeof prior.seq === "number" ? prior.seq : 0;
    }
  } catch {
    // start fresh on corrupt signal file
  }
  writeFileAtomicSync(
    bridgePaths.signalPath,
    JSON.stringify({ seq: seq + 1, pendingCount, lastEventAtISO }, null, 2)
  );
}

/*
 * Concurrency model: Talky is a single process and every queue mutation below (enqueue and
 * ack) is one fully synchronous read-modify-write with no `await` inside. JavaScript's
 * run-to-completion semantics therefore guarantee an enqueue from the WhatsApp handler can
 * never land between ack's read of pending.jsonl and its rewrite — the two cannot interleave.
 * Keep these functions synchronous: introducing async I/O here would reopen that race and
 * would need an explicit mutex. Cross-process writers are not supported (the watcher script
 * only reads, and src/lock.ts prevents two Talky instances).
 */

export function enqueueClaudeEvent(event: ClaudeBridgeEvent): void {
  ensureBridgeDirs();
  terminatePartialLastLine(bridgePaths.pendingPath);
  appendFileSync(bridgePaths.pendingPath, `${JSON.stringify(event)}\n`, "utf-8");
  bumpSignal(listPendingClaudeEvents().length, event.timestampISO);
}

export function listPendingClaudeEvents(): ClaudeBridgeEvent[] {
  return readJsonlEvents(bridgePaths.pendingPath);
}

/** Remove acked events from pending.jsonl and archive them to handled.jsonl. Returns how many were acked. */
export function ackClaudeEvents(ids: string[]): number {
  ensureBridgeDirs();
  const ackSet = new Set(ids.map((id) => id.trim()).filter(Boolean));
  if (ackSet.size === 0) return 0;
  const pending = listPendingClaudeEvents();
  const remaining = pending.filter((event) => !ackSet.has(event.id));
  const acked = pending.filter((event) => ackSet.has(event.id));
  if (acked.length === 0) return 0;
  // Remove from pending first (atomically), then archive. If the process dies in between, the
  // event is missing from the audit log rather than redelivered — an ack means the reply was
  // already sent, so redelivery would risk a duplicate message to the contact.
  writeFileAtomicSync(
    bridgePaths.pendingPath,
    remaining.map((event) => JSON.stringify(event)).join("\n") + (remaining.length > 0 ? "\n" : "")
  );
  const handledAtISO = new Date().toISOString();
  terminatePartialLastLine(bridgePaths.handledPath);
  appendFileSync(
    bridgePaths.handledPath,
    acked.map((event) => `${JSON.stringify({ ...event, handledAtISO })}\n`).join(""),
    "utf-8"
  );
  bumpSignal(remaining.length, handledAtISO);
  return acked.length;
}

const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/3gpp": ".3gp",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/wav": ".wav",
  "application/pdf": ".pdf"
};

function extensionForMedia(media: IncomingMedia): string {
  if (media.fileName) {
    const ext = path.extname(media.fileName);
    if (ext) return ext.toLowerCase();
  }
  const base = media.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_EXTENSION_MAP[base] ?? ".bin";
}

/** Persist an incoming attachment to data/media/ and return its absolute path. */
export function saveIncomingMediaToDisk(
  media: IncomingMedia,
  chatJid: string,
  messageId?: string
): string {
  ensureBridgeDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const idPart = (messageId ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) || "msg";
  const fileName = `${stamp}_${sanitizeJid(chatJid)}_${idPart}${extensionForMedia(media)}`;
  const absolutePath = path.join(bridgePaths.mediaDir, fileName);
  writeFileSync(absolutePath, media.bytes);
  return absolutePath;
}

let lastTriggerSpawnAtMs = 0;

/**
 * Spawn the configured trigger command (detached, fire-and-forget) so an external
 * Claude agent wakes up. Debounced by claudeTriggerCooldownSeconds — pending events
 * accumulate in the queue either way, so a single wake-up drains them all.
 */
export function maybeSpawnClaudeTrigger(
  config: AppConfig,
  onWarn?: (message: string) => void
): boolean {
  // Paused: events still queue, but nothing is woken up to answer them.
  if (config.repliesPaused === true) return false;
  const command = config.claudeTriggerCommand.trim();
  if (!command) return false;
  const now = Date.now();
  if (now - lastTriggerSpawnAtMs < config.claudeTriggerCooldownSeconds * 1000) return false;
  lastTriggerSpawnAtMs = now;
  try {
    const child = spawn(command, {
      shell: true,
      detached: true,
      stdio: "ignore",
      cwd: process.cwd()
    });
    child.unref();
    return true;
  } catch (error) {
    onWarn?.(error instanceof Error ? error.message : String(error));
    return false;
  }
}

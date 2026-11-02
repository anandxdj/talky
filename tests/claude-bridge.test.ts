import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CLAUDE_PENDING_PATH,
  ackClaudeEvents,
  enqueueClaudeEvent,
  listPendingClaudeEvents,
  saveIncomingMediaToDisk,
  setClaudeBridgeDataDirForTests,
  type ClaudeBridgeEvent
} from "../src/claude-bridge";

let dataDir = "";
let pendingPath = "";
let handledPath = "";
let signalPath = "";

function makeEvent(id: string, overrides: Partial<ClaudeBridgeEvent> = {}): ClaudeBridgeEvent {
  return {
    id,
    timestampISO: "2026-06-05T10:15:00.000Z",
    chatJid: "919876543210@s.whatsapp.net",
    senderJid: "919876543210@s.whatsapp.net",
    isGroup: false,
    mentionedMe: false,
    text: `msg ${id}`,
    ...overrides
  };
}

function readJsonl(filePath: string): any[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function readSignal(): { seq: number; pendingCount: number; lastEventAtISO: string } {
  return JSON.parse(readFileSync(signalPath, "utf-8"));
}

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "talky-bridge-"));
  setClaudeBridgeDataDirForTests(dataDir);
  pendingPath = path.join(dataDir, "claude", "pending.jsonl");
  handledPath = path.join(dataDir, "claude", "handled.jsonl");
  signalPath = path.join(dataDir, "claude", "signal.json");
});

afterEach(() => {
  setClaudeBridgeDataDirForTests(null);
  rmSync(dataDir, { recursive: true, force: true });
});

describe("claude bridge queue", () => {
  test("test hook redirects away from the real data dir", () => {
    expect(pendingPath).not.toBe(CLAUDE_PENDING_PATH);
    enqueueClaudeEvent(makeEvent("a"));
    expect(existsSync(pendingPath)).toBe(true);
  });

  test("enqueue appends one JSON line per event and bumps the signal", () => {
    expect(listPendingClaudeEvents()).toEqual([]);
    enqueueClaudeEvent(makeEvent("a"));
    enqueueClaudeEvent(makeEvent("b", { timestampISO: "2026-06-05T10:16:00.000Z" }));
    expect(listPendingClaudeEvents().map((e) => e.id)).toEqual(["a", "b"]);
    expect(readFileSync(pendingPath, "utf-8").split("\n")).toHaveLength(3); // 2 lines + trailing ""
    expect(readSignal()).toEqual({
      seq: 2,
      pendingCount: 2,
      lastEventAtISO: "2026-06-05T10:16:00.000Z"
    });
  });

  test("ack removes only the acked events, archives them with handledAtISO and keeps order", () => {
    for (const id of ["a", "b", "c", "d"]) enqueueClaudeEvent(makeEvent(id));
    expect(ackClaudeEvents(["b", " d ", "zzz"])).toBe(2);
    expect(listPendingClaudeEvents().map((e) => e.id)).toEqual(["a", "c"]);
    const handled = readJsonl(handledPath);
    expect(handled.map((e) => e.id)).toEqual(["b", "d"]);
    expect(typeof handled[0].handledAtISO).toBe("string");
    expect(handled[0]).toMatchObject(makeEvent("b"));
    expect(readSignal()).toMatchObject({ seq: 5, pendingCount: 2 });
  });

  test("acking everything leaves an empty pending file", () => {
    enqueueClaudeEvent(makeEvent("a"));
    expect(ackClaudeEvents(["a"])).toBe(1);
    expect(readFileSync(pendingPath, "utf-8")).toBe("");
    expect(listPendingClaudeEvents()).toEqual([]);
  });

  test("ack with no/blank/unknown ids is a no-op that does not touch the files", () => {
    enqueueClaudeEvent(makeEvent("a"));
    const before = readFileSync(pendingPath, "utf-8");
    const seqBefore = readSignal().seq;
    expect(ackClaudeEvents([])).toBe(0);
    expect(ackClaudeEvents(["", "  "])).toBe(0);
    expect(ackClaudeEvents(["nope"])).toBe(0);
    expect(readFileSync(pendingPath, "utf-8")).toBe(before);
    expect(readSignal().seq).toBe(seqBefore);
    expect(existsSync(handledPath)).toBe(false);
  });

  test("ack on a missing queue returns 0", () => {
    expect(ackClaudeEvents(["a"])).toBe(0);
  });

  test("rewrites leave no temp files behind", () => {
    for (const id of ["a", "b", "c"]) enqueueClaudeEvent(makeEvent(id));
    ackClaudeEvents(["a", "c"]);
    const files = readdirSync(path.join(dataDir, "claude")).sort();
    expect(files).toEqual(["handled.jsonl", "pending.jsonl", "signal.json"]);
  });

  test("malformed and incomplete lines are skipped, not thrown", () => {
    enqueueClaudeEvent(makeEvent("a"));
    appendFileSync(pendingPath, "{not json}\n\n   \n");
    appendFileSync(pendingPath, `${JSON.stringify({ hello: "no id" })}\n`);
    appendFileSync(pendingPath, `${JSON.stringify({ id: 5, chatJid: "x" })}\n`);
    enqueueClaudeEvent(makeEvent("b"));
    expect(listPendingClaudeEvents().map((e) => e.id)).toEqual(["a", "b"]);
    expect(ackClaudeEvents(["a"])).toBe(1);
    expect(listPendingClaudeEvents().map((e) => e.id)).toEqual(["b"]);
  });

  test("an event enqueued after a crash-truncated line (no trailing newline) is not lost", () => {
    enqueueClaudeEvent(makeEvent("a"));
    appendFileSync(pendingPath, '{"id":"partial","chatJid":"91'); // crash mid-append
    enqueueClaudeEvent(makeEvent("b"));
    expect(listPendingClaudeEvents().map((e) => e.id)).toEqual(["a", "b"]);
  });

  test("corrupt signal file restarts the sequence instead of throwing", () => {
    enqueueClaudeEvent(makeEvent("a"));
    writeFileSync(signalPath, "{broken");
    enqueueClaudeEvent(makeEvent("b"));
    expect(readSignal()).toMatchObject({ seq: 1, pendingCount: 2 });
  });

  test("interleaved enqueue/ack across async tasks never loses or duplicates an event", async () => {
    const total = 120;
    const enqueued: string[] = [];
    const producer = (async () => {
      for (let i = 0; i < total; i += 1) {
        const id = `e${i}`;
        enqueueClaudeEvent(makeEvent(id));
        enqueued.push(id);
        await Promise.resolve();
        if (i % 7 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
    })();
    const consumer = (async () => {
      for (let round = 0; round < 60; round += 1) {
        const ids = listPendingClaudeEvents()
          .map((e) => e.id)
          .filter((_, index) => index % 2 === 0);
        ackClaudeEvents(ids);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    })();
    await Promise.all([producer, consumer]);

    const pendingIds = listPendingClaudeEvents().map((e) => e.id);
    const handledIds = readJsonl(handledPath).map((e) => e.id);
    const all = [...pendingIds, ...handledIds].sort();
    expect(all).toEqual([...enqueued].sort());
    expect(new Set(all).size).toBe(total);
  });
});

describe("saveIncomingMediaToDisk", () => {
  test("writes into the media dir with a sanitized, extension-aware name", () => {
    const saved = saveIncomingMediaToDisk(
      { kind: "document", mimeType: "application/pdf", bytes: Buffer.from("%PDF"), fileName: "Notes.PDF" } as any,
      "919876543210@s.whatsapp.net",
      "ABC/../123"
    );
    expect(path.dirname(saved)).toBe(path.join(dataDir, "media"));
    expect(path.basename(saved)).toMatch(/_919876543210@s\.whatsapp\.net_ABC123\.pdf$/);
    expect(readFileSync(saved, "utf-8")).toBe("%PDF");
  });

  test("falls back to mime-based extension, then .bin", () => {
    const jpg = saveIncomingMediaToDisk(
      { kind: "image", mimeType: "image/jpeg; x=1", bytes: Buffer.from([1]) } as any,
      "1@lid"
    );
    expect(jpg.endsWith("_msg.jpg")).toBe(true);
    const bin = saveIncomingMediaToDisk(
      { kind: "document", mimeType: "application/x-weird", bytes: Buffer.from([1]) } as any,
      "1@lid"
    );
    expect(bin.endsWith(".bin")).toBe(true);
  });
});

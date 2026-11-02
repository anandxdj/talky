import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isClaudeBridgeEvent } from "../src/claude-bridge";

const SCRIPT = path.resolve("scripts/wait-for-events.ts");

function runWatcher(pendingLines: string[]) {
  const dir = mkdtempSync(path.join(tmpdir(), "talky-watch-"));
  mkdirSync(path.join(dir, "data", "claude"), { recursive: true });
  writeFileSync(path.join(dir, "data", "claude", "pending.jsonl"), pendingLines.join("\n") + "\n");
  // Timeout must be ≥1 (argValue ignores 0); 1s is enough to show it does not exit early.
  return Bun.spawnSync([process.execPath, SCRIPT, "--timeout-seconds", "1", "--poll-ms", "200"], { cwd: dir });
}

describe("wait-for-events agrees with /api/claude/pending (BUG-22)", () => {
  test("lines the API ignores do not wake the session", () => {
    const proc = runWatcher(["{}", "null", '{"id": 1, "chatJid": "x"}', "[1]", "not json"]);
    expect(proc.exitCode).toBe(2); // timed out, nothing pending
  });

  test("a real event still wakes it, and only real events are printed", () => {
    const proc = runWatcher(["{}", JSON.stringify({ id: "1-A", chatJid: "1@s.whatsapp.net", text: "hi" })]);
    expect(proc.exitCode).toBe(0);
    const out = JSON.parse(proc.stdout.toString());
    expect(out.pendingCount).toBe(1);
    expect(out.events[0].id).toBe("1-A");
  });

  test("isClaudeBridgeEvent", () => {
    expect(isClaudeBridgeEvent({ id: "a", chatJid: "b" })).toBe(true);
    for (const v of [null, {}, [], "x", { id: 1, chatJid: "b" }, { id: "a" }]) expect(isClaudeBridgeEvent(v)).toBe(false);
  });
});

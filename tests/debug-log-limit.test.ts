import { describe, expect, test } from "bun:test";
import { readDebugLogEvents } from "../src/storage";

// readDebugLogEvents reads data/logs under the cwd; with no log files it returns [], so the
// limit handling is checked through a log written to a temp cwd in a child process.
describe("readDebugLogEvents limit (BUG-13)", () => {
  test("NaN / non-numeric limit falls back to the default instead of returning nothing", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const dir = mkdtempSync(path.join(tmpdir(), "talky-log-"));
    mkdirSync(path.join(dir, "data", "logs"), { recursive: true });
    const lines = Array.from({ length: 30 }, (_, i) => `- 2026-11-02T0${i % 10}:00:00.000Z | chat=a@s.whatsapp.net | sender=a | decision=YES`);
    writeFileSync(path.join(dir, "data", "logs", "decisions.md"), `# Decision Log\n\n${lines.join("\n")}\n`);
    const script = `const { readDebugLogEvents } = await import(${JSON.stringify(path.resolve("src/storage.ts"))});
      console.log(JSON.stringify([readDebugLogEvents({ limit: Number.NaN }).length, readDebugLogEvents({ limit: 5 }).length, readDebugLogEvents().length]));`;
    const proc = Bun.spawnSync([process.execPath, "-e", script], { cwd: dir });
    expect(JSON.parse(proc.stdout.toString().trim())).toEqual([30, 10, 30]);
  });

  test("function is exported for the control server", () => {
    expect(typeof readDebugLogEvents).toBe("function");
  });
});

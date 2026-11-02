import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// unauthorized.ts resolves data/ from the cwd at import time, so run it in a child process.
function runIn(storeContent: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "talky-unauth-"));
  mkdirSync(path.join(dir, "data"));
  writeFileSync(path.join(dir, "data", "unauthorized-candidates.json"), storeContent);
  const script = `const m = await import(${JSON.stringify(path.resolve("src/unauthorized.ts"))});
    const before = m.getUnauthorizedCandidates().length;
    m.recordUnauthorized("1@s.whatsapp.net", false, "not allowed", "One");
    console.log(JSON.stringify({ before, after: m.getUnauthorizedCandidates().map((c) => c.jid) }));`;
  const proc = Bun.spawnSync([process.execPath, "-e", script], { cwd: dir });
  return { out: proc.stdout.toString().trim(), err: proc.stderr.toString(), dir };
}

describe("unauthorized candidates store (BUG-20)", () => {
  for (const content of ["null", "[1,2]", "42", '"text"', '{"x": null, "y": 3}', '{"a": {"jid": "a"}}']) {
    test(`a store containing ${content} does not throw`, () => {
      const { out, err } = runIn(content);
      expect(err).toBe("");
      const parsed = JSON.parse(out);
      expect(parsed.after).toContain("1@s.whatsapp.net");
    });
  }

  test("the repaired store is written back as an object", () => {
    const { dir } = runIn("null");
    const saved = JSON.parse(readFileSync(path.join(dir, "data", "unauthorized-candidates.json"), "utf-8"));
    expect(saved["1@s.whatsapp.net"].count).toBe(1);
  });
});

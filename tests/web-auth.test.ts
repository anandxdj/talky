import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  checkRequestOrigin,
  checkRequestToken,
  loadOrCreateControlToken,
  type GuardOptions
} from "../src/web/auth";

const opts: GuardOptions = { port: 4173, token: "a".repeat(64), tokenRequired: true };

function req(method: string, headers: Record<string, string>, body?: string): Request {
  return new Request("http://127.0.0.1:4173/api/config", { method, headers, body });
}

describe("checkRequestOrigin", () => {
  test("allows same-origin panel requests", () => {
    const r = req("POST", {
      host: "127.0.0.1:4173",
      origin: "http://127.0.0.1:4173",
      "content-type": "application/json"
    }, "{}");
    expect(checkRequestOrigin(r, opts)).toBeNull();
  });

  test("allows the Vite dev server origin via proxy", () => {
    const r = req("GET", { host: "127.0.0.1:4173", origin: "http://localhost:5173" });
    expect(checkRequestOrigin(r, opts)).toBeNull();
  });

  test("allows local non-browser clients without Origin", () => {
    expect(checkRequestOrigin(req("GET", { host: "localhost:4173" }), opts)).toBeNull();
  });

  test("rejects DNS-rebinding Host headers", () => {
    const res = checkRequestOrigin(req("GET", { host: "evil.example:4173" }), opts);
    expect(res?.status).toBe(421);
  });

  test("rejects foreign origins", () => {
    const r = req("POST", {
      host: "127.0.0.1:4173",
      origin: "https://evil.example",
      "content-type": "application/json"
    }, "{}");
    expect(checkRequestOrigin(r, opts)?.status).toBe(403);
  });

  test("rejects cross-site fetch metadata and opaque origins", () => {
    expect(
      checkRequestOrigin(req("GET", { host: "127.0.0.1:4173", "sec-fetch-site": "cross-site" }), opts)?.status
    ).toBe(403);
    expect(checkRequestOrigin(req("GET", { host: "127.0.0.1:4173", origin: "null" }), opts)?.status).toBe(403);
  });

  test("rejects non-JSON writes (form / text/plain CSRF)", () => {
    const r = req("POST", { host: "127.0.0.1:4173", "content-type": "text/plain" }, "{}");
    expect(checkRequestOrigin(r, opts)?.status).toBe(415);
  });
});

describe("checkRequestToken", () => {
  test("requires the exact token", () => {
    expect(checkRequestToken(req("GET", {}), opts)?.status).toBe(401);
    expect(checkRequestToken(req("GET", { "x-talky-token": "b".repeat(64) }), opts)?.status).toBe(401);
    expect(checkRequestToken(req("GET", { "x-talky-token": "a".repeat(64) }), opts)).toBeNull();
  });

  test("can be disabled explicitly", () => {
    expect(checkRequestToken(req("GET", {}), { ...opts, tokenRequired: false })).toBeNull();
  });
});

describe("loadOrCreateControlToken", () => {
  test("creates a 0600 token once and reuses it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "talky-token-"));
    const file = path.join(dir, "nested", "control-token");
    const first = loadOrCreateControlToken(file);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(loadOrCreateControlToken(file)).toBe(first);
    expect(readFileSync(file, "utf-8").trim()).toBe(first);
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });
});

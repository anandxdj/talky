/**
 * Shared plumbing for the panel regression suite (tests/e2e/run.ts):
 *   - locate Playwright (pre-installed globally in CI images / dev boxes; not a repo dependency)
 *   - start/stop/restart scripts/preview-server.ts on a free port with a seeded scenario
 *   - a tiny authenticated API client
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

export const REPO_ROOT = path.resolve(import.meta.dir, "..", "..");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PW = any;

/** `import("playwright")` from the repo, falling back to wherever `node` resolves it. */
export async function loadPlaywright(): Promise<PW> {
  try {
    // Non-literal specifier: playwright is not a repo dependency, so tsc must not resolve it.
    const specifier = "playwright";
    return await import(specifier);
  } catch {
    const fromEnv = process.env.PLAYWRIGHT_MODULE;
    const resolved =
      fromEnv ||
      spawnSync("node", ["-p", "require.resolve('playwright')"], { encoding: "utf-8" }).stdout.trim();
    if (!resolved || !existsSync(resolved)) {
      throw new Error(
        "Playwright not found. Install it globally (npm i -g playwright) or set PLAYWRIGHT_MODULE=/path/to/playwright/index.js"
      );
    }
    return createRequire(resolved)(resolved);
  }
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export type Preview = {
  port: number;
  dir: string;
  token: string;
  base: string;
  tz: string;
  manifest: Manifest;
  stop: () => Promise<void>;
  /** Start the server again on the same port + data dir (no reseed). */
  start: () => Promise<void>;
  api: (route: string, init?: RequestInit & { json?: unknown; raw?: boolean }) => Promise<{ status: number; body: any; text: string }>;
  sends: () => Array<Record<string, any>>;
  setState: (state: { connection: "open" | "close" | "connecting"; qr: string | null }) => void;
  readFile: (rel: string) => string;
};

export type Manifest = {
  now: string;
  tz: string;
  today: { received: number; sentByTalky: number; sentByYou: number; replied: number; silent: number; claude: number };
  hourlyReceived: number[];
  daily: Array<{ dateISO: string; received: number }>;
  heatmapTotal: number;
  daily7d: Record<string, number[]>;
  pending: number;
  chats: string[];
};

export async function startPreview(scenario = "default", opts: { tz?: string } = {}): Promise<Preview> {
  const port = await freePort();
  const dir = mkdtempSync(path.join(tmpdir(), "talky-e2e-"));
  const tz = opts.tz ?? "America/New_York";
  let child: ChildProcess | null = null;
  let token = "";

  const launch = async (reuse: boolean) => {
    const args = ["scripts/preview-server.ts", "--port", String(port), "--dir", dir, "--scenario", scenario];
    if (reuse) args.push("--reuse");
    child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, TZ: tz, TALKY_API_TOKEN: "" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let log = "";
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`preview server did not start:\n${log}`)), 20_000);
      child!.stdout!.on("data", (chunk: Buffer) => {
        log += chunk.toString();
        const match = log.match(/PREVIEW_READY (\{.*\})/);
        if (match) {
          clearTimeout(timer);
          token = JSON.parse(match[1]!).token;
          resolve();
        }
      });
      child!.stderr!.on("data", (chunk: Buffer) => (log += chunk.toString()));
      child!.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`preview server exited (${code}):\n${log}`));
      });
    });
  };

  const stop = async () => {
    const c = child as ChildProcess | null;
    if (!c || c.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      c.once("exit", () => resolve());
      c.kill("SIGTERM"); // by PID — never pattern-kill
    });
    child = null;
  };

  await launch(false);
  const base = `http://127.0.0.1:${port}`;

  const api: Preview["api"] = async (route, init = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has("x-talky-token") && !init.raw) headers.set("X-Talky-Token", token);
    let body = init.body;
    if (init.json !== undefined) {
      body = JSON.stringify(init.json);
      if (!headers.has("content-type")) headers.set("Content-Type", "application/json");
    }
    const res = await fetch(`${base}${route}`, { ...init, headers, body });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: parsed, text };
  };

  return {
    port,
    dir,
    get token() {
      return token;
    },
    base,
    tz,
    manifest: JSON.parse(readFileSync(path.join(dir, "preview-manifest.json"), "utf-8")),
    stop,
    start: () => launch(true),
    api,
    sends: () => {
      const file = path.join(dir, "data", "preview-sends.jsonl");
      if (!existsSync(file)) return [];
      return readFileSync(file, "utf-8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
    setState: (state) => writeFileSync(path.join(dir, "data", "preview-state.json"), JSON.stringify(state)),
    readFile: (rel) => readFileSync(path.join(dir, rel), "utf-8")
  } as Preview;
}

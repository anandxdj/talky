import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config.js";

/**
 * Control-server request guard.
 *
 * The API can send WhatsApp messages and rewrite config, so binding to 127.0.0.1 is not
 * enough: any web page open in the user's browser can still fire requests at loopback.
 * Every `/api/*` request must pass, in order:
 *
 *  1. Host check   — Host must be a loopback name on our port (blocks DNS rebinding).
 *  2. Origin check — a browser Origin, if present, must be the panel itself or the Vite
 *                    dev server (blocks cross-site requests). `Sec-Fetch-Site: cross-site`
 *                    is rejected outright.
 *  3. JSON only    — POST/PUT/PATCH/DELETE with a body must be `application/json`, which a
 *                    cross-site page cannot send without a CORS preflight we never answer.
 *  4. Token        — `X-Talky-Token` must match `data/control-token` (created on first run,
 *                    mode 0600). The bundled UI fetches it from `GET /api/auth/session`,
 *                    which only answers requests that already passed checks 1–3.
 *
 * `TALKY_API_TOKEN=off` disables check 4 only (for local scripting); 1–3 always apply.
 */

export const CONTROL_TOKEN_PATH = path.join(DATA_DIR, "control-token");
export const TOKEN_HEADER = "x-talky-token";

const DEV_ORIGIN_PORTS = [5173, 4173];

export type GuardOptions = {
  port: number;
  token: string;
  tokenRequired: boolean;
  extraOrigins?: string[];
};

export function loadOrCreateControlToken(tokenPath = CONTROL_TOKEN_PATH): string {
  if (existsSync(tokenPath)) {
    const existing = readFileSync(tokenPath, "utf-8").trim();
    if (/^[a-f0-9]{64}$/.test(existing)) return existing;
  }
  mkdirSync(path.dirname(tokenPath), { recursive: true });
  const token = randomBytes(32).toString("hex");
  writeFileSync(tokenPath, `${token}\n`, { encoding: "utf-8", mode: 0o600 });
  try {
    chmodSync(tokenPath, 0o600);
  } catch {
    // Windows: chmod is best-effort; the file still lives inside the user's profile.
  }
  return token;
}

export function guardOptionsFromEnv(port: number, token: string): GuardOptions {
  const flag = (process.env.TALKY_API_TOKEN ?? "").trim().toLowerCase();
  const extraOrigins = (process.env.TALKY_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return { port, token, tokenRequired: flag !== "off", extraOrigins };
}

function loopbackHosts(port: number): Set<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
}

function allowedOrigins(opts: GuardOptions): Set<string> {
  const origins = new Set<string>(opts.extraOrigins ?? []);
  for (const p of [opts.port, ...DEV_ORIGIN_PORTS]) {
    origins.add(`http://127.0.0.1:${p}`);
    origins.add(`http://localhost:${p}`);
    origins.add(`http://[::1]:${p}`);
  }
  return origins;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function deny(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

/** Checks 1–3: request really comes from this machine's panel or a local non-browser client. */
export function checkRequestOrigin(req: Request, opts: GuardOptions): Response | null {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (!loopbackHosts(opts.port).has(host)) {
    return deny(421, "Host header must be a loopback address for this server");
  }

  if ((req.headers.get("sec-fetch-site") ?? "").toLowerCase() === "cross-site") {
    return deny(403, "Cross-site requests are not allowed");
  }

  const origin = req.headers.get("origin");
  if (origin && origin !== "null" && !allowedOrigins(opts).has(origin.replace(/\/+$/, ""))) {
    return deny(403, `Origin ${origin} is not allowed`);
  }
  if (origin === "null") {
    return deny(403, "Opaque origins are not allowed");
  }

  const method = req.method.toUpperCase();
  const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
  if (hasBody) {
    const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
      return deny(415, "Content-Type must be application/json");
    }
  }
  return null;
}

/** Check 4: token header. */
export function checkRequestToken(req: Request, opts: GuardOptions): Response | null {
  if (!opts.tokenRequired) return null;
  const presented = req.headers.get(TOKEN_HEADER) ?? "";
  if (!presented || !safeEqual(presented, opts.token)) {
    return deny(401, `Missing or invalid ${TOKEN_HEADER} header (see data/control-token)`);
  }
  return null;
}

import { join } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";

const UNAUTHORIZED_FILE = join(process.cwd(), "data", "unauthorized-candidates.json");

export type UnauthorizedCandidate = {
  jid: string;
  kind: "direct" | "group";
  firstSeen: string;
  lastSeen: string;
  count: number;
  lastReason: string;
  name: string; // best-effort pushName or group name
  /** Best-effort last message preview (truncated). */
  lastPreview?: string;
};

function readStore(): Record<string, UnauthorizedCandidate> {
  if (!existsSync(UNAUTHORIZED_FILE)) {
      return {};
  }
  try {
      const parsed: unknown = JSON.parse(readFileSync(UNAUTHORIZED_FILE, "utf-8"));
      // `null`, an array or a number parse fine but are not a store; treat them as empty.
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const store: Record<string, UnauthorizedCandidate> = {};
      for (const [jid, entry] of Object.entries(parsed as Record<string, unknown>)) {
          if (entry && typeof entry === "object" && !Array.isArray(entry)) {
              store[jid] = entry as UnauthorizedCandidate;
          }
      }
      return store;
  } catch {
      return {};
  }
}

function writeStore(store: Record<string, UnauthorizedCandidate>) {
  writeFileSync(UNAUTHORIZED_FILE, JSON.stringify(store, null, 2), "utf-8");
}

export function recordUnauthorized(
  jid: string,
  isGroup: boolean,
  reason: string,
  pushName?: string,
  lastPreview?: string
) {
  const store = readStore();
  const existing = store[jid];
  const now = new Date().toISOString();
  const previewTrimmed = lastPreview?.trim()
    ? lastPreview.trim().slice(0, 500)
    : undefined;

  if (existing) {
      existing.count = (typeof existing.count === "number" ? existing.count : 0) + 1;
      existing.lastSeen = now;
      existing.lastReason = reason;
      if (pushName && !existing.name) existing.name = pushName;
      if (previewTrimmed) existing.lastPreview = previewTrimmed;
  } else {
      store[jid] = {
          jid,
          kind: isGroup ? "group" : "direct",
          firstSeen: now,
          lastSeen: now,
          count: 1,
          lastReason: reason,
          name: pushName || "",
          ...(previewTrimmed ? { lastPreview: previewTrimmed } : {})
      };
  }
  writeStore(store);
}

export function getUnauthorizedCandidates(): UnauthorizedCandidate[] {
  const store = readStore();
  return Object.values(store).sort((a, b) => String(b.lastSeen ?? "").localeCompare(String(a.lastSeen ?? "")));
}

export function removeUnauthorizedCandidate(jid: string): void {
  const store = readStore();
  if (store[jid]) {
      delete store[jid];
      writeStore(store);
  }
}

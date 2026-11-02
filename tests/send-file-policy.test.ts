import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeConfig } from "../src/config";
import { resolveMediatorSendFile } from "../src/tools";

const root = mkdtempSync(path.join(tmpdir(), "talky-sendfile-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const data = path.join(root, "data");
const media = path.join(data, "media");
mkdirSync(media, { recursive: true });
mkdirSync(path.join(root, "wa_auth"), { recursive: true });
mkdirSync(path.join(root, "Desktop"), { recursive: true });
const files = {
  attachment: path.join(media, "photo.jpg"),
  token: path.join(data, "control-token"),
  chat: path.join(data, "chats.md"),
  creds: path.join(root, "wa_auth", "creds.json"),
  env: path.join(root, ".env"),
  config: path.join(root, "config.yaml"),
  desktopDoc: path.join(root, "Desktop", "notes.pdf"),
  exe: path.join(root, "Desktop", "setup.exe"),
  big: path.join(root, "Desktop", "big.bin")
};
for (const file of Object.values(files)) writeFileSync(file, "x");
writeFileSync(files.big, Buffer.alloc(2048));

// The repo itself is an allowed root (the Linux/macOS default), so only the explicit rules protect it.
const config = { ...normalizeConfig({ localFileAllowedRoots: [root] }), maxShareFileBytes: 1024 };
const places = { mediaDir: media, privateDirs: [data], privateFiles: [files.config] };
const check = (p: string) => resolveMediatorSendFile(p, config, places);

describe("send-file policy (BUG-08)", () => {
  test("saved attachments and files under allowed roots can be sent", () => {
    expect(check(files.attachment).ok).toBe(true);
    expect(check(files.desktopDoc).ok).toBe(true);
  });

  test("Talky's secrets and private data are refused", () => {
    for (const p of [files.token, files.chat, files.creds, files.env, files.config]) {
      expect(check(p).ok).toBe(false);
    }
  });

  test("blocked extensions, oversize, relative, traversal and missing paths are refused", () => {
    expect(check(files.exe).ok).toBe(false);
    expect(check(files.big).ok).toBe(false);
    expect(check("Desktop/notes.pdf").ok).toBe(false);
    expect(check(path.join(media, "..", "control-token")).ok).toBe(false);
    expect(check(path.join(root, "nope.pdf")).reason).toStartWith("file not found");
    expect(check(path.join(tmpdir(), "outside-root.pdf")).ok).toBe(false);
  });
});

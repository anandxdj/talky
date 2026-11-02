/**
 * Web panel regression suite — real control server + fake WhatsApp runtime + Playwright.
 *
 *   bun run test:e2e                 # everything
 *   bun run test:e2e -- --only api   # suites whose name contains "api"
 *
 * Each scenario gets its own preview server (scripts/preview-server.ts) on a free port with
 * freshly seeded data, so checks never depend on each other's side effects across suites.
 * Failures save a screenshot to $E2E_SHOTS (default: <tmp>/talky-e2e-shots).
 * Exit code is non-zero when any check fails.
 */
import { mkdirSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadPlaywright, startPreview, type Preview, type PW } from "./harness";

const SHOTS = process.env.E2E_SHOTS ?? path.join(tmpdir(), "talky-e2e-shots");
mkdirSync(SHOTS, { recursive: true });
const onlyIdx = process.argv.indexOf("--only");
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1] ?? "" : "";

type Result = { suite: string; name: string; ok: boolean; error?: string; ms: number };
const results: Result[] = [];

class AssertionError extends Error {}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new AssertionError(msg);
}
function eq<T>(actual: T, expected: T, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new AssertionError(`${msg}: expected ${e}, got ${a}`);
}

let currentPage: any = null;
async function check(suite: string, name: string, fn: () => Promise<void>) {
  const started = Date.now();
  try {
    await fn();
    results.push({ suite, name, ok: true, ms: Date.now() - started });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ suite, name, ok: false, error: message, ms: Date.now() - started });
    console.log(`  ✗ ${name}\n      ${message.split("\n")[0]}`);
    if (currentPage) {
      const file = path.join(SHOTS, `${suite}-${name}`.replace(/[^a-z0-9-]+/gi, "_").slice(0, 120) + ".png");
      await currentPage.screenshot({ path: file }).catch(() => {});
    }
  }
}

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } } as const;
type Combo = { vp: keyof typeof VIEWPORTS; scheme: "light" | "dark" };
const COMBOS: Combo[] = [
  { vp: "desktop", scheme: "light" },
  { vp: "desktop", scheme: "dark" },
  { vp: "mobile", scheme: "light" },
  { vp: "mobile", scheme: "dark" }
];

/** Console noise that is environmental, not a panel bug (the preview has no Gemini API access). */
const IGNORED_CONSOLE = [/\/api\/models/, /status of 502/];

async function openPage(browser: any, p: Preview, combo: Combo = { vp: "desktop", scheme: "light" }) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[combo.vp],
    colorScheme: combo.scheme,
    timezoneId: p.tz,
    isMobile: combo.vp === "mobile",
    hasTouch: combo.vp === "mobile"
  });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (m: any) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const text = m.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text) || re.test(m.location()?.url ?? ""))) return;
    consoleErrors.push(text);
  });
  page.on("pageerror", (e: Error) => consoleErrors.push(`pageerror: ${e.message}`));
  currentPage = page;
  const goto = async (route: string) => {
    await page.goto(p.base + route);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(400);
  };
  return { context, page, consoleErrors, goto };
}

const ROUTES = [
  "/overview",
  "/queue",
  "/queue?tab=unknown",
  "/conversations",
  "/conversations?jid=919876543210%40s.whatsapp.net",
  "/voice",
  "/access",
  "/settings"
];

async function a11ySnapshot(page: any) {
  return page.evaluate(() => {
    const unnamed = [...document.querySelectorAll("button, a[href], [role=tab], [role=radio], [role=switch], input, textarea, select, [role=combobox]")]
      .filter((el) => {
        const h = el as HTMLElement;
        if (h.closest("[aria-hidden=true]") || h.offsetParent === null) return false;
        const labelled =
          h.getAttribute("aria-label") ||
          h.getAttribute("aria-labelledby") ||
          h.getAttribute("title") ||
          (h.textContent ?? "").trim() ||
          (h as HTMLInputElement).placeholder ||
          (h.id && document.querySelector(`label[for="${h.id}"]`)) ||
          h.closest("label");
        return !labelled;
      })
      .map((el) => el.outerHTML.slice(0, 140));
    return {
      unnamed,
      overflowX: document.documentElement.scrollWidth - window.innerWidth
    };
  });
}

// ---------------------------------------------------------------------------------------------

async function suiteRoutes(pw: PW) {
  const suite = "routes";
  console.log(`\n# ${suite}`);
  const p = await startPreview("default");
  const browser = await pw.chromium.launch();
  try {
    for (const combo of COMBOS) {
      const { context, page, consoleErrors, goto } = await openPage(browser, p, combo);
      for (const route of ROUTES) {
        await check(suite, `${combo.vp}/${combo.scheme} ${route} renders, no overflow, all controls named`, async () => {
          await goto(route);
          const path = route.split("?")[0];
          assert(new URL(page.url()).pathname === path, `landed on ${page.url()}`);
          const snap = await a11ySnapshot(page);
          assert(snap.overflowX <= 0, `horizontal scroll of ${snap.overflowX}px`);
          eq(snap.unnamed, [], "controls without accessible name");
          const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
          eq(dark, combo.scheme === "dark", "theme follows prefers-color-scheme");
        });
      }
      await check(suite, `${combo.vp}/${combo.scheme} no console errors or React warnings`, async () => {
        eq(consoleErrors, [], "console errors");
      });
      await context.close();
    }

    const { context, page, goto } = await openPage(browser, p);
    const redirects: Array<[string, string]> = [
      ["/dashboard?x=1", "/overview?x=1"],
      ["/inbox?tab=unknown", "/queue?tab=unknown"],
      ["/chats?jid=919876543210%40s.whatsapp.net", "/conversations?jid=919876543210%40s.whatsapp.net"],
      ["/persona?tab=profiles", "/voice?tab=profiles"],
      ["/allowlists?a=b", "/access?a=b"],
      ["/actions?a=b", "/settings?a=b"],
      ["/", "/overview"],
      ["/definitely-not-a-page", "/overview"],
      ["/queue/extra/segments", "/overview"]
    ];
    for (const [from, to] of redirects) {
      await check(suite, `redirect ${from} → ${to}`, async () => {
        await goto(from);
        const u = new URL(page.url());
        eq(u.pathname + u.search, to, "redirect target");
      });
    }
    await check(suite, "voice persona tabs: core files, contacts & groups, from chats", async () => {
      await goto("/voice");
      await page.getByRole("button", { name: /Contacts & groups/ }).click();
      await page.getByText("919876543210@s.whatsapp.net").first().waitFor({ timeout: 3000 });
      await page.getByRole("button", { name: /From chats/ }).click();
      await page.getByText(/Selected threads/).first().waitFor({ timeout: 3000 });
      await page.getByRole("button", { name: /Core files/ }).click();
      await page.locator("#soul").waitFor({ timeout: 3000 });
      assert((await page.locator("#soul").inputValue()).includes("I am Suman"), "soul loaded");
    });
    await context.close();
  } finally {
    await browser.close();
    await p.stop();
  }
}

async function suiteApi() {
  const suite = "api-security";
  console.log(`\n# ${suite}`);
  const p = await startPreview("default");
  try {
    await check(suite, "missing token → 401", async () => {
      eq((await p.api("/api/config", { raw: true })).status, 401, "status");
    });
    await check(suite, "invalid token → 401", async () => {
      eq((await p.api("/api/config", { headers: { "X-Talky-Token": "0".repeat(64) } })).status, 401, "status");
    });
    await check(suite, "foreign Origin → 403", async () => {
      eq((await p.api("/api/config", { headers: { Origin: "https://evil.example" } })).status, 403, "status");
    });
    await check(suite, "Sec-Fetch-Site: cross-site → 403", async () => {
      eq((await p.api("/api/config", { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403, "status");
    });
    await check(suite, "text/plain POST → 415", async () => {
      const r = await p.api("/api/config", { method: "POST", body: "{}", headers: { "Content-Type": "text/plain" } });
      eq(r.status, 415, "status");
    });
    await check(suite, "bad Host → 421", async () => {
      // fetch() forbids overriding Host; use a raw socket.
      const res = await new Promise<string>((resolve, reject) => {
        const sock = require("node:net").connect(p.port, "127.0.0.1", () => {
          sock.write(`GET /api/config HTTP/1.1\r\nHost: evil.example\r\nX-Talky-Token: ${p.token}\r\nConnection: close\r\n\r\n`);
        });
        let buf = "";
        sock.on("data", (d: Buffer) => (buf += d.toString()));
        sock.on("end", () => resolve(buf));
        sock.on("error", reject);
      });
      assert(res.startsWith("HTTP/1.1 421"), `got ${res.split("\r\n")[0]}`);
    });
    await check(suite, "auth/session answers same-origin and returns the token", async () => {
      const r = await p.api("/api/auth/session", { raw: true });
      eq(r.status, 200, "status");
      eq(r.body.token, p.token, "token");
    });
    await check(suite, "locked config key (claudeTriggerCommand) rejected and unchanged", async () => {
      const r = await p.api("/api/config", { method: "POST", json: { claudeTriggerCommand: "rm -rf /" } });
      assert(r.body.rejectedKeys.includes("claudeTriggerCommand"), "rejectedKeys");
      eq(r.body.config.claudeTriggerCommand, "", "value unchanged");
    });
    await check(suite, "unknown config key rejected", async () => {
      const r = await p.api("/api/config", { method: "POST", json: { notAKey: 1 } });
      assert(r.body.rejectedKeys.includes("notAKey"), "rejectedKeys");
    });
    await check(suite, "out-of-range numbers rejected (historyWindow -3, dailyMessageLimit -5) [BUG-09]", async () => {
      const r = await p.api("/api/config", { method: "POST", json: { historyWindow: -3, dailyMessageLimit: -5, minReplyDelayMs: 9_000, maxReplyDelayMs: 1 } });
      assert(r.body.rejectedKeys?.includes("historyWindow"), `historyWindow accepted: ${JSON.stringify(r.body.rejectedKeys)}`);
      assert(r.body.rejectedKeys?.includes("dailyMessageLimit"), "dailyMessageLimit accepted");
      const cfg = (await p.api("/api/config")).body;
      assert(cfg.historyWindow > 0 && cfg.dailyMessageLimit >= 0, `saved ${cfg.historyWindow}/${cfg.dailyMessageLimit}`);
      assert(cfg.minReplyDelayMs <= cfg.maxReplyDelayMs, `min ${cfg.minReplyDelayMs} > max ${cfg.maxReplyDelayMs}`);
    });
    await check(suite, "invalid enum value rejected, current value kept [BUG-10]", async () => {
      await p.api("/api/config", { method: "POST", json: { directChatMode: "all" } });
      const r = await p.api("/api/config", { method: "POST", json: { directChatMode: "ALL" } });
      assert(r.body.rejectedKeys?.includes("directChatMode"), "not rejected");
      eq(r.body.config.directChatMode, "all", "directChatMode");
      await p.api("/api/config", { method: "POST", json: { directChatMode: "allowlist" } });
    });
    await check(suite, "non-object JSON body for POST /api/config → 400 [BUG-31]", async () => {
      eq((await p.api("/api/config", { method: "POST", json: [1, 2] })).status, 400, "array body");
    });
    await check(suite, "malformed JSON → 400 JSON error", async () => {
      const r = await p.api("/api/config", { method: "POST", body: "{nope", headers: { "Content-Type": "application/json" } });
      eq(r.status, 400, "status");
      assert(r.body && typeof r.body.error === "string", "JSON error body");
    });
    await check(suite, "large body (5 MB persona) round-trips", async () => {
      const big = "x".repeat(5_000_000);
      const before = (await p.api("/api/persona")).body.recentMemory;
      eq((await p.api("/api/persona", { method: "POST", json: { recentMemory: big } })).status, 200, "status");
      eq((await p.api("/api/persona")).body.recentMemory.length, big.length, "length");
      await p.api("/api/persona", { method: "POST", json: { recentMemory: before } });
    });
    await check(suite, "static path traversal stays inside web-ui/dist", async () => {
      for (const route of ["/..%2f..%2fconfig.yaml", "/%2e%2e/%2e%2e/config.yaml", "/../../.env", "/assets/..%2f..%2f..%2f.env"]) {
        const r = await fetch(p.base + route);
        const text = await r.text();
        assert(!text.includes("GEMINI_API_KEY") && !text.includes("claudeMediatorEnabled"), `${route} leaked a file`);
      }
    });
    await check(suite, "persona stem traversal → 400 JSON (not 500 HTML) [BUG-12]", async () => {
      for (const stem of ["../soul", "..%2Fsoul", "a/b", "..\\x"]) {
        const r = await p.api(`/api/persona/profile?stem=${encodeURIComponent(stem)}&kind=contact`);
        eq(r.status, 400, `GET stem ${stem}`);
        assert(r.body && typeof r.body.error === "string", "JSON error");
        const w = await p.api("/api/persona/profile", { method: "POST", json: { kind: "contact", stem, content: "pwned" } });
        eq(w.status, 400, `POST stem ${stem}`);
      }
    });
    await check(suite, "media file param traversal / directory → 400", async () => {
      for (const file of ["../config.yaml", "..%2Fconfig.yaml", "/etc/passwd", ".", ".."]) {
        const r = await p.api(`/api/claude/media?file=${encodeURIComponent(file)}`);
        eq(r.status, 400, `file=${file}`);
      }
    });
    await check(suite, "GET failures return JSON, never an HTML stack trace [BUG-12]", async () => {
      rmSync(path.join(p.dir, "persona", "recent_memory.md"));
      const r = await p.api("/api/persona");
      assert(!r.text.includes("<html") && !r.text.includes("at "), `HTML/stack in body: ${r.text.slice(0, 80)}`);
      writeFileSync(path.join(p.dir, "persona", "recent_memory.md"), "# Recent memory\n");
    });
    await check(suite, "/api/logs/events?limit=abc falls back to default [BUG-13]", async () => {
      const r = await p.api("/api/logs/events?limit=abc");
      assert(Array.isArray(r.body) && r.body.length > 0, `got ${r.text.slice(0, 60)}`);
    });
    await check(suite, "/apiconfig is not treated as /api/config [BUG-30]", async () => {
      const r = await p.api("/apiconfig");
      assert(!(r.body && typeof r.body === "object" && "botName" in r.body), "served config");
    });
    await check(suite, "chat delete jid traversal cannot escape data/chats", async () => {
      writeFileSync(path.join(p.dir, "data", "canary.md"), "x");
      await p.api(`/api/chats?jid=${encodeURIComponent("../canary")}`, { method: "DELETE" });
      assert(existsSync(path.join(p.dir, "data", "canary.md")), "canary deleted");
    });
    await check(suite, "unauthorized/resolve without listType allows a DM into the direct list [BUG-11]", async () => {
      await p.api("/api/unauthorized/resolve", { method: "POST", json: { action: "allow", jid: "918888888888@s.whatsapp.net" } });
      const cfg = (await p.api("/api/config")).body;
      assert(!cfg.allowedGroupJids.includes("918888888888@s.whatsapp.net"), "DM added to group allowlist");
      assert(cfg.allowedDirectJids.includes("918888888888@s.whatsapp.net"), "DM not in direct allowlist");
    });
    await check(suite, "unauthorized/resolve with empty jid → 400 [BUG-11]", async () => {
      const r = await p.api("/api/unauthorized/resolve", { method: "POST", json: { action: "allow", jid: "", listType: "direct" } });
      eq(r.status, 400, "status");
    });
    await check(suite, "claude/send with >5 ||| parts → 400, nothing sent [BUG-04]", async () => {
      const before = p.sends().length;
      const r = await p.api("/api/claude/send", { method: "POST", json: { to: "919876543210", text: "1|||2|||3|||4|||5|||6" } });
      eq(r.status, 400, "status");
      eq(p.sends().length, before, "sends");
    });
    await check(suite, "claude/send-file refuses files outside localFileAllowedRoots [BUG-08]", async () => {
      const before = p.sends().length;
      const r = await p.api("/api/claude/send-file", { method: "POST", json: { to: "919876543210", path: path.join(p.dir, "data", "control-token") } });
      assert(r.status === 403 || r.status === 400, `status ${r.status}`);
      eq(p.sends().length, before, "sends");
    });
    await check(suite, "claude/ack with unknown ids is a no-op", async () => {
      const r = await p.api("/api/claude/ack", { method: "POST", json: { ids: ["nope"] } });
      eq(r.body.acked, 0, "acked");
      eq(r.body.pendingCount, p.manifest.pending, "pending unchanged");
    });
    await check(suite, "claude/chat & context accept any jid without crashing", async () => {
      for (const jid of ["../../etc/passwd", "নাম@s.whatsapp.net", "x".repeat(5000)]) {
        eq((await p.api(`/api/claude/chat?jid=${encodeURIComponent(jid)}`)).status, 200, "chat");
        eq((await p.api(`/api/claude/context?jid=${encodeURIComponent(jid)}`)).status, 200, "context");
      }
    });
  } finally {
    await p.stop();
  }
}

async function suiteStats() {
  const suite = "stats";
  console.log(`\n# ${suite}`);
  for (const tz of ["America/New_York", "Asia/Kolkata", "Australia/Lord_Howe", "UTC"]) {
    const p = await startPreview("default", { tz });
    try {
      const m = p.manifest;
      const s = (await p.api("/api/stats/overview")).body;
      await check(suite, `${tz}: today's counts match seeded data`, async () => {
        eq(s.today.received, m.today.received, "received");
        eq(s.today.sentByTalky, m.today.sentByTalky, "sentByTalky");
        eq(s.today.sentByYou, m.today.sentByYou, "sentByYou");
        eq(s.today.replied, m.today.replied, "replied");
        eq(s.today.silent, m.today.silent, "silent");
        eq(s.today.claude, m.today.claude, "claude");
      });
      await check(suite, `${tz}: hourly buckets are local hours`, async () => {
        eq(s.hourly.map((h: any) => h.received), m.hourlyReceived, "hourly received");
      });
      await check(suite, `${tz}: 14-day series dates and counts`, async () => {
        eq(s.daily.map((d: any) => d.dateISO), m.daily.map((d) => d.dateISO), "dates");
        eq(s.daily.map((d: any) => d.received), m.daily.map((d) => d.received), "received");
      });
      await check(suite, `${tz}: 7-day heatmap and per-chat daily7d (DST-safe) [BUG-02]`, async () => {
        eq(s.heatmap.flat().reduce((a: number, b: number) => a + b, 0), m.heatmapTotal, "heatmap total");
        for (const chat of s.chats) {
          if (m.daily7d[chat.jid]) eq(chat.daily7d, m.daily7d[chat.jid], `daily7d ${chat.jid}`);
        }
      });
    } finally {
      await p.stop();
    }
  }
}

async function suiteInteractions(pw: PW) {
  const suite = "interactions";
  console.log(`\n# ${suite}`);
  const p = await startPreview("default");
  const browser = await pw.chromium.launch();
  const cfg = async () => (await p.api("/api/config")).body;
  try {
    const { context, page, goto, consoleErrors } = await openPage(browser, p);

    await check(suite, "engine switch Gemini/Claude/Both writes config.yaml", async () => {
      await goto("/overview");
      const group = page.getByRole("radiogroup", { name: "Reply engine" });
      for (const [label, enabled, exclusive] of [["Claude", true, true], ["Gemini", false, true], ["Both", true, false]] as const) {
        await group.getByRole("radio", { name: label }).click();
        await page.waitForTimeout(600);
        const c = await cfg();
        eq(c.claudeMediatorEnabled, enabled, `enabled after ${label}`);
        if (enabled) eq(c.claudeMediatorExclusive, exclusive, `exclusive after ${label}`);
        assert(p.readFile("config.yaml").includes(`claudeMediatorEnabled: ${enabled}`), "config.yaml");
        await page.waitForTimeout(3200);
        eq(await group.getByRole("radio", { name: label }).getAttribute("aria-checked"), "true", `${label} checked`);
      }
    });

    await check(suite, "Pause → banner + 409 on send without force; Resume clears it", async () => {
      await goto("/overview");
      await page.getByRole("button", { name: "Pause replies" }).first().click();
      await page.getByText("Replies are paused").waitFor({ timeout: 4000 });
      eq((await cfg()).repliesPaused, true, "paused in config");
      const r = await p.api("/api/claude/send", { method: "POST", json: { to: "919876543210", text: "hi" } });
      eq(r.status, 409, "send while paused");
      eq(r.body.error, "replies are paused", "error");
      const st = (await p.api("/api/claude/status")).body;
      eq(st.repliesPaused, true, "status.repliesPaused");
      await page.getByRole("button", { name: "Resume", exact: true }).click();
      await page.getByText("Replies are paused").waitFor({ state: "detached", timeout: 4000 });
      eq((await cfg()).repliesPaused, false, "resumed");
    });

    await check(suite, "Live queue composer sends with force while paused", async () => {
      await p.api("/api/config", { method: "POST", json: { repliesPaused: true } });
      await goto("/queue");
      await page.getByRole("button", { name: /Weekend Plans/ }).first().click();
      const box = page.getByPlaceholder("Write the reply in your own voice…");
      await box.fill("on my way");
      await page.getByRole("button", { name: /^Send/ }).click();
      await page.getByText(/Sent 1 message/).waitFor({ timeout: 6000 });
      const last = p.sends().at(-1)!;
      eq([last.action, last.jid, last.text], ["sendText", "120363000000000001@g.us", "on my way"], "send");
      await p.api("/api/config", { method: "POST", json: { repliesPaused: false } });
    });

    await check(suite, "Live queue: multi-event thread shows count and Stay silent acks every event", async () => {
      await goto("/queue");
      const row = page.getByRole("button", { name: /Deep/ }).first();
      assert((await row.innerText()).includes("×2"), "thread count badge");
      await row.click();
      await page.getByRole("button", { name: /Stay silent/ }).click();
      await page.getByText(/Marked 2 messages as handled/).waitFor({ timeout: 4000 });
      eq((await p.api("/api/claude/pending")).body.length, 0, "pending after ack");
      const handled = p.readFile("data/claude/handled.jsonl");
      assert(handled.includes("1000-AAA111") && handled.includes("1001-AAA222"), "archived to handled.jsonl");
      await page.getByText("Nothing waiting").waitFor({ timeout: 4000 });
    });

    // Re-seed two events for the keyboard checks.
    const requeue = (id: string, chat = "919876543210@s.whatsapp.net") =>
      Bun.write(
        path.join(p.dir, "data", "claude", "pending.jsonl"),
        JSON.stringify({ id, timestampISO: new Date().toISOString(), chatJid: chat, senderJid: chat, senderName: "Deep", chatName: "Deep", isGroup: false, mentionedMe: false, text: "ping" }) + "\n"
      );

    await check(suite, "⌘↵ / Ctrl+Enter sends; ||| splits into parts", async () => {
      await requeue("3000-KEY1");
      await goto("/queue");
      await page.getByRole("button", { name: /Deep/ }).first().click();
      const box = page.getByPlaceholder("Write the reply in your own voice…");
      await box.fill("one ||| two ||| three");
      await box.press("Control+Enter");
      await page.getByText(/Sent 3 messages/).waitFor({ timeout: 6000 });
      eq(p.sends().at(-1)!.chunks, ["one", "two", "three"], "chunks");
    });

    await check(suite, "Ctrl+Enter with >5 parts is blocked like the Send button [BUG-03]", async () => {
      await requeue("3000-KEY2");
      await goto("/queue");
      await page.getByRole("button", { name: /Deep/ }).first().click();
      const before = p.sends().length;
      const box = page.getByPlaceholder("Write the reply in your own voice…");
      await box.fill("1|||2|||3|||4|||5|||6");
      assert(await page.getByRole("button", { name: /^Send/ }).isDisabled(), "Send button disabled");
      await box.press("Control+Enter");
      await page.waitForTimeout(1200);
      eq(p.sends().length, before, "nothing sent");
    });

    await check(suite, "pressing Ctrl+Enter twice sends once [BUG-03]", async () => {
      await requeue("3000-KEY3");
      await goto("/queue");
      await page.getByRole("button", { name: /Deep/ }).first().click();
      const before = p.sends().length;
      const box = page.getByPlaceholder("Write the reply in your own voice…");
      await box.fill("just once");
      await page.evaluate(() => {
        const ta = document.querySelector("textarea")!;
        for (let i = 0; i < 2; i += 1) ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
      });
      await page.waitForTimeout(1500);
      eq(p.sends().length - before, 1, "send count");
    });

    await check(suite, "send OK but ack fails → reports sent, not 'Send failed' [BUG-16]", async () => {
      await requeue("3000-ACK1");
      await goto("/queue");
      await page.getByRole("button", { name: /Deep/ }).first().click();
      await page.route("**/api/claude/ack", (route: any) => route.fulfill({ status: 500, body: '{"error":"disk full"}' }));
      await page.getByPlaceholder("Write the reply in your own voice…").fill("ack will fail");
      await page.getByRole("button", { name: /^Send/ }).click();
      await page.waitForTimeout(1500);
      const toasts = await page.locator("[data-sonner-toast]").allInnerTexts();
      assert(!toasts.some((t: string) => /Send failed/.test(t)), `toasts: ${toasts.join(" | ")}`);
      await page.unroute("**/api/claude/ack");
      await p.api("/api/claude/ack", { method: "POST", json: { ids: ["3000-ACK1"] } });
    });

    await check(suite, "attachment opens with its real type, not as an unnamed octet-stream [BUG-19]", async () => {
      const media = await p.api(`/api/claude/media?file=${encodeURIComponent("2026-06-05T10-15-00-000Z_deep_ABC.pdf")}`);
      eq(media.status, 200, "status");
      const r = await fetch(`${p.base}/api/claude/media?file=2026-06-05T10-15-00-000Z_deep_ABC.pdf`, { headers: { "X-Talky-Token": p.token } });
      eq(r.headers.get("content-type"), "application/pdf", "content-type");
    });

    await check(suite, "unknown senders: allow adds to direct list, dismiss removes the group", async () => {
      await goto("/queue?tab=unknown");
      await page.getByRole("button", { name: "Allow" }).first().click();
      await page.waitForTimeout(800);
      assert((await cfg()).allowedDirectJids.includes("918888888888@s.whatsapp.net"), "allowed");
      await page.getByRole("button", { name: "Dismiss" }).first().click();
      await page.waitForTimeout(800);
      eq((await p.api("/api/unauthorized")).body.length, 0, "candidates left");
      assert(!(await cfg()).allowedGroupJids.includes("120363999999999999@g.us"), "dismiss must not allow");
    });

    await check(suite, "Allow failure shows an error instead of an unhandled rejection [BUG-15]", async () => {
      writeFileSync(path.join(p.dir, "data", "unauthorized-candidates.json"), JSON.stringify({ "917777777777@s.whatsapp.net": { jid: "917777777777@s.whatsapp.net", kind: "direct", firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(), count: 1, lastReason: "x", name: "Seven" } }));
      await goto("/queue?tab=unknown");
      const before = consoleErrors.length;
      await page.route("**/api/unauthorized/resolve", (route: any) => route.fulfill({ status: 500, body: '{"error":"boom"}' }));
      await page.getByRole("button", { name: "Allow" }).first().click();
      await page.waitForTimeout(800);
      await page.unroute("**/api/unauthorized/resolve");
      const unhandled = consoleErrors.slice(before).filter((e) => e.startsWith("pageerror"));
      eq(unhandled, [], "unhandled rejections");
      const toasts = await page.locator("[data-sonner-toast]").allInnerTexts();
      assert(toasts.some((t: string) => /fail|error|could not/i.test(t)), `no error toast: ${toasts.join(" | ")}`);
      consoleErrors.splice(before);
    });

    await check(suite, "Access rules: save keeps engine changes made elsewhere [BUG-05]", async () => {
      await p.api("/api/config", { method: "POST", json: { claudeMediatorEnabled: false, claudeMediatorExclusive: true } });
      await goto("/access");
      await page.waitForTimeout(3500);
      await page.getByPlaceholder("Add JID…").first().fill("915555555555@s.whatsapp.net");
      await page.getByPlaceholder("Add JID…").first().press("Enter");
      // Engine flipped from another tab / Overview while this draft is dirty.
      await p.api("/api/config", { method: "POST", json: { claudeMediatorEnabled: true, claudeMediatorExclusive: true } });
      await page.waitForTimeout(3500);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForTimeout(800);
      const c = await cfg();
      assert(c.allowedDirectJids.includes("915555555555@s.whatsapp.net"), "added JID saved");
      eq(c.claudeMediatorEnabled, true, "engine change preserved");
    });

    await check(suite, "Access rules: editing a JID row keeps focus and the row [BUG-07]", async () => {
      await goto("/access");
      const input = page.locator('input[value="919812345678@s.whatsapp.net"]').first();
      await input.click();
      await input.press("End");
      await page.keyboard.type("9");
      await page.keyboard.type("9");
      const focused = await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.value ?? "");
      eq(focused, "919812345678@s.whatsapp.net99", "focused input value");
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Backspace");
      await page.keyboard.type("911");
      const after = await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.value ?? "");
      eq(after, "911", "row survives being cleared and retyped");
      await page.getByRole("button", { name: "Reset", exact: true }).click();
    });

    await check(suite, "Access rules: Reset discards the draft", async () => {
      await goto("/access");
      await page.getByPlaceholder("Add JID…").first().fill("916666666666@s.whatsapp.net");
      await page.getByPlaceholder("Add JID…").first().press("Enter");
      assert(await page.locator('input[value="916666666666@s.whatsapp.net"]').count(), "row added");
      await page.getByRole("button", { name: "Reset", exact: true }).click();
      eq(await page.locator('input[value="916666666666@s.whatsapp.net"]').count(), 0, "row gone after reset");
      assert(!(await cfg()).allowedDirectJids.includes("916666666666@s.whatsapp.net"), "not saved");
    });

    await check(suite, "Settings: Apply model sends only the model (does not un-pause) [BUG-06]", async () => {
      await goto("/settings");
      await page.waitForTimeout(500);
      await p.api("/api/config", { method: "POST", json: { repliesPaused: true } });
      let body: any = null;
      await page.route("**/api/config", async (route: any) => {
        if (route.request().method() === "POST") body = route.request().postDataJSON();
        await route.continue();
      });
      const apply = page.getByRole("button", { name: /Apply/ }).first();
      if (await apply.isDisabled()) {
        // No model list in the sandbox: drive the handler through the select's current value.
        await page.getByRole("combobox").first().click();
        await page.getByRole("option").first().click();
      }
      await apply.click();
      await page.waitForTimeout(800);
      await page.unroute("**/api/config");
      assert(body, "no POST /api/config");
      eq(Object.keys(body), ["model"], "POST body keys");
      eq((await cfg()).repliesPaused, true, "still paused");
      await p.api("/api/config", { method: "POST", json: { repliesPaused: false } });
    });

    await check(suite, "Settings: Run relink asks for confirmation first [BUG-18]", async () => {
      await goto("/settings");
      const before = p.sends().filter((s) => s.action === "relink").length;
      await page.getByRole("button", { name: "Run relink" }).click();
      await page.waitForTimeout(500);
      eq(p.sends().filter((s) => s.action === "relink").length, before, "relinked without confirmation");
      const dialog = page.getByRole("alertdialog");
      await dialog.waitFor({ timeout: 2000 });
      await dialog.getByRole("button", { name: /Relink/ }).click();
      await page.waitForTimeout(500);
      eq(p.sends().filter((s) => s.action === "relink").length, before + 1, "relink after confirm");
    });

    await check(suite, "Settings: repair runs; factory reset needs typed RESET", async () => {
      await goto("/settings");
      await page.getByRole("button", { name: "Run repair" }).click();
      await page.waitForTimeout(500);
      assert(p.sends().some((s) => s.action === "repairSession"), "repair");
      await page.getByRole("button", { name: /Factory reset/ }).click();
      const dialog = page.getByRole("alertdialog");
      const go = dialog.getByRole("button", { name: /Delete all local data/ });
      assert(await go.isDisabled(), "enabled before typing");
      await dialog.getByPlaceholder("Type RESET").fill("reset please");
      assert(await go.isDisabled(), "enabled for wrong text");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      assert(!p.sends().some((s) => s.action === "factoryReset"), "reset ran on cancel");
      await page.getByRole("button", { name: /Factory reset/ }).click();
      await page.getByRole("alertdialog").getByPlaceholder("Type RESET").fill("RESET");
      await page.getByRole("alertdialog").getByRole("button", { name: /Delete all local data/ }).click();
      await page.waitForTimeout(600);
      assert(p.sends().some((s) => s.action === "factoryReset"), "reset after RESET");
    });

    await check(suite, "Persona: edit → dirty → save writes soul.md", async () => {
      await goto("/voice");
      const soul = page.locator("#soul");
      await soul.fill("# Soul\n\nEdited by e2e ✍️ — বাংলা");
      await page.getByText("Unsaved core changes").waitFor({ timeout: 2000 });
      await page.getByRole("button", { name: "Save core" }).click();
      await page.getByText("Synced from disk").waitFor({ timeout: 4000 });
      eq(p.readFile("persona/soul.md"), "# Soul\n\nEdited by e2e ✍️ — বাংলা", "soul.md");
    });

    await check(suite, "Persona: keystrokes during an in-flight poll are kept [BUG-14]", async () => {
      await goto("/voice");
      // Hold /api/persona so a poll is in flight while the user types.
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => (release = r));
      await page.route("**/api/persona", async (route: any) => {
        if (route.request().method() === "GET") await gate;
        await route.continue();
      });
      await page.waitForTimeout(3300); // let the next poll start and block
      await page.locator("#rules").fill("typed while polling");
      release();
      await page.waitForTimeout(800);
      await page.unroute("**/api/persona");
      eq(await page.locator("#rules").inputValue(), "typed while polling", "rules textarea");
    });

    await check(suite, "Persona: save failure shows an error, no unhandled rejection [BUG-15]", async () => {
      await goto("/voice");
      const before = consoleErrors.length;
      await page.locator("#recent").fill("will fail");
      await page.route("**/api/persona", (route: any) =>
        route.request().method() === "POST" ? route.fulfill({ status: 500, body: '{"error":"disk full"}' }) : route.continue()
      );
      await page.getByRole("button", { name: "Save core" }).click();
      await page.waitForTimeout(800);
      await page.unroute("**/api/persona");
      eq(consoleErrors.slice(before).filter((e) => e.startsWith("pageerror")), [], "unhandled rejections");
      consoleErrors.splice(before);
    });

    await check(suite, "Persona: contact profile create + edit", async () => {
      const r = await p.api("/api/persona/profile", { method: "POST", json: { kind: "contact", stem: "919812345678@s.whatsapp.net", content: "# Priya\n" } });
      eq(r.status, 200, "create");
      eq((await p.api("/api/persona/profile?kind=contact&stem=919812345678%40s.whatsapp.net")).body.content, "# Priya\n", "read back");
      await goto("/voice?tab=profiles");
      await page.getByText("919812345678@s.whatsapp.net").first().waitFor({ timeout: 3000 });
    });

    await check(suite, "Conversations: delete dialog cancel keeps file, confirm removes it", async () => {
      await goto("/conversations?jid=919812345678%40s.whatsapp.net");
      const file = path.join(p.dir, "data", "chats", "919812345678@s.whatsapp.net.md");
      const row = page.locator("li", { hasText: "919812345678@s.whatsapp.net" });
      await row.getByRole("button", { name: "Delete chat history" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
      assert(existsSync(file), "deleted on cancel");
      await row.getByRole("button", { name: "Delete chat history" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
      await page.waitForTimeout(800);
      assert(!existsSync(file), "file still exists");
    });

    await check(suite, "theme toggle persists across reload", async () => {
      await goto("/overview");
      await page.getByRole("button", { name: "Dark theme" }).click();
      await page.reload();
      await page.waitForTimeout(500);
      assert(await page.evaluate(() => document.documentElement.classList.contains("dark")), "dark after reload");
      await page.getByRole("button", { name: "Light theme" }).click();
      await page.reload();
      await page.waitForTimeout(500);
      assert(!(await page.evaluate(() => document.documentElement.classList.contains("dark"))), "light after reload");
      await page.getByRole("button", { name: "System theme" }).click();
    });

    await check(suite, "sidebar collapses to icons and expands again", async () => {
      await goto("/overview");
      const sidebar = page.locator("[data-slot=sidebar]").first();
      await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
      await page.waitForTimeout(400);
      eq(await sidebar.getAttribute("data-state"), "collapsed", "collapsed");
      await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
      await page.waitForTimeout(400);
      eq(await sidebar.getAttribute("data-state"), "expanded", "expanded");
    });

    await check(suite, "keyboard: Tab reaches the engine switch and chart controls", async () => {
      await goto("/overview");
      const seen = new Set<string>();
      for (let i = 0; i < 80; i += 1) {
        await page.keyboard.press("Tab");
        const d = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return el ? `${el.getAttribute("role") ?? el.tagName}:${el.getAttribute("aria-label") ?? ""}` : "";
        });
        seen.add(d);
      }
      assert([...seen].some((s) => s.startsWith("radio")), "engine radio not focusable");
      assert([...seen].some((s) => /chart|hour|heatmap|img|graphics|cell|gridcell/i.test(s)), `no chart focus: ${[...seen].slice(0, 15).join(", ")}`);
    });

    await check(suite, "keyboard: heatmap arrow keys move between cells [BUG-17]", async () => {
      await goto("/overview");
      const cell = page.locator('[role=grid] [tabindex="0"], [role=gridcell][tabindex="0"]').first();
      await cell.waitFor({ timeout: 3000 });
      await cell.focus();
      const before = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
      await page.keyboard.press("ArrowRight");
      const after = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
      assert(before !== after, `arrow did not move focus (${before})`);
    });

    await check(suite, "no unexpected console errors during interactions", async () => {
      // 500s injected by the mocked-failure checks above are asserted in those checks.
      eq(consoleErrors.filter((e) => !/status of 500|→ 500/.test(e)), [], "console errors");
    });
    await context.close();
  } finally {
    await browser.close();
    await p.stop();
  }
}

async function suiteMobile(pw: PW) {
  const suite = "mobile";
  console.log(`\n# ${suite}`);
  const p = await startPreview("default");
  const browser = await pw.chromium.launch();
  try {
    const { context, page, goto } = await openPage(browser, p, { vp: "mobile", scheme: "light" });
    await check(suite, "bottom tab bar navigates; More opens the full menu sheet", async () => {
      await goto("/overview");
      const nav = page.getByRole("navigation", { name: "Primary" });
      await nav.getByRole("link", { name: /Queue/ }).click();
      eq(new URL(page.url()).pathname, "/queue", "queue tab");
      await nav.getByRole("link", { name: /Chats|Conversations/ }).click();
      eq(new URL(page.url()).pathname, "/conversations", "chats tab");
      await nav.getByRole("button", { name: "More" }).click();
      const sheet = page.getByRole("dialog");
      await sheet.waitFor({ timeout: 2000 });
      await sheet.getByRole("link", { name: "Settings" }).click();
      eq(new URL(page.url()).pathname, "/settings", "settings via More");
      await sheet.waitFor({ state: "hidden", timeout: 2000 });
    });
    await check(suite, "queue list → detail → back", async () => {
      await goto("/queue");
      const list = page.getByRole("region", { name: "Waiting chats" });
      assert(await list.isVisible(), "list visible");
      await page.getByRole("button", { name: /Weekend Plans/ }).first().click();
      await page.getByPlaceholder("Write the reply in your own voice…").waitFor();
      assert(!(await list.isVisible()), "list hidden in detail view");
      await page.getByRole("button", { name: "Back to queue" }).click();
      await list.waitFor({ state: "visible", timeout: 3000 });
      const snap = await a11ySnapshot(page);
      assert(snap.overflowX <= 0, `overflow ${snap.overflowX}`);
    });
    await context.close();
  } finally {
    await browser.close();
    await p.stop();
  }
}

async function suiteScenarios(pw: PW) {
  const suite = "scenarios";
  console.log(`\n# ${suite}`);
  const browser = await pw.chromium.launch();
  const sweep = async (p: Preview, label: string, extra?: (page: any, goto: (r: string) => Promise<void>) => Promise<void>) => {
    for (const combo of [COMBOS[0]!, COMBOS[3]!]) {
      const { context, page, consoleErrors, goto } = await openPage(browser, p, combo);
      await check(suite, `${label} ${combo.vp}/${combo.scheme}: every route renders without errors or overflow`, async () => {
        for (const route of ROUTES) {
          await goto(route);
          const body = await page.locator("body").innerText();
          assert(body.length > 50, `${route} blank`);
          const snap = await a11ySnapshot(page);
          assert(snap.overflowX <= 0, `${route} overflow ${snap.overflowX}px`);
        }
        eq(consoleErrors, [], "console errors");
      });
      if (extra && combo.vp === "desktop") await extra(page, goto);
      await context.close();
    }
  };

  let p = await startPreview("empty");
  try {
    await sweep(p, "fresh install", async (page, goto) => {
      await check(suite, "fresh install: overview shows zeros, queue empty state", async () => {
        const s = (await p.api("/api/stats/overview")).body;
        eq([s.today.received, s.today.sentByTalky, s.claude.pending], [0, 0, 0], "zeros");
        await goto("/queue");
        await page.getByText("Nothing waiting").waitFor({ timeout: 3000 });
      });
    });
  } finally {
    await p.stop();
  }

  p = await startPreview("needs-qr");
  try {
    await sweep(p, "needs QR", async (page, goto) => {
      await check(suite, "needs QR: Settings shows the QR and sidebar says Needs QR scan", async () => {
        await goto("/settings");
        await page.locator("svg[viewBox] path, canvas").first().waitFor({ timeout: 3000 });
        await page.getByText("Needs QR scan").first().waitFor({ timeout: 3000 });
      });
    });
  } finally {
    await p.stop();
  }

  p = await startPreview("disconnected");
  try {
    await sweep(p, "disconnected", async (page, goto) => {
      await check(suite, "disconnected: queue warns and a send failure is reported", async () => {
        await goto("/queue");
        await page.getByText("WhatsApp not connected").first().waitFor({ timeout: 3000 });
        await page.getByPlaceholder("Write the reply in your own voice…").fill("hello");
        await page.getByRole("button", { name: /^Send/ }).click();
        await page.getByText(/Send failed/).waitFor({ timeout: 4000 });
        eq(p.sends().length, 0, "nothing recorded as sent");
      });
    });
  } finally {
    await p.stop();
  }

  p = await startPreview("paused");
  try {
    await sweep(p, "paused", async (page, goto) => {
      await check(suite, "paused at startup: banner on every page + PAUSED in the status strip", async () => {
        for (const route of ["/overview", "/queue", "/settings"]) {
          await goto(route);
          await page.getByText("Replies are paused").waitFor({ timeout: 3000 });
          assert(/PAUSED/.test(await page.locator("body").innerText()), `${route} strip`);
        }
      });
    });
  } finally {
    await p.stop();
  }

  p = await startPreview("huge");
  try {
    await check(suite, "huge: stats endpoint < 1.5s and caps chat list at 12", async () => {
      const t = Date.now();
      const s = (await p.api("/api/stats/overview")).body;
      assert(Date.now() - t < 1500, `took ${Date.now() - t}ms`);
      eq(s.chats.length, 12, "chats");
    });
    await sweep(p, "huge (60 chats, 40 groups, 40 queued)");
  } finally {
    await p.stop();
  }

  p = await startPreview("unicode");
  try {
    await sweep(p, "unicode/RTL/long", async (page, goto) => {
      await check(suite, "unicode: Bengali/Devanagari/Arabic names render intact", async () => {
        await goto("/queue");
        await page.getByText("দীপ্তি 🌸 Deep").first().waitFor({ timeout: 3000 });
        await goto("/queue?tab=unknown");
        await page.getByText("অচেনা নম্বর").first().waitFor({ timeout: 3000 });
      });
    });
  } finally {
    await p.stop();
  }

  p = await startPreview("malformed");
  try {
    await check(suite, "malformed files: every read endpoint still answers 200 JSON", async () => {
      for (const route of ["/api/chats", "/api/stats/overview", "/api/claude/pending", "/api/claude/status", "/api/logs/events", "/api/unauthorized"]) {
        const r = await p.api(route);
        eq(r.status, 200, route);
      }
      eq((await p.api("/api/claude/pending")).body.length, p.manifest.pending, "valid events kept");
    });
    await check(suite, "malformed unauthorized store (null) → 200 [] [BUG-20]", async () => {
      writeFileSync(path.join(p.dir, "data", "unauthorized-candidates.json"), "null");
      const r = await p.api("/api/unauthorized");
      eq([r.status, r.body], [200, []], "response");
    });
    await sweep(p, "malformed data");
  } finally {
    await p.stop();
  }

  p = await startPreview("default");
  try {
    const { context, page, goto } = await openPage(browser, p);
    await check(suite, "bot goes offline mid-session → offline state, then recovery toast", async () => {
      await goto("/overview");
      await p.stop();
      await page.getByText("Bot offline").first().waitFor({ timeout: 8000 });
      await page.getByText(/Cannot reach Talky API/).first().waitFor({ timeout: 2000 });
      await p.start();
      await page.getByText("Talky API reachable again").first().waitFor({ timeout: 8000 });
      await page.getByText("Linked").first().waitFor({ timeout: 4000 });
    });
    await check(suite, "WhatsApp drops mid-session → Settings shows pairing, recovers when linked", async () => {
      p.setState({ connection: "connecting", qr: "2@live-qr" });
      await goto("/settings");
      await page.getByText("Needs QR scan").first().waitFor({ timeout: 6000 });
      p.setState({ connection: "open", qr: null });
      await page.getByText("Linked").first().waitFor({ timeout: 6000 });
    });
    await context.close();
  } finally {
    await p.stop();
  }
  await browser.close();
}

// ---------------------------------------------------------------------------------------------

const pw = await loadPlaywright();
const suites: Array<[string, () => Promise<void>]> = [
  ["api-security", () => suiteApi()],
  ["stats", () => suiteStats()],
  ["routes", () => suiteRoutes(pw)],
  ["interactions", () => suiteInteractions(pw)],
  ["mobile", () => suiteMobile(pw)],
  ["scenarios", () => suiteScenarios(pw)]
];
for (const [name, run] of suites) {
  if (ONLY && !name.includes(ONLY)) continue;
  try {
    await run();
  } catch (err) {
    results.push({ suite: name, name: "suite crashed", ok: false, error: String(err), ms: 0 });
    console.log(`  ✗ suite crashed: ${err}`);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (process.env.E2E_RESULTS) writeFileSync(process.env.E2E_RESULTS, JSON.stringify(results, null, 2));
if (failed.length) {
  console.log("\nFailures:");
  for (const f of failed) console.log(`  [${f.suite}] ${f.name}\n      ${f.error?.split("\n")[0]}`);
  process.exit(1);
}

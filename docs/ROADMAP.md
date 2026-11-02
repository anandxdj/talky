# Talky roadmap and improvement plan

Status as of November 2026, after PR #2 (panel redesign, API hardening, `whatsapp.ts`
split, Pause replies). This document records what to improve next and why, so Talky
becomes a reliable application and a usable ecosystem for individuals and, optionally,
companies.

## 0. The open decision: personal assistant or business product?

Most priorities below depend on one choice:

| | Personal, local-first assistant | Product for businesses |
|---|---|---|
| Users | Individuals running it on their own machine | Companies and their staff |
| WhatsApp connection | Baileys (personal account) is acceptable | Must use the official WhatsApp Business Platform (Cloud API) |
| Roadmap stops at | Section 4 (ecosystem) | Continues through section 5 |

Until this is decided, sections 1–3 are useful either way.

---

## 1. Structural risk: the WhatsApp connection

Talky connects through **Baileys**, an unofficial reimplementation of WhatsApp Web.

- **Account risk:** WhatsApp's terms do not allow unofficial or automated clients.
  Accounts can be banned, and risk grows with automated volume.
- **Breakage risk:** a WhatsApp protocol change can break Baileys without warning.
  Talky is pinned to a pre-release (`baileys 7.0.0-rc.9`).
- **Business blocker:** no company can depend on this legally or operationally.

**Plan: a channel abstraction.** Put an interface between Talky's core (persona,
memory, decisions, queue, panel, MCP) and the messaging transport:

- `BaileysChannel` — personal account (today's behaviour).
- `CloudApiChannel` — official WhatsApp Business Platform for business use.
- Later: Telegram or other chat apps.

---

## 2. Reliability: never lose or duplicate work

| Problem today | Improvement |
|---|---|
| A message arriving mid-reply or during a crash can be lost or answered twice | **Durable inbox + idempotency**: record each WhatsApp message ID before processing and skip IDs already handled. Move the Claude queue and chat logs into the existing SQLite database. |
| A slow or failing Gemini call blocks or drops replies | Timeouts, bounded retries, a fallback model, and a visible "LLM unavailable" state in the panel. |
| Nothing restarts the process if it dies | Run under a supervisor (systemd, Docker restart policy, pm2); add a `/health` endpoint and a watchdog that alerts the owner's self-chat. |
| Synchronous file I/O on the message path; logs and media grow forever | Async I/O, log rotation, media retention and size caps. |
| Failures are often silent | Structured logs, an errors view in the panel, alerts to self-chat. |
| Known bugs (listed in PR #2) | Fix them — highest priority: voice-note fallback that can reach the wrong number, and the `randomBetween` crash after repeated "slower" instructions. |
| Tests only cover pure functions | An end-to-end harness with a fake WhatsApp socket, run in CI. |

## 3. Trust and safety: the bot speaks as the user

- **Per-chat approval modes:** `auto` (sends), `draft` (owner approves first), `off`.
  Sensible defaults: family and work chats start in `draft`.
- **Sensitive-topic guard:** money, health, legal matters and commitments are never
  auto-sent; the owner is asked instead.
- **Encryption at rest** for `data/` (chats and memory are plain Markdown today).
- **Redaction before LLM calls:** mask phone numbers, addresses and similar details.
- **Audit log:** every sent message with the reason and the model that wrote it,
  viewable in the panel.
- **Optional disclosure** to contacts that an assistant helps reply (an ethics choice for
  individuals; a legal requirement in some places for businesses).

## 4. Ecosystem: let other tools plug in

### 4.1 AI assistant integration via MCP (ChatGPT, Claude, Cursor, own agents)

The standard way to let an external AI read and act on Talky is a **Model Context
Protocol (MCP) server**. One adapter works with every MCP-capable client.

```
ChatGPT / Claude / Cursor ──MCP──► Talky MCP server (src/mcp/) ──► control API (127.0.0.1:4173)
```

Proposed tools:

| Read (default) | Write (opt-in, confirmation per call) |
|---|---|
| Today's stats, pending queue, who messaged | Send a message (allowlist enforced, blocked while paused) |
| Read a chat's recent history | Ack queue items / stay silent |
| Search messages and memory | Pause / resume replies |
| A contact's profile and communication rules | Allow / dismiss an unknown sender |

Connection options:

1. **Local (stdio) MCP** for Claude Desktop, Claude Code, Cursor — nothing exposed to
   the internet. Safest; recommended first.
2. **Remote (HTTPS) MCP** for ChatGPT. ChatGPT custom connectors (Developer Mode)
   only accept remote servers, so Talky would need a tunnel (e.g. Cloudflare Tunnel)
   plus OAuth. Plan eligibility varies (write actions appear limited to
   Business/Enterprise/Edu at the time of writing — verify in the account). Exposing a
   WhatsApp account to the internet is a real risk: read-only by default.
3. **Built-in "Ask Talky" chat** in the web panel using the same tools, with no
   external client or tunnel.

Open question: is the agent for the owner only, or for other people too? If others can
query it, per-person scopes over which chats they may read are required.

### 4.2 Other ecosystem work

- **LLM provider interface:** Gemini, Claude, OpenAI or local models (Ollama) behind
  one interface; also enables cheap fakes in tests.
- **Tool plugin system:** split `tool-executor.ts` (1,338 lines) into one small handler
  per tool, registered in a table.
- **Webhooks and an OpenAPI spec** for the control API (events: message received,
  reply sent, queue changed).
- **Packaging:** Docker image, one-command installer, possibly a desktop app.
- **Reply-quality evaluation:** a scored test set of realistic conversations (the voice
  fingerprint is a starting metric) so prompt or model changes can't silently degrade
  how Talky sounds.

## 5. Business product (only if chosen in section 0)

- Official WhatsApp Cloud API channel as the default (section 1).
- Team inbox: multiple agents, roles and permissions, bot → human hand-off, canned replies.
- Multi-tenant data isolation, SSO, admin console.
- Compliance: data export and deletion on request, retention policies, consent tracking.
- Hosted offering or a supported self-hosted deployment with backups.

---

## Suggested order

1. **Now (1–2 weeks):** merge PR #2; fix the known bugs; durable inbox + idempotency;
   LLM timeouts and fallback; health endpoint, auto-restart and alerts.
2. **Next:** local MCP server (read-only first); LLM provider interface; per-chat approval
   modes; Docker packaging.
3. **Then:** channel abstraction and the official Cloud API channel.
4. **Only for the business direction:** team inbox and multi-tenant features.

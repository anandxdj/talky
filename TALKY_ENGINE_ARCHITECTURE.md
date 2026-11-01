# Talky Engine: Architecture & Overview

Welcome to the **Talky** project! This document breaks down the core architecture, how the engine operates, and how to run it in simple terms.

## 🎯 What is Talky?

Talky is a completely local, self-hosted personal WhatsApp AI agent. Once linked to your personal WhatsApp account via QR code, it reads incoming messages and replies on your behalf using Google Gemini. It acts like a digital clone of you—mimicking your tone and communication style—while keeping all your data private on your machine.

---

## 🧩 Core Architecture & Key Components

Talky is built using **TypeScript** and optimized to run on **Bun**. The engine operates through a series of distinct modular layers:

### 1. 🟢 WhatsApp Integration (`src/whatsapp.ts`, `src/whatsapp-cli.ts`)

- **The Connector:** `WhatsAppAgent` uses the unofficial `baileys` library to handle persistent WhatsApp Web sessions, QR authentication and the inbound message loop.
- **Human Simulation:** It applies deliberate, human-like typing delays so replies don't land instantly.
- **Kept thin on purpose:** pure helpers live in focused modules (below) so the class mostly orchestrates. One-shot CLI helpers (list groups, proactive send) live in `whatsapp-cli.ts`.

### 2. 🛡️ Access Policy (`src/policy/access.ts`, `src/lid-map.ts`)

- **Who may reach the bot:** group allowlist and mutes, direct-chat mode (`allowlist` / `all` / `none`), self-chat, and whether a chat is routed to the Claude mediator. Allowlist entries match both identities of a contact (`<phone>@s.whatsapp.net` and `<lid>@lid`).
- Pure functions with injectable LID lookup → covered by `tests/policy-access.test.ts`.

### 3. 🧠 Decision Engine (`src/decision.ts`)

- **The Gatekeeper:** Not every message needs a reply. Hard rules (`@mentions`, allowlists) and soft rules (LLM-scored relevance) decide whether Talky steps in or stays quiet. Every decision is appended to `data/logs/decisions.md`.

### 4. 🎭 Persona Layer (`src/persona.ts`, `/persona` folder)

- **The Soul:** Markdown files (`soul.md`, `communication_rules.md`, per-contact and per-group profiles) define who the bot is and how it speaks.

### 5. 🗄️ Memory System (`src/memory.ts`, `src/memory-db.ts`, `src/embeddings.ts`)

- **The Brain:** Hybrid local memory — SQLite + FTS5 (BM25) + Gemini embeddings (cosine similarity, MMR, temporal decay). Markdown stays the source of truth. Optional Mem0 on top.

### 6. ✍️ Reply Shaping (`src/reply/parse.ts`, `src/reply/intents.ts`)

- Turns model output into WhatsApp messages: `|||` burst splitting (max 2 for Gemini replies, max 5 for mediated sends), `NO_REPLY` handling, text-form tool calls, and intent detection (tool list, voice note, GIF).

### 7. 🎙️ Media (`src/media/*`, `src/transcribe.ts`, `src/voice/`)

- MIME helpers, Gemini TTS prompts and PCM → WAV → Ogg/Opus transcoding, image generation URLs, sticker packs; voice-note transcription.

### 8. ⏰ Scheduling & Self-Chat (`src/scheduler.ts`, `src/reminders.ts`, `src/self-chat.ts`)

- Daily digests, reminders, and the self-DM assistant you command from your own number.

### 9. 🛠️ Tools (`src/tools.ts`, `src/tool-executor.ts`)

- Klipy GIFs, local file read/share (bounded by `localFileAllowedRoots`), stickers, images, TTS.

### 10. 🤝 Claude Mediator Bridge (`src/claude-bridge.ts`)

- Queues allowed inbound messages to `data/claude/pending.jsonl` (attachments to `data/media/`) for an external Claude Code session that replies through the HTTP API. Writes are crash-safe: rewrites go through a temp file + atomic rename, and a torn last line is terminated before the next append. Enqueue/ack are synchronous, so they can't interleave inside the single Talky process.

### 11. 🖥️ Control Server & Web Panel (`src/web/*`, `web-ui/`)

- `control-server.ts` serves the React panel and the `/api/*` REST API on `127.0.0.1` only.
- `auth.ts` guards every API request: loopback `Host` (anti DNS-rebinding) → no foreign `Origin` / `Sec-Fetch-Site: cross-site` → JSON-only writes → `X-Talky-Token` from `data/control-token`.
- Config writes go through `applyConfigPatch()` in `config.ts`: unknown keys and wrong types are rejected, values are normalised exactly like `config.yaml`, and command-executing / file-access keys (`claudeTriggerCommand`, `localFileAllowedRoots`, …) are locked to the YAML file.
- `stats.ts` derives dashboard analytics from data already on disk (chat logs, decision log, Claude queue): hourly outcomes, 14-day series, weekday × hour heatmap, per-chat stats, reply latency, and the "voice fingerprint" (your manual messages vs Talky's).
- `web-ui/` is a Vite + React + shadcn panel with light/dark themes, a mobile bottom-tab layout, and a dependency-free chart kit (`components/charts`) following colour-blind-safe palette rules.

### 🧪 Tests & CI

- `bun test` runs the suites in `tests/` (policy, reply parsing, intents, media/errors, decision, JID utils, Claude queue, API guard, config validation, stats).
- `.github/workflows/ci.yml` runs typecheck + tests and builds the web UI on every push and PR.

---

## ⚙️ How the Engine Processes a Message (The Loop)

1.  **Receive:** An incoming message hits the Baileys socket inside `whatsapp.ts`.
2.  **Filter Noise:** Status/broadcast and stale messages are dropped (`jid.ts`, startup grace).
3.  **Check access:** `policy/access.ts` applies allowlists, mutes and direct-chat mode; allowed messages may be routed to the Claude mediator queue instead of Gemini.
4.  **Decide:** `decision.ts` scores the message to see if a response is needed or allowed.
5.  **Recall Context:** If returning a reply, `memory.ts` and `embeddings.ts` fetch relevant past interactions and facts about the user.
6.  **Inject Persona:** The fetched memories, recent chat history, and your `/persona/soul.md` are combined into a massive prompt bundle via `prompts.ts`.
7.  **Generate:** `gemini.ts` sends this bundle to the Gemini AI to formulate the exact human-like reply.
8.  **Respond:** A human-like typing delay is applied, and the message is sent back to the chat via `whatsapp.ts`. `memory.ts` updates its database with this new interaction.

---

## 🚀 How to Run It!

I've already initialized the base configurations for you! Here is what you need to do next to actually launch the AI:

1. **Provide an API Key:**
   Open the `.env` file in the root of the project. Put your free Gemini API key on the line that says:
   `GOOGLE_GENERATIVE_AI_API_KEY=your_key_here`

2. **Configure your Soul (Optional but recommended):**
   Head into the `persona/soul.md` file and tweak the personality to match your exact tone.

3. **Start the Engine:**
   Run this in your terminal:

   ```bash
   bun run start
   ```

4. **Connect WhatsApp:**
   The terminal will output a QR Code. Open WhatsApp on your phone, navigate to **Linked Devices -> Link a Device**, and scan the QR code. You're now online! 🤖

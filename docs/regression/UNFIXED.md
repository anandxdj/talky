# Open bugs from the regression run

These 9 bugs came out of the regression run on `claude/regression-ui-testing` and are **not
fixed** on that branch. Each one either needs a product decision first, or is low-impact and
was kept out of scope to keep the fixes small.

The 39 other bugs found in the run are fixed; see [REPORT.md](REPORT.md) for the full table,
the coverage matrix and the fix commits.

| ID | Sev | Area | Blocked on | Effort |
| -- | --- | ---- | ---------- | ------ |
| [BUG-21](#bug-21--malformed-configyaml-breaks-the-api) | Medium | config | decision | small |
| [BUG-23](#bug-23--one-message-counted-twice-in-both-mode) | Low | stats | decision | small |
| [BUG-26](#bug-26--waiting-messages-rarely-highlighted-in-the-live-queue) | Low | Live queue | data-format change | medium |
| [BUG-27](#bug-27--quiet-chats-show-no-debug-events) | Low | Conversations | — | small |
| [BUG-34](#bug-34--messages-per-chat-cannot-be-cleared) | Low | Persona | — | small |
| [BUG-35](#bug-35--phone-typed-messages-labelled-talky-in-the-preview) | Low | Persona | — | small |
| [BUG-36](#bug-36--stale-qr-shown-while-the-bot-is-offline) | Low | Settings | — | small |
| [BUG-37](#bug-37--ack-silently-deletes-corrupt-queue-lines) | Low | mediator | decision | small |
| [BUG-38](#bug-38--conversations-has-no-empty-state-for-an-unknown-jid) | Low | Conversations | design | small |

---

## BUG-21 — Malformed `config.yaml` breaks the API

- **Severity:** Medium
- **Where:** `src/config.ts`, `loadConfig()` (line 181)
- **Repro:** put invalid YAML in `config.yaml` (e.g. `a: [1`), or a top-level list
  (`- a\n- b`), then open the panel.
- **Actual:**
  - Invalid YAML: every endpoint that reads the config (`/api/config`, `/api/claude/status`,
    `/api/stats/overview`, …) answers 500. Since the BUG-12 fix this is a JSON error, not a
    stack page.
  - A YAML list: it is spread into the config as `{"0": "a", "1": "b", …}`, and the next
    save writes those keys back.
- **Expected:** a clear error at startup, or a safe fallback.
- **Why not fixed:** what Talky should do is a product decision. Falling back to defaults
  silently changes who the bot answers (allowlists would become empty or default), which is
  worse than failing.
- **Suggested fix:**
  - In `loadConfig`, reject a parse result that is not a plain object.
  - On a YAML syntax error, fail `bun run start` with the line number. Do not start with
    defaults.

## BUG-23 — One message counted twice in "Both" mode

- **Severity:** Low
- **Where:** `src/web/stats.ts`, `computeOverviewStats` (lines 333 and 349)
- **Repro:** engine set to **Both** (`claudeMediatorExclusive: false`). One inbound message
  gets a Gemini decision and is also queued for Claude.
- **Actual:** it is counted twice in `reachedEngine`. Overview can say "5 messages came in.
  8 needed a call."
- **Why not fixed:** the definition needs a decision. Should "needed a call" count messages,
  or engine decisions?
- **Suggested fix:** if it should count messages, de-duplicate by `chatJid` + timestamp
  within a few seconds, or better, by message id once BUG-26's id is stored.

## BUG-26 — Waiting messages rarely highlighted in the Live queue

- **Severity:** Low
- **Where:** `web-ui/src/pages/QueuePage.tsx` (lines 214 and 249)
- **Repro:** in production, open a waiting chat in the Live queue.
- **Actual:** the "waiting" ring almost never appears. The history line and the queue event
  get their timestamps from two separate `new Date()` calls, with media and transcription
  awaits in between (`src/whatsapp.ts`), so exact `timestampISO` matching fails.
- **Why not fixed:** a reliable match needs the WhatsApp message id in both records. That
  changes the chat-history file format.
- **Suggested fix:**
  - Add an optional id token to the history header line, e.g.
    `- <ISO> | incoming | <sender> | id=<msgId>`. Old files stay readable because the
    parser ignores unknown tokens.
  - Put the same id in the Claude event, and match on it.

## BUG-27 — Quiet chats show no debug events

- **Severity:** Low
- **Where:** `web-ui/src/context/TalkyConsoleContext.tsx` (line 138);
  `web-ui/src/pages/ChatsPage.tsx` (line 105)
- **Repro:** open a quiet chat in Conversations while busy chats are active.
- **Actual:** "No debug events for this chat". The panel only fetches the latest 300 events
  across all chats, then filters them on the client.
- **Suggested fix:** when a chat is selected, fetch `/api/logs/events?chatJid=<jid>&limit=300`
  (the server already supports `chatJid`).

## BUG-34 — "Messages per chat" cannot be cleared

- **Severity:** Low
- **Where:** `web-ui/src/pages/PersonaPage.tsx` (line 669)
- **Repro:** Voice & persona → From chats → clear the "Messages per chat" field to type a
  new number.
- **Actual:** `Number(v) || 36` snaps the value back to 36 the moment the field is empty.
  Values above 500 are shown but quietly clamped later.
- **Suggested fix:** keep the raw string in state, clamp to 1–500 on blur or use, and show
  the limit.

## BUG-35 — Phone-typed messages labelled "Talky" in the preview

- **Severity:** Low
- **Where:** `web-ui/src/pages/PersonaPage.tsx` (line 319)
- **Repro:** Voice & persona → From chats → Preview a thread that has messages you typed on
  your phone.
- **Actual:** every outgoing line is labelled "Talky". The Conversations page gets this
  right.
- **Suggested fix:** label the line "You" when `msg.manualOutbound` is true.

## BUG-36 — Stale QR shown while the bot is offline

- **Severity:** Low
- **Where:** `web-ui/src/context/TalkyConsoleContext.tsx` (line 126); Settings → WhatsApp
  pairing
- **Repro:** the bot stops while Settings shows a pairing QR.
- **Actual:** the old QR stays on screen, but it can no longer be scanned. The offline banner
  and "Bot offline" status do show.
- **Suggested fix:** when the status poll fails, hide the QR (or grey it out and mark it
  stale) until a fresh status arrives.

## BUG-37 — Ack silently deletes corrupt queue lines

- **Severity:** Low
- **Where:** `src/claude-bridge.ts`, `ackClaudeEvents()` (line 223)
- **Repro:** `data/claude/pending.jsonl` has a corrupt or partial line. Ack any valid event.
- **Actual:** the rewrite keeps only the events it could parse, so the corrupt line is
  deleted without a trace. It is not moved to `handled.jsonl`. Valid events are never lost.
- **Why not fixed:** this needs a decision on where unreadable lines should go.
- **Suggested fix:** append unparseable lines to `data/claude/corrupt.jsonl` (with a
  timestamp) before rewriting.

## BUG-38 — Conversations has no empty state for an unknown `?jid=`

- **Severity:** Low
- **Where:** `web-ui/src/pages/ChatsPage.tsx` (line 87)
- **Repro:**
  - Open `/conversations?jid=<jid>` for a chat with no history file. Overview's "Who Talky
    talks to" rows can link to such chats, because they are built from decisions and Claude
    events.
  - Or delete the selected chat from another tab.
- **Actual:**
  - Unknown jid: nothing is selected and no message appears.
  - Deleted chat: the page shows a loading skeleton forever.
- **Why not fixed:** the empty state needs a design.
- **Suggested fix:** show "No saved history for <jid>", with a link back to the thread list.

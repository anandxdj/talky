# Regression test report — web panel, control API and engine

Branch `claude/regression-ui-testing` (from `claude/project-overview-kpmju0`, PR #2).
Date: 2026-11-02.

## Summary

_Status: bugs found, fixes in progress — this section is updated when fixing ends._

| Severity | Found |
| -------- | ----- |
| High     | 6     |
| Medium   | 12    |
| Low      | 21    |
| Previously known (PR #2) | 9 |
| **Total** | **48** |

## How it was tested

- **Harness.** `scripts/preview-server.ts` (`bun run preview:demo`) runs the **real** control
  server (`src/web/control-server.ts`) against a fake WhatsApp runtime in a seeded temp
  directory. It supports these scenarios: `default`, `empty`, `disconnected`, `needs-qr`,
  `paused`, `huge`, `unicode` and `malformed`.
  - The fake runtime records every send and session action in `data/preview-sends.jsonl`, so
    tests can check them.
  - It re-reads `data/preview-state.json` on every status call, so a test can change the
    WhatsApp connection while the session is live.
  - It writes `preview-manifest.json` with the expected stats. These numbers come from
    local-calendar arithmetic, independent of `stats.ts`.
- **Suite.** `tests/e2e/run.ts` (`bun run test:e2e`) uses Playwright with the pre-installed
  Chromium. Every check that reproduces a bug is tagged `[BUG-xx]`. Screenshots of failures go
  to `$E2E_SHOTS`.
- **Unit tests.** Engine bugs get unit tests under `tests/`.
- **Code review.** Two independent read-throughs: one of the panel, one of the backend. Every
  finding listed below was reproduced by a test, unless the "Found by" column says
  "code reading".
- **Existing checks** passed before any change:
  - root `tsc --noEmit`
  - `bun test` (164/164)
  - web-ui `tsc -b`, `eslint` and `vite build`

### First run, before fixes

| Suite | Checks | Pass | Fail | Notes |
| ----- | ------ | ---- | ---- | ----- |
| routes (8 routes × light/dark × 1440/390, redirects, persona tabs) | 46 | 46 | 0 | Checked: no horizontal scroll at 390px, every control has an accessible name, theme follows `prefers-color-scheme`, old URLs keep their query string, unknown routes go to /overview |
| api-security | 27 | 15 | 12 | 401/403/415/421 guards, locked keys, static traversal and chat-delete traversal pass |
| stats (New_York, Kolkata, Lord_Howe, UTC) | 16 | 15 | 1 | Fails only in New_York: US DST ended on 2026-11-01, inside the 7-day window |
| interactions (desktop) | 27 | 15 | 12 | One failure was the final console-error sweep, which was caused by the mocked 500s |
| mobile (390×844) | 2 | 2 | 0 | |
| scenarios (fresh install, needs QR, disconnected, paused, huge, unicode/RTL, malformed, bot offline → recovery, WhatsApp drop → recovery) | 24 | 21 | 3 | All 3 failures are BUG-20 |

## Coverage matrix

| Area | Scenario | Light | Dark | 1440 | 390 | Result |
| ---- | -------- | :---: | :--: | :--: | :--: | ------ |
| Routes | /overview, /queue (both tabs), /conversations (± ?jid), /voice, /access, /settings | ✓ | ✓ | ✓ | ✓ | pass |
| Routes | /dashboard /inbox /chats /persona /allowlists /actions keep their query string; unknown → /overview | ✓ | | ✓ | | pass |
| Voice | fingerprint + Core files / Contacts & groups / From chats tabs | ✓ | ✓ | ✓ | ✓ | pass |
| Overview | engine switch Gemini / Claude / Both → config.yaml | ✓ | | ✓ | | pass |
| Pause | Pause → banner + PAUSED strip + 409 without force → Resume | ✓ | | ✓ | ✓ | pass |
| Live queue | composer sends with force while paused | ✓ | | ✓ | | pass |
| Live queue | multi-event thread ×2, Stay silent acks all → handled.jsonl | ✓ | | ✓ | | pass |
| Live queue | ⌘↵ sends; `\|\|\|` splits | ✓ | | ✓ | | pass |
| Live queue | ⌘↵ with more than 5 parts / ⌘↵ twice | ✓ | | ✓ | | **fail** BUG-03 |
| Live queue | send OK, ack fails | ✓ | | ✓ | | **fail** BUG-16 |
| Live queue | attachment content type | ✓ | | ✓ | | **fail** BUG-19 |
| Live queue | mobile list ↔ detail ↔ back | ✓ | | | ✓ | pass |
| Unknown senders | allow / dismiss | ✓ | | ✓ | | pass |
| Unknown senders | allow fails | ✓ | | ✓ | | **fail** BUG-15 |
| Conversations | delete dialog: cancel keeps the file, confirm deletes it | ✓ | | ✓ | | pass |
| Persona | edit → Unsaved → Save core → soul.md | ✓ | | ✓ | | pass |
| Persona | typing during a poll; save failure | ✓ | | ✓ | | **fail** BUG-14, BUG-15 |
| Persona | contact profile create / read / list | ✓ | | ✓ | | pass |
| Access rules | add + save; reset discards | ✓ | | ✓ | | pass |
| Access rules | save after an engine change elsewhere; edit an existing row | ✓ | | ✓ | | **fail** BUG-05, BUG-07 |
| Settings | repair; factory reset needs typed RESET; cancel does nothing | ✓ | | ✓ | | pass |
| Settings | apply model while paused; relink confirmation | ✓ | | ✓ | | **fail** BUG-06, BUG-18 |
| Shell | theme toggle persists over reload; sidebar collapse; bottom tabs + More sheet | ✓ | | ✓ | ✓ | pass |
| Keyboard | Tab reaches engine radios and charts | ✓ | | ✓ | | pass |
| Keyboard | heatmap arrow keys | ✓ | | ✓ | | **fail** BUG-17 |
| Data | fresh install (no data, empty persona) | ✓ | ✓ | ✓ | ✓ | pass |
| Data | WhatsApp needs QR (QR in Settings) / disconnected (send fails visibly) | ✓ | ✓ | ✓ | ✓ | pass |
| Data | 60 chats × 120 msgs, 40 groups, 40 queued (stats < 1.5s) | ✓ | ✓ | ✓ | ✓ | pass |
| Data | Bengali / Devanagari / Arabic RTL / emoji / very long names and text | ✓ | ✓ | ✓ | ✓ | pass |
| Data | malformed lines in chats / decisions / jsonl | ✓ | ✓ | ✓ | ✓ | pass |
| Data | malformed unauthorized store | ✓ | ✓ | ✓ | ✓ | **fail** BUG-20 |
| Data | bot stopped mid-session → "Bot offline" + toast → restart → "reachable again" | ✓ | | ✓ | | pass |
| Data | WhatsApp drops mid-session → Needs QR → re-linked | ✓ | | ✓ | | pass |
| Stats | today / hourly / 14-day / heatmap / per-chat daily7d vs seeded data in 4 time zones | n/a | | | | **fail** BUG-02 (DST) |
| API | 401 missing/invalid token, 403 foreign Origin / cross-site, 415 text/plain, 421 bad Host | n/a | | | | pass |
| API | locked and unknown config keys rejected; 5 MB body; malformed JSON → 400 | n/a | | | | pass |
| API | static path traversal (encoded `..`), chat-delete traversal | n/a | | | | pass |
| API | stem / media traversal → 400 JSON; GET failures as JSON | n/a | | | | **fail** BUG-12 |
| API | ranges, enums, body shape, resolve validation, >5 parts, send-file policy, `limit=abc`, `/apiconfig` | n/a | | | | **fail** BUG-04/08/09/10/11/13/30/31 |
| A11y | all buttons and links have an accessible name; no horizontal scroll at 390px | ✓ | ✓ | ✓ | ✓ | pass |
| Console | no errors or React warnings on any route, any scenario | ✓ | ✓ | ✓ | ✓ | pass, except BUG-20 |

## Bugs

"Contacts" marks fixes that **change what the bot sends to contacts, or when it sends**.
Every other fix only affects the panel, the local API or statistics.

| ID | Sev | Area | Steps to reproduce | Expected | Actual | Evidence | Root cause | Fix | Status |
| -- | --- | ---- | ------------------ | -------- | ------ | -------- | ---------- | --- | ------ |
| BUG-01 | High | engine / history | A contact sends a multi-line message, or a line like `- <ISO> \| outgoing \| me \| user` | Full text is stored; contacts cannot add history entries | Only the first line is kept. A crafted line is parsed as a separate entry (for example a fake "you said" line). Gemini, Claude (`/api/claude/context`) and the stats all read it | unit test | `appendChatHistory` writes `  ${text}` without indenting continuation lines; the parser reads one line | | open |
| BUG-02 | Medium | stats | `TZ=America/New_York`, 2 Nov 2026 (DST ended 1 Nov). Seed a message at 00:20 on each day | Heatmap and `daily7d` cover the last 7 local days | A message 6 days ago at 00:20 is dropped from the heatmap and `received7d`; every day before the change is shifted one slot in `daily7d` (spring: an extra day leaks in) | e2e `stats` | `todayStart - 6*DAY_MS` is not local midnight across DST; same for the 14-day and voice windows | | open |
| BUG-03 | High | Live queue | Type `1\|\|\|2\|\|\|3\|\|\|4\|\|\|5\|\|\|6`, press Ctrl/⌘+Enter. Or press Ctrl+Enter twice quickly | Blocked like the disabled Send button; one send | 5 messages sent, toast says "Sent 6 messages". The double press sends the message **twice** to the contact | [screenshot](screenshots/bug-03-six-parts-toast.png), e2e | `onKeyDown` calls `send()` directly, skipping the button's `busy` and `>5` guards | | open |
| BUG-04 | Medium | API | `POST /api/claude/send` with 6 `\|\|\|` parts | 400, nothing sent (CLAUDE.md: max 5) | 200 `parts: 5`; the 6th part is dropped silently | e2e | `splitMediatedText` slices to 5 | | open |
| BUG-05 | High | Access rules | Make an edit on Access rules (unsaved), change the engine on Overview (or allow a sender, or pick a model), then Save | Only the access edits are saved | The whole stale draft is posted, so the engine, newly allowed senders and the model are reverted | e2e | `saveConfigDraft` posts the full draft; the draft is frozen while dirty | | open |
| BUG-06 | High | Settings | Pause replies (or switch engine) in another tab or within the 3s poll window, then Apply model | Only `model` changes | The whole last-polled config is posted. This can **un-pause replies** or revert the engine | e2e | `applyGeminiModel` posts `{...config, model}` | | open |
| BUG-07 | High | Access rules | Click into an allowed JID and type a character; or clear it to retype it | Normal editing | Focus is lost after every keystroke. Clearing the field deletes the row; typing a duplicate deletes it; blur moves the row to the end | e2e | Row key is `${jid}-${i}` (it changes as you type), and lists are normalised on every keystroke | | open |
| BUG-08 | High | API | `POST /api/claude/send-file {"to":…, "path":"<repo>/data/control-token"}` (or `wa_auth/creds.json`, `.env`) to any chat, including non-allowed groups | Same file policy as the share tool; group permission checked | Any readable file is sent to any chat | e2e | Only `existsSync` is checked | | open |
| BUG-09 | Medium | config | `POST /api/config {"historyWindow":-3,"dailyMessageLimit":-5,"minReplyDelayMs":9000,"maxReplyDelayMs":1}` | Rejected | Saved. `historyWindow: -3` makes `slice(3)` send the **whole** history to the LLM; a negative limit blocks every reply; min > max | e2e | No range checks in `normalizeConfig` / `applyConfigPatch` | | open |
| BUG-10 | Medium | config | With `directChatMode: all`, `POST {"directChatMode":"ALL"}` | Rejected; value stays `all` | `rejectedKeys: []`, value silently resets to `allowlist` (same for the other enums) | e2e | Only `typeof` is checked; `normalizeConfig` falls back to the default | | open |
| BUG-11 | Medium | API / Unknown senders | `POST /api/unauthorized/resolve {"action":"allow","jid":"91…@s.whatsapp.net"}` with no `listType`; or `jid: ""` | DM goes to the direct allowlist; empty jid → 400 | DM is added to **allowedGroupJids**; `""` is accepted | e2e | `else` branch defaults to groups; no validation | | open |
| BUG-12 | Medium | API | `GET /api/persona/profile?stem=../x&kind=contact`; `GET /api/persona` with a missing persona file; `GET /api/claude/media?file=.` | 400/404/500 JSON | Bun's 500 HTML page with **source code, stack and absolute paths** | [screenshot](screenshots/bug-12-stack-trace-500.png), e2e | GET handlers have no try/catch and `serve` has no `error` handler | | open |
| BUG-13 | Low | API | `GET /api/logs/events?limit=abc` | Default limit | `[]` | e2e | `Math.max(10, NaN)` is NaN | | open |
| BUG-14 | Medium | Persona | Start typing in Soul or Rules while a poll is in flight | Keystrokes kept | First keystrokes are replaced by the server copy, while the page still says "Unsaved" | e2e | `fetchData` reads `personaDirty` from a stale closure | | open |
| BUG-15 | Medium | Persona / Unknown senders | Stop the bot (or the server returns an error), click Save core or Allow / Dismiss | Error toast | No feedback; unhandled promise rejection | e2e | `savePersona` / `resolveUnauthorized` throw; callers use `void` | | open |
| BUG-16 | Medium | Live queue | Send succeeds but `/api/claude/ack` fails | "Sent, but could not mark handled" | Toast "Send failed: …", draft kept. Retrying **sends the message again** | [screenshot](screenshots/bug-16-send-failed-after-send.png), e2e | Send and ack are in one try block | | open |
| BUG-17 | Low | a11y / Overview | Tab to the heatmap, press arrow keys | Focus moves between cells | Focus stays put; 167 of 168 cells can't be reached by keyboard | e2e | Roving tabindex without a key handler | | open |
| BUG-18 | Medium | Settings | Click **Run relink** | Confirmation (it deletes `wa_auth/` and logs out WhatsApp) | Runs immediately | [screenshot](screenshots/bug-18-relink-no-confirm.png), e2e | No dialog (factory reset has one) | | open |
| BUG-19 | Low | Live queue | Open a PDF attachment | Opens as PDF | Served as `application/octet-stream`: a nameless download. A 404 body would also be "opened" as the file | e2e | Fixed content type; no `res.ok` check | | open |
| BUG-20 | Low | Unknown senders | `data/unauthorized-candidates.json` contains `null` (or an array) | Treated as empty | `GET /api/unauthorized` 500 on every poll; `recordUnauthorized` throws in the message handler | e2e | `JSON.parse` result not shape-checked | | open |
| BUG-21 | Medium | config | Malformed `config.yaml` (bad YAML, or a top-level list) | Clear error at start / ignored | Every config-reading endpoint 500s; a YAML list is spread into the config and written back | code reading + manual run | `loadConfig` trusts the parse result | — | **not fixed** (see below) |
| BUG-22 | Medium | mediator | A line such as `{}` or `{"id":1}` in `pending.jsonl` | Watcher and API agree | `wait-for-events.ts` exits immediately each time, but `/api/claude/pending` is empty → a session wakes in a loop with nothing to ack | unit test | Watcher counts any JSON line; the API requires string `id` + `chatJid` | | open |
| BUG-23 | Low | stats | Engine "Both": one message gets a Gemini decision and a Claude event | Counted once | "5 messages came in. 8 needed a call." — counted twice in `reachedEngine` | e2e (seed) | Decisions and Claude events are summed | — | **not fixed** (definition decision) |
| BUG-24 | Low | stats | Manual media send from the phone (`[media]`) | Not a word | Counted as a 1-word lowercase message in the voice fingerprint | unit test | `wordCount` ignores only `[empty]` | | open |
| BUG-25 | Low | Live queue | Chat waited 40 min, contact adds "?" now | Bar red / overdue | "14m to target" — measured from the newest event | code reading | `QueueItem` gets the thread head, not the oldest event | | open |
| BUG-26 | Low | Live queue | Open a waiting chat in production | Waiting messages highlighted | Rarely highlighted: history and queue timestamps are taken at different moments | code reading | Matches on exact `timestampISO` | — | **not fixed** (needs message ids in history) |
| BUG-27 | Low | Conversations | Open a quiet chat while busy chats are active | Its debug events | "No debug events" — only the global latest 300 are fetched | code reading | Not filtered by `chatJid` server-side | — | not fixed |
| BUG-28 | Low | API | `POST /api/claude/send` while WhatsApp is disconnected | 503 (retryable) | 400 for every failure | e2e (scenario) | Single catch → 400 | — | not fixed |
| BUG-29 | Low | API | `GET /apiconfig` (no slash) | 404 | Served as `/api/config` | e2e | `startsWith("/api")` | | open |
| BUG-30 | Low | API | `POST /api/config` with body `[1,2]` | 400 | 200; config rewritten | e2e | Non-object bodies become `{}` | | open |
| BUG-31 | Low | panel | A poll response is non-JSON 200 (e.g. Vite fallback page) | Others still applied | Whole poll rejected; offline toast never shows | code reading | `return res.json()` not awaited inside `try` | | open |
| BUG-32 | Low | a11y / Conversations | Screen reader on the thread list | Each delete button names its chat | Every row is "Delete chat history" | e2e (selector) | Static `aria-label` | | open |
| BUG-33 | Low | auth | `Origin: http://LOCALHOST:4173` | Allowed (same origin) | 403 (fails closed — not a security issue) | code reading | Origin not lower-cased | — | not fixed |
| BUG-34 | Low | Persona | Clear "Messages per chat" | Field can be emptied while typing | Snaps back to 36; >500 shown but clamped | code reading | `Number(v) \|\| 36` | — | not fixed |
| BUG-35 | Low | Persona | Preview a thread with phone-typed messages | Labelled "You" | Labelled "Talky" | code reading | `manualOutbound` ignored | — | not fixed |
| BUG-36 | Low | Settings | Bot dies mid-pairing | QR hidden / marked stale | Old QR keeps showing | code reading | Last status retained when offline | — | not fixed |
| BUG-37 | Low | mediator | Ack an event while `pending.jsonl` has a corrupt line | Corrupt line kept or archived | Silently deleted (no audit trail) | code reading | Rewrite keeps parsed events only | — | not fixed |
| BUG-38 | Low | Conversations | Open `?jid=` for a chat with no history file (e.g. from an Overview link) | "No history" message | Nothing selected, no message; a deleted selected chat shows a skeleton forever | code reading | No not-found state | — | not fixed |
| BUG-39 | Low | Settings | Factory reset | Toast points to Settings | "Scan the new QR in Actions" (old page name) | code reading | Stale copy | — | not fixed |

### Previously known bugs (PR #2 description / `docs/ROADMAP.md`)

| ID | Sev | Area | Bug | Contacts | Fix | Status |
| -- | --- | ---- | --- | -------- | --- | ------ |
| BUG-K1 | High | `src/jid.ts` `buildMediaSendTargets` | Voice-note retry to `<lid-digits>@s.whatsapp.net` can reach a stranger | **yes** | | open |
| BUG-K2 | High | `src/utils.ts` `randomBetween` | `crypto.randomInt` throws on fractional bounds; after 4–5 "slower" instructions every reply throws | **yes** | | open |
| BUG-K3 | Medium | `src/policy/access.ts` | Muted-group check is case-sensitive (the allowlist check isn't) | **yes** | | open |
| BUG-K4 | Medium | `src/reply/parse.ts` | `)` inside a quoted tool-call argument cuts it short; leftover `')` can be sent | **yes** | | open |
| BUG-K5 | Medium | `src/utils.ts` | `tokenOverlapScore` / `jaccardTokenSimilarity` split on ASCII only: Bengali/Devanagari never match | **yes** (memory recall) | | open |
| BUG-K6 | Low | `src/memory-extraction.ts` | `"my "` substring cue: "army", "economy" count as personal facts | **yes** (memory) | | open |
| BUG-K7 | Medium | `src/memory-extraction.ts` | `Boolean("false")` stores facts the classifier rejected | **yes** (memory) | | open |
| BUG-K8 | Low | `src/policy/access.ts` | `buildDirectIdentifiers` adds `""` for non-JID input, so two non-JIDs match | maybe (no current caller) | | open |
| BUG-K9 | Medium | `src/reply/parse.ts` | All-caps tool calls (`SEND_GIF(...)`) stripped from text but never run | **yes** | | open |

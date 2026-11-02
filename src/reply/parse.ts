import { compactText } from "../utils";

const TOOL_CALL_START = /(?:default_api\.)?(list_available_tools|list_local_files|read_local_file|share_local_file|send_sticker|send_gif|send_klipy_gif|send_voice_reply|end_voice_reply|send_image_reply|send_meme_reply|send_styled_quote_card|send_voice_plus_text|send_reaction_combo)\s*\(/gim;

/**
 * Index of the `)` closing a tool-call argument list that starts at `from` (just after `(`), or
 * -1. Quoted strings may contain `)`; a quote with no closing partner is treated as a literal.
 * A linear scan, not a regex: this also runs on incoming contact text, and a quote-aware regex
 * with a fallback for lone quotes backtracks exponentially when no `)` follows.
 */
function findToolArgsEnd(text: string, from: number): number {
  let quote: string | null = null;
  let quoteStart = -1;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === ")") return i;
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      quoteStart = i;
    }
  }
  // Unclosed quote: treat it as an ordinary character and use the first `)` after it.
  return quote ? text.indexOf(")", quoteStart + 1) : -1;
}

/** Every known text tool call in `text` with its raw argument string and span. */
function scanTextToolCalls(text: string): Array<{ name: string; rawArgs: string; start: number; end: number }> {
  const calls: Array<{ name: string; rawArgs: string; start: number; end: number }> = [];
  const pattern = new RegExp(TOOL_CALL_START.source, "gim");
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(text)) !== null) {
    const argsStart = match.index + match[0].length;
    const close = findToolArgsEnd(text, argsStart);
    if (close < 0) continue;
    calls.push({ name: match[1] ?? "", rawArgs: text.slice(argsStart, close), start: match.index, end: close + 1 });
    pattern.lastIndex = close + 1;
  }
  return calls;
}

export function parseTextToolCalls(
  text: string
): Array<{ id?: string; name: string; args: Record<string, unknown> }> {
  if (!text) return [];

  const allowedNames = new Set([
    "list_available_tools",
    "list_local_files",
    "read_local_file",
    "share_local_file",
    "send_sticker",
    "send_gif",
    "send_klipy_gif",
    "send_voice_reply",
    "end_voice_reply",
    "send_image_reply",
    "send_meme_reply",
    "send_styled_quote_card",
    "send_voice_plus_text",
    "send_reaction_combo"
  ]);

  const calls: Array<{ id?: string; name: string; args: Record<string, unknown> }> = [];
  for (const found of scanTextToolCalls(text)) {
    const name = compactText(found.name);
    if (!name || !allowedNames.has(name)) continue;
    calls.push({
      name,
      args: parseTextToolArgs(found.rawArgs)
    });
  }

  return calls;
}

export function parseTextToolArgs(raw: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const input = compactText(raw);
  if (!input) return args;

  const keyValuePattern =
    /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*('(?:\\'|[^'])*'|"(?:\\"|[^"])*"|`(?:\\`|[^`])*`|[^,]+)(?:,|$)/g;

  let match: RegExpExecArray | null = null;
  while ((match = keyValuePattern.exec(raw)) !== null) {
    const key = compactText(match[1] ?? "");
    const valueRaw = compactText(match[2] ?? "");
    if (!key) continue;
    args[key] = parseTextToolArgValue(valueRaw);
  }

  if (Object.keys(args).length === 0 && input) {
    args.path = parseTextToolArgValue(input);
  }

  return args;
}

export function parseTextToolArgValue(raw: string): unknown {
  const value = compactText(raw);
  if (!value) return "";

  const wrappedSingle = value.startsWith("'") && value.endsWith("'");
  const wrappedDouble = value.startsWith('"') && value.endsWith('"');
  const wrappedBacktick = value.startsWith("`") && value.endsWith("`");
  if (wrappedSingle || wrappedDouble || wrappedBacktick) {
    return value.slice(1, -1);
  }

  const lowered = value.toLowerCase();
  if (lowered === "true") return true;
  if (lowered === "false") return false;
  if (lowered === "null") return null;

  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return asNumber;

  return value;
}

export function stripParsedToolCallText(text: string): string {
  if (!text) return "";
  // Strip call-style: send_gif(query='...') or default_api.send_gif(...)
  let result = "";
  let cursor = 0;
  for (const call of scanTextToolCalls(text)) {
    // Also drop an inline-code backtick and whitespace wrapped around the call.
    let start = call.start;
    while (start > cursor && /\s/.test(text[start - 1]!)) start -= 1;
    if (start > cursor && text[start - 1] === "`") start -= 1;
    let end = call.end;
    while (end < text.length && /\s/.test(text[end]!)) end += 1;
    if (text[end] === "`") end += 1;
    result += `${text.slice(cursor, start)} `;
    cursor = end;
  }
  result += text.slice(cursor);
  // Strip ```tool_outputs {...}``` blocks that the model sometimes emits in text
  result = result.replace(/```tool_outputs[\s\S]*?```/gi, " ");
  // Strip any remaining fenced code block that contains only JSON/dict-like content (tool result blobs)
  result = result.replace(/```[a-z_]*\s*\{[\s\S]*?\}\s*```/gi, " ");
  return compactText(result);
}

export function normalizeReplyOutput(raw: string): string {
  const trimmed = compactText(raw);
  if (!trimmed) return "";
  if (/^NO_REPLY$/i.test(trimmed)) return "";
  const withoutToken = compactText(trimmed.replace(/\bNO_REPLY\b/gi, ""));
  return withoutToken;
}

export function splitReplyOutputToMessages(reply: string): string[] {
  const normalized = normalizeReplyOutput(reply);
  if (!normalized) return [];
  if (!normalized.includes("|||")) return [normalized];
  const cleaned = normalized
    .split("|||")
    .map((part) => compactText(part))
    .filter((part) => part.length > 0);
  // Separator-only output (e.g. "|||") has no real content: send nothing rather than
  // the literal separator. (Previously returned [normalized], i.e. sent "|||".)
  if (cleaned.length === 0) return [];
  return cleaned.slice(0, 2);
}

/** Max WhatsApp messages a single Claude-mediator send may produce. */
export const MEDIATED_SEND_MAX_PARTS = 5;

/**
 * Split Claude-mediator send text on `|||` into trimmed, whitespace-compacted, non-empty
 * chunks (max MEDIATED_SEND_MAX_PARTS; extra chunks are dropped). Unlike
 * splitReplyOutputToMessages this does not strip NO_REPLY tokens.
 */
export function splitMediatedText(text: string): string[] {
  return mediatedTextParts(text).slice(0, MEDIATED_SEND_MAX_PARTS);
}

/** All non-empty `|||` parts, uncapped — lets the API reject sends over the limit. */
export function mediatedTextParts(text: string): string[] {
  return text
    .split("|||")
    .map((part) => compactText(part))
    .filter((part) => part.length > 0);
}

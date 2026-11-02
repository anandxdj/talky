import { compactText } from "../utils";

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
  const pattern =
    /(?:default_api\.)?(list_available_tools|list_local_files|read_local_file|share_local_file|send_sticker|send_gif|send_klipy_gif|send_voice_reply|end_voice_reply|send_image_reply|send_meme_reply|send_styled_quote_card|send_voice_plus_text|send_reaction_combo)\s*\(([^)]*)\)/gim;

  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(text)) !== null) {
    const name = compactText(match[1] ?? "");
    if (!name || !allowedNames.has(name)) continue;
    const rawArgs = match[2] ?? "";
    calls.push({
      name,
      args: parseTextToolArgs(rawArgs)
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
  let result = text.replace(
    /`?\s*(?:default_api\.)?(list_available_tools|list_local_files|read_local_file|share_local_file|send_sticker|send_gif|send_klipy_gif|send_voice_reply|end_voice_reply|send_image_reply|send_meme_reply|send_styled_quote_card|send_voice_plus_text|send_reaction_combo)\s*\([^`)]*\)\s*`?/gim,
    " "
  );
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

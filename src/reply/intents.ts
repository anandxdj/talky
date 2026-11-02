import { compactText } from "../utils";

export function isExplicitVoiceToolIntent(input: string): boolean {
  const text = compactText(input).toLowerCase();
  if (!text) return false;

  if (text.includes("send_voice_reply") || text.includes("end_voice_reply")) {
    return true;
  }

  return (
    /voice\s*(msg|message|note)/.test(text) ||
    /voice\s*reply/.test(text) ||
    /tool\s*call.*voice/.test(text) ||
    /voice.*tool\s*call/.test(text)
  );
}

export function defaultExplicitVoiceReplyText(): string {
  return "Ami voice-e reply dicchi, bolo ki niye kotha bolbo.";
}

export function isToolListIntent(input: string): boolean {
  const text = compactText(input).toLowerCase();
  if (!text) return false;

  const keywords = [
    "tool list",
    "list tools",
    "available tools",
    "what tools",
    "ki ki tool",
    "tool call korte",
    "tool call list",
    "registry"
  ];

  return keywords.some((keyword) => text.includes(keyword));
}

export function extractNarratedGifQuery(replyText: string, fallbackContext: string): string {
  const text = compactText(replyText).toLowerCase();
  if (!text) return "";

  const hasGifWord = /\bgif\b|giphy|tenor|klipy/.test(text);
  if (!hasGifWord) return "";

  const hasSendIntent =
    /(send|sending|patha|pathao|pathachi|pathachchi|pathabo|pathaun|bhej|share)/.test(text) ||
    /(?:i|ami|main)\s+(?:will|can|gonna)\s+send/.test(text);
  if (!hasSendIntent) return "";

  const fromQuoted = replyText.match(/["'`]{1}([^"'`]{2,80})["'`]{1}/);
  if (fromQuoted?.[1]) {
    return deriveGifQuery(fromQuoted[1]);
  }

  const fallback = compactText(fallbackContext);
  if (fallback) {
    return deriveGifQuery(fallback);
  }

  return "reaction gif";
}

export function deriveGifQuery(source: string): string {
  const normalized = compactText(source).toLowerCase();
  if (!normalized) return "reaction gif";
  return normalized
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(" ");
}

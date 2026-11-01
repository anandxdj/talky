import { jidNormalizedUser } from "baileys";

export const ANSI_RESET = "\u001b[0m";

export const ANSI_DIM = "\u001b[90m";

export const ANSI_AI = "\u001b[36m";

export const ANSI_ME = "\u001b[32m";

export const ACTOR_COLORS = [
  "\u001b[38;5;39m",
  "\u001b[38;5;45m",
  "\u001b[38;5;81m",
  "\u001b[38;5;111m",
  "\u001b[38;5;149m",
  "\u001b[38;5;208m",
  "\u001b[38;5;214m",
  "\u001b[38;5;177m"
];

export function hashText(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function colorForActor(actorId: string): string {
  return ACTOR_COLORS[hashText(actorId) % ACTOR_COLORS.length] ?? "";
}

export function shortActorLabel(actorId: string): string {
  const normalized = jidNormalizedUser(actorId);
  const user = normalized.split("@")[0] ?? normalized;
  if (user.length <= 14) return user;
  return `${user.slice(0, 6)}...${user.slice(-4)}`;
}

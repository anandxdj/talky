import type { AppConfig } from "../types";

/**
 * "Pause replies" kill switch (`repliesPaused` in config.yaml / POST /api/config).
 *
 * While paused Talky keeps recording (chat history, Claude mediator queue, direct-chat memory) but
 * sends nothing on its own: no Gemini auto-replies, no proactive startup messages, no
 * claudeTriggerCommand spawn. Self-chat stays live so the owner can still command the
 * assistant, and a human can still send from the console with `force: true`.
 */

export const REPLIES_PAUSED_ERROR = "replies are paused";

export function isRepliesPaused(config: Pick<AppConfig, "repliesPaused">): boolean {
  return config.repliesPaused === true;
}

/** True when the automatic reply to this inbound message must be suppressed. */
export function shouldSuppressAutoReply(
  config: Pick<AppConfig, "repliesPaused">,
  options: { isSelfChat: boolean }
): boolean {
  return isRepliesPaused(config) && !options.isSelfChat;
}

/** Decision-log line (same format as the YES/NO lines); stats count it as silent. */
export function pausedDecisionLogLine(nowISO: string, chatJid: string, senderJid: string): string {
  return `${nowISO} | chat=${chatJid} | sender=${senderJid} | decision=PAUSED`;
}

/**
 * Guard for POST /api/claude/send and /api/claude/send-file: while paused, refuse with
 * 409 unless the body explicitly carries `"force": true` (a deliberate human send).
 */
export function checkPausedSend(
  paused: boolean,
  body: Record<string, unknown>
): { status: 409; error: string } | null {
  if (!paused || body.force === true) return null;
  return { status: 409, error: REPLIES_PAUSED_ERROR };
}

/**
 * Should a non-slash self-chat message go to the Claude mediator queue? Normally yes when
 * the self chat is mediated. While paused nobody is woken to answer the queue (no trigger,
 * Claude sessions stand down), so self-chat falls back to the built-in assistant and the
 * owner can still talk to it.
 */
export function shouldMediateSelfChat(
  config: Pick<AppConfig, "repliesPaused">,
  options: { slashCommand: boolean; mediatedChat: boolean }
): boolean {
  return !options.slashCommand && options.mediatedChat && !isRepliesPaused(config);
}

/**
 * While paused, auto-memory runs only for direct chats. Group messages normally reach
 * memory extraction only after a YES decision and the group gates, which are not
 * evaluated while paused, so groups are skipped to keep capture no broader than usual.
 */
export function shouldExtractMemoryWhilePaused(context: { isGroup: boolean }): boolean {
  return !context.isGroup;
}

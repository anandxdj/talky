/** Boom / Baileys errors often put the real HTTP code in `data` (e.g. 429) while `output.statusCode` is 500. */
export function boomHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const b = error as { data?: unknown; output?: { statusCode?: unknown } };
  if (typeof b.data === "number" && b.data >= 400 && b.data < 600) return b.data;
  const sc = b.output?.statusCode;
  if (typeof sc === "number" && sc >= 400 && sc < 600) return sc;
  return undefined;
}

export function boomErrorText(error: unknown): string {
  if (error == null) return "";
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const e = error as {
      message?: string;
      output?: { payload?: { message?: string }; statusCode?: number };
    };
    const p = e.output?.payload;
    const parts = [
      e.message,
      typeof p?.message === "string" ? p.message : undefined,
      e.output?.statusCode !== undefined ? String(e.output.statusCode) : undefined
    ].filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  return String(error);
}

export function stringifyErrorForLog(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

import { describe, expect, test } from "bun:test";
import { decideReply } from "../src/decision";
import type { GeminiClient } from "../src/gemini";
import type { AppConfig } from "../src/types";

function fakeGemini(output: string) {
  const calls: Array<{ model: string; temperature?: number; maxOutputTokens?: number; parts: unknown }> = [];
  const gemini = {
    generate: async (args: any) => {
      calls.push(args);
      return output;
    }
  } as unknown as GeminiClient;
  return { gemini, calls };
}

function run(output: string, opts: { mentionedMe?: boolean; replyOnlyOnMention?: boolean } = {}) {
  const { gemini, calls } = fakeGemini(output);
  const config = { model: "test-model", replyOnlyOnMention: opts.replyOnlyOnMention ?? false } as AppConfig;
  const promise = decideReply({
    gemini,
    config,
    botName: "Talky",
    isGroup: true,
    mentionedMe: opts.mentionedMe ?? false,
    messageText: "hello",
    recentHistory: ["a: hi"],
    memories: [{ fact: "likes tea", confidence: 0.9 } as any]
  });
  return { promise, calls };
}

describe("decideReply", () => {
  test("mention always replies without asking the model", async () => {
    const { promise, calls } = run("NO", { mentionedMe: true, replyOnlyOnMention: true });
    expect(await promise).toBe("YES");
    expect(calls.length).toBe(0);
  });

  test("replyOnlyOnMention without a mention never replies and never asks the model", async () => {
    const { promise, calls } = run("YES", { replyOnlyOnMention: true });
    expect(await promise).toBe("NO");
    expect(calls.length).toBe(0);
  });

  test("model output is parsed case-insensitively; YES wins over DEFER; anything else is NO", async () => {
    expect(await run(" yes\n").promise).toBe("YES");
    expect(await run("Defer").promise).toBe("DEFER");
    expect(await run("YES or DEFER").promise).toBe("YES");
    expect(await run("NO").promise).toBe("NO");
    expect(await run("").promise).toBe("NO");
    expect(await run("maybe").promise).toBe("NO");
  });

  test("asks the configured model with a low-temperature, tiny-output request", async () => {
    const { promise, calls } = run("NO");
    await promise;
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ model: "test-model", temperature: 0.1, maxOutputTokens: 8 });
    const prompt = JSON.stringify(calls[0]?.parts);
    expect(prompt).toContain("Incoming message: hello");
    expect(prompt).toContain("likes tea (confidence=0.90)");
  });
});

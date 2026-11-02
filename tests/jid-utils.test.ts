import { describe, expect, test } from "bun:test";
import {
  buildMediaSendTargets,
  isJidLike,
  normalizeJidInput,
  shouldIgnoreIncomingJid,
  toDirectTargetJid,
  toPhoneJid
} from "../src/jid";
import {
  clampFloat,
  clampInt,
  compactText,
  extractMessageTimestampSeconds,
  jaccardTokenSimilarity,
  previewText,
  randomBetween,
  sanitizeJid,
  tokenOverlapScore
} from "../src/utils";

describe("normalizeJidInput", () => {
  test("plain phone numbers (with cosmetic characters) become phone JIDs", () => {
    expect(normalizeJidInput("919876543210")).toEqual({
      jid: "919876543210@s.whatsapp.net",
      kind: "phone",
      digits: "919876543210"
    });
    expect(normalizeJidInput(" +91 (98765) 43-210 ").jid).toBe("919876543210@s.whatsapp.net");
  });

  test("rejects too short / too long / non-numeric phone input", () => {
    expect(() => normalizeJidInput("12345")).toThrow();
    expect(() => normalizeJidInput("1234567890123456")).toThrow();
    expect(() => normalizeJidInput("deep")).toThrow();
    expect(() => normalizeJidInput("")).toThrow("empty");
    expect(() => normalizeJidInput("   ")).toThrow("empty");
  });

  test("phone JIDs drop the device suffix and must be numeric", () => {
    expect(normalizeJidInput("919876543210:7@s.whatsapp.net")).toEqual({
      jid: "919876543210@s.whatsapp.net",
      kind: "phone",
      digits: "919876543210"
    });
    expect(() => normalizeJidInput("abc@s.whatsapp.net")).toThrow("invalid phone JID");
  });

  test("lid, group, broadcast and other JIDs", () => {
    expect(normalizeJidInput("124245216596056:3@lid")).toEqual({
      jid: "124245216596056@lid",
      kind: "lid",
      digits: "124245216596056"
    });
    expect(normalizeJidInput("12036@g.us")).toEqual({ jid: "12036@g.us", kind: "group", digits: "12036" });
    expect(normalizeJidInput("status@broadcast").kind).toBe("broadcast");
    expect(normalizeJidInput("x@c.us")).toEqual({ jid: "x@c.us", kind: "raw", digits: "x" });
  });
});

describe("toPhoneJid / toDirectTargetJid / isJidLike", () => {
  test("toPhoneJid converts phone and digit-only raw JIDs; rejects groups", () => {
    expect(toPhoneJid("919876543210")).toBe("919876543210@s.whatsapp.net");
    expect(toPhoneJid("919876543210@c.us")).toBe("919876543210@s.whatsapp.net");
    expect(() => toPhoneJid("12036@g.us")).toThrow();
    expect(() => toPhoneJid("abc@c.us")).toThrow();
  });

  test("toPhoneJid leaves @lid input as a LID (LID digits are not a phone number)", () => {
    expect(toPhoneJid("123456@lid")).toBe("123456@lid");
    expect(toPhoneJid(" 123456:7@lid ")).toBe("123456@lid");
    expect(toPhoneJid("123456@lid")).not.toContain("@s.whatsapp.net");
  });

  test("toDirectTargetJid normalizes any accepted input", () => {
    expect(toDirectTargetJid("+91 98765 43210")).toBe("919876543210@s.whatsapp.net");
    expect(toDirectTargetJid("12036@g.us")).toBe("12036@g.us");
    expect(toDirectTargetJid("5:2@lid")).toBe("5@lid");
  });

  test("isJidLike", () => {
    expect(isJidLike("a@b")).toBe(true);
    expect(isJidLike("919876543210")).toBe(false);
  });
});

describe("shouldIgnoreIncomingJid", () => {
  test("ignores status, broadcast lists and newsletters", () => {
    expect(shouldIgnoreIncomingJid("status@broadcast")).toBe(true);
    expect(shouldIgnoreIncomingJid("123@broadcast")).toBe(true);
    expect(shouldIgnoreIncomingJid("123@newsletter")).toBe(true);
  });

  test("keeps users, lids and groups", () => {
    expect(shouldIgnoreIncomingJid("919876543210@s.whatsapp.net")).toBe(false);
    expect(shouldIgnoreIncomingJid("1@lid")).toBe(false);
    expect(shouldIgnoreIncomingJid("12036@g.us")).toBe(false);
    expect(shouldIgnoreIncomingJid(undefined)).toBe(false);
    expect(shouldIgnoreIncomingJid(null)).toBe(false);
  });
});

describe("buildMediaSendTargets", () => {
  test("group targets are just the group", () => {
    expect(buildMediaSendTargets("12036@g.us")).toEqual(["12036@g.us"]);
  });

  test("phone and lid chats also try the other server form with the same user part", () => {
    expect(buildMediaSendTargets("91@s.whatsapp.net")).toEqual(["91@s.whatsapp.net", "91@lid"]);
    expect(buildMediaSendTargets("5@lid")).toEqual(["5@lid", "5@s.whatsapp.net"]);
  });

  test("unknown servers / empty user part pass through", () => {
    expect(buildMediaSendTargets("x@c.us")).toEqual(["x@c.us"]);
    expect(buildMediaSendTargets("@lid")).toEqual(["@lid"]);
  });
});

describe("utils", () => {
  test("sanitizeJid keeps only filename-safe characters", () => {
    expect(sanitizeJid("919876543210@s.whatsapp.net")).toBe("919876543210@s.whatsapp.net");
    expect(sanitizeJid("91 98+x/../y@lid")).toBe("91_98_x_.._y@lid");
    expect(sanitizeJid("a:b\\c")).toBe("a_b_c");
  });

  test("compactText collapses all whitespace", () => {
    expect(compactText("  a \n\t b  ")).toBe("a b");
  });

  test("tokenOverlapScore is the fraction of query tokens present in text (case-insensitive)", () => {
    expect(tokenOverlapScore("I love Pizza", "pizza pasta")).toBe(0.5);
    expect(tokenOverlapScore("I love pizza", "PIZZA")).toBe(1);
    expect(tokenOverlapScore("a b c", "x y")).toBe(0);
    expect(tokenOverlapScore("", "pizza")).toBe(0);
    expect(tokenOverlapScore("pizza", "")).toBe(0);
    expect(tokenOverlapScore("pizza", "pizza pizza")).toBe(1);
  });

  test("tokenOverlapScore: known limitation — \\W is ASCII-only, so non-Latin text never overlaps", () => {
    expect(tokenOverlapScore("আমি ভাত খাই", "ভাত")).toBe(0);
  });

  test("jaccardTokenSimilarity ignores tokens of length <= 2", () => {
    expect(jaccardTokenSimilarity("likes spicy food", "likes spicy food")).toBe(1);
    expect(jaccardTokenSimilarity("likes spicy food", "likes sweet food")).toBe(0.5);
    expect(jaccardTokenSimilarity("a b c", "a b c")).toBe(0);
  });

  test("clampInt / clampFloat", () => {
    expect(clampInt(3.9, 1, 5)).toBe(3);
    expect(clampInt(99, 1, 5)).toBe(5);
    expect(clampInt(-4, 1, 5)).toBe(1);
    expect(clampInt(Number.NaN, 1, 5)).toBe(1);
    expect(clampInt(Number.POSITIVE_INFINITY, 1, 5)).toBe(1);
    expect(clampFloat(1.25, 0, 2)).toBe(1.25);
    expect(clampFloat(3, 0, 2)).toBe(2);
    expect(clampFloat(Number.NaN, 0.5, 2)).toBe(0.5);
  });

  test("previewText compacts and truncates with an ellipsis", () => {
    expect(previewText("a   b")).toBe("a b");
    expect(previewText("abcdefghij", 8)).toBe("abcde...");
    expect(previewText("abcdefgh", 8)).toBe("abcdefgh");
  });

  test("randomBetween stays within inclusive bounds and handles max <= min", () => {
    for (let i = 0; i < 50; i += 1) {
      const v = randomBetween(3, 5);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(5);
    }
    expect(randomBetween(7, 7)).toBe(7);
    expect(randomBetween(9, 2)).toBe(9);
  });

  test("extractMessageTimestampSeconds handles numbers, strings and protobuf Longs", () => {
    expect(extractMessageTimestampSeconds(1717000000.9)).toBe(1717000000);
    expect(extractMessageTimestampSeconds("12.7")).toBe(12);
    expect(extractMessageTimestampSeconds({ toNumber: () => 5.5 })).toBe(5);
    expect(extractMessageTimestampSeconds({ low: 7, high: 0 })).toBe(7);
    expect(extractMessageTimestampSeconds("abc")).toBeNull();
    expect(extractMessageTimestampSeconds(Number.NaN)).toBeNull();
    expect(extractMessageTimestampSeconds(null)).toBeNull();
    expect(extractMessageTimestampSeconds(undefined)).toBeNull();
    expect(extractMessageTimestampSeconds({})).toBeNull();
  });
});

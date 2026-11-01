import { describe, expect, test } from "bun:test";
import {
  defaultExplicitVoiceReplyText,
  deriveGifQuery,
  extractNarratedGifQuery,
  isExplicitVoiceToolIntent,
  isToolListIntent
} from "../src/reply/intents";
import { inferMemoryFact } from "../src/memory-extraction";
import { normalizeKlipyLocale, toKlipyCustomerId } from "../src/klipy";

describe("isToolListIntent", () => {
  test("detects tool-list questions (case-insensitive)", () => {
    expect(isToolListIntent("What tools do you have?")).toBe(true);
    expect(isToolListIntent("ki ki tool ache")).toBe(true);
    expect(isToolListIntent("hello")).toBe(false);
    expect(isToolListIntent("")).toBe(false);
  });
});

describe("isExplicitVoiceToolIntent", () => {
  test("detects voice-note requests", () => {
    expect(isExplicitVoiceToolIntent("send a voice note pls")).toBe(true);
    expect(isExplicitVoiceToolIntent("voice reply de")).toBe(true);
    expect(isExplicitVoiceToolIntent("use send_voice_reply")).toBe(true);
    expect(isExplicitVoiceToolIntent("hello there")).toBe(false);
    expect(isExplicitVoiceToolIntent("")).toBe(false);
  });

  test("default voice text is non-empty", () => {
    expect(defaultExplicitVoiceReplyText().length).toBeGreaterThan(0);
  });
});

describe("extractNarratedGifQuery / deriveGifQuery", () => {
  test("needs both a gif word and a send intent", () => {
    expect(extractNarratedGifQuery("nice gif", "ctx")).toBe("");
    expect(extractNarratedGifQuery("sending you something", "ctx")).toBe("");
    expect(extractNarratedGifQuery("", "ctx")).toBe("");
  });

  test("prefers a quoted phrase, then the fallback context, then a generic query", () => {
    expect(extractNarratedGifQuery('sending you a gif of "dancing cat"!', "ctx")).toBe("dancing cat");
    expect(extractNarratedGifQuery("I'll send a gif", "Party Time!!")).toBe("party time");
    expect(extractNarratedGifQuery("ami gif pathachi", "")).toBe("reaction gif");
  });

  test("deriveGifQuery lowercases, strips punctuation and keeps 6 words", () => {
    expect(deriveGifQuery("One, two! three four five six seven")).toBe("one two three four five six");
    expect(deriveGifQuery("")).toBe("reaction gif");
    expect(deriveGifQuery("!!!")).toBe("");
  });
});

describe("inferMemoryFact (prefilter before Gemini classification)", () => {
  test("passes personal, imperative and schedule cues", () => {
    expect(inferMemoryFact("my birthday is in May")).toBe("my birthday is in May");
    expect(inferMemoryFact("remember to buy milk")).toBe("remember to buy milk");
    expect(inferMemoryFact("meeting at 5pm")).toBe("meeting at 5pm");
  });

  test("rejects empty, cue-less and long messages", () => {
    expect(inferMemoryFact("")).toBeNull();
    expect(inferMemoryFact("lol")).toBeNull();
    expect(inferMemoryFact(`my ${"x".repeat(220)}`)).toBeNull();
  });

  test("known looseness: substring cue 'i ' also matches words ending in i (e.g. 'hi ')", () => {
    expect(inferMemoryFact("hi bro")).toBe("hi bro");
  });
});

describe("klipy helpers", () => {
  test("toKlipyCustomerId uses the sanitized JID user part", () => {
    expect(toKlipyCustomerId("919876543210@s.whatsapp.net")).toBe("919876543210");
    expect(toKlipyCustomerId("a b:3@lid")).toBe("a_b");
    expect(toKlipyCustomerId("")).toBe("talky_user");
  });

  test("normalizeKlipyLocale returns a 2-letter code or undefined", () => {
    expect(normalizeKlipyLocale("EN")).toBe("en");
    expect(normalizeKlipyLocale("en_US")).toBe("us");
    expect(normalizeKlipyLocale("en-us")).toBeUndefined();
    expect(normalizeKlipyLocale(undefined)).toBeUndefined();
  });
});

import { describe, expect, test } from "bun:test";
import { inferMemoryFact } from "../src/memory-extraction";

describe("inferMemoryFact personal cue ('i' as a word)", () => {
  test("words that merely end in 'i' are not first-person facts", () => {
    // Previously `low.includes("i ")` matched all of these.
    expect(inferMemoryFact("hi bro")).toBeNull();
    expect(inferMemoryFact("wifi down again")).toBeNull();
    expect(inferMemoryFact("kya bhai kaha ho")).toBeNull();
    expect(inferMemoryFact("Hi there")).toBeNull();
  });

  test("the standalone word 'i' still matches (any case, any position)", () => {
    expect(inferMemoryFact("I work at Infosys")).toBe("I work at Infosys");
    expect(inferMemoryFact("i love biryani")).toBe("i love biryani");
    expect(inferMemoryFact("hi, I think so")).toBe("hi, I think so");
    expect(inferMemoryFact("yes i do")).toBe("yes i do");
    expect(inferMemoryFact("ok.i guess")).toBe("ok.i guess");
  });

  test("i'm / my cues are unchanged", () => {
    expect(inferMemoryFact("i'm going to Pune")).toBe("i'm going to Pune");
    expect(inferMemoryFact("I'm vegetarian")).toBe("I'm vegetarian");
    expect(inferMemoryFact("my sister lives in Delhi")).toBe("my sister lives in Delhi");
  });

  test("'i' not followed by a space is still not a cue (unchanged)", () => {
    expect(inferMemoryFact("so did i")).toBeNull();
  });

  test("imperative and schedule cues are unchanged", () => {
    expect(inferMemoryFact("hi, remember the keys")).toBe("hi, remember the keys");
    expect(inferMemoryFact("hi call tomorrow")).toBe("hi call tomorrow");
  });

  test("length and empty guards are unchanged", () => {
    expect(inferMemoryFact("")).toBeNull();
    expect(inferMemoryFact(`I ${"x".repeat(220)}`)).toBeNull();
  });
});

describe("inferMemoryFact personal cue ('my' as a word) (BUG-K6)", () => {
  test("words ending in 'my' are not personal facts", () => {
    expect(inferMemoryFact("the army parade was long")).toBeNull();
    expect(inferMemoryFact("economy is bad these days")).toBeNull();
    expect(inferMemoryFact("tommy said hello")).toBeNull();
  });

  test("a real 'my' still counts", () => {
    expect(inferMemoryFact("my sister lives in Pune")).toBe("my sister lives in Pune");
    expect(inferMemoryFact("this is my number")).toBe("this is my number");
  });
});

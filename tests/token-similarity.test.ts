import { describe, expect, test } from "bun:test";
import { jaccardTokenSimilarity, tokenOverlapScore } from "../src/utils";

describe("non-ASCII token matching (BUG-K5)", () => {
  test("Bengali, Devanagari and Arabic words match themselves", () => {
    expect(tokenOverlapScore("আমার পরীক্ষা কাল", "পরীক্ষা")).toBe(1);
    expect(tokenOverlapScore("मेरी परीक्षा कल है", "परीक्षा कब")).toBe(0.5);
    expect(tokenOverlapScore("موعد الطبيب غدا", "الطبيب")).toBe(1);
  });

  test("combining vowel signs stay inside the word", () => {
    // "किताब" has the vowel sign ि (U+093F); splitting on it made unrelated words collide.
    expect(tokenOverlapScore("किताब", "क")).toBe(0);
  });

  test("duplicate non-ASCII memories are detected", () => {
    expect(jaccardTokenSimilarity("দীপ কলেজের বন্ধু", "দীপ কলেজের বন্ধু")).toBe(1);
    expect(jaccardTokenSimilarity("राहुल को चाय पसंद है", "राहुल को कॉफी पसंद है")).toBeGreaterThan(0.3);
  });

  test("ASCII behaviour is unchanged", () => {
    expect(tokenOverlapScore("likes chai, hates coffee", "chai")).toBe(1);
    expect(jaccardTokenSimilarity("likes chai a lot", "likes chai a lot")).toBe(1);
    expect(tokenOverlapScore("", "x")).toBe(0);
  });
});

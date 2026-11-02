import { describe, expect, test } from "bun:test";
import { randomBetween } from "../src/utils";

describe("randomBetween (BUG-K2)", () => {
  test("fractional bounds (delays scaled ×1.5 by 'slower' instructions) do not throw", () => {
    let min = 2000;
    let max = 5000;
    for (let i = 0; i < 8; i += 1) {
      min *= 1.5;
      max *= 1.5;
      const v = randomBetween(min, max);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(Math.ceil(min));
      expect(v).toBeLessThanOrEqual(Math.floor(max));
    }
  });

  test("integer behaviour is unchanged", () => {
    expect(randomBetween(5, 5)).toBe(5);
    expect(randomBetween(7, 3)).toBe(7);
    for (let i = 0; i < 50; i += 1) {
      const v = randomBetween(1, 3);
      expect([1, 2, 3]).toContain(v);
    }
  });

  test("a range narrower than one integer returns the rounded-up bound", () => {
    expect(randomBetween(1.2, 1.8)).toBe(2);
  });
});

import { expect, test } from "bun:test";
import { usageTokens, windowFromResult, windowOf } from "./context-fill.ts";

test("a one-million-token model has a million, any other has two hundred thousand", () => {
  expect(windowOf("claude-sonnet-5-5[1m]")).toBe(1_000_000);
  expect(windowOf("claude-opus-5-5")).toBe(200_000);
});

test("the usage of one call adds input, output and both cache counts", () => {
  expect(
    usageTokens({
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 300,
      cache_creation_input_tokens: 4000,
    }),
  ).toBe(4330);
  expect(usageTokens({ input_tokens: 5, output_tokens: "x" })).toBe(5);
  expect(usageTokens(null)).toBe(0);
});

test("the window comes from the entry of the conversation's own model, not the advisor's", () => {
  const usage = {
    "claude-opus-5-5": { contextWindow: 200_000 },
    "claude-sonnet-5-5[1m]": { contextWindow: 1_000_000 },
  };
  expect(windowFromResult(usage, "claude-sonnet-5-5[1m]")).toBe(1_000_000);
  expect(windowFromResult(usage, "claude-opus-5-5")).toBe(200_000);
});

test("an entry that lists the model without its suffix still matches", () => {
  expect(
    windowFromResult(
      { "claude-sonnet-5-5": { contextWindow: 500_000 } },
      "claude-sonnet-5-5[1m]",
    ),
  ).toBe(500_000);
});

test("a result with no entry for the model gives no window", () => {
  expect(windowFromResult({}, "claude-opus-5-5")).toBeNull();
  expect(windowFromResult(undefined, "claude-opus-5-5")).toBeNull();
  expect(
    windowFromResult(
      { "claude-opus-5-5": { contextWindow: 0 } },
      "claude-opus-5-5",
    ),
  ).toBeNull();
});

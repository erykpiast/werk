import { expect, test } from "bun:test";
import { costOf, NO_COST } from "./stream-cost.ts";

test("the cost is read from the last result line", () => {
  const stream = [
    JSON.stringify({ type: "assistant" }),
    JSON.stringify({ type: "result", total_cost_usd: 1 }),
    JSON.stringify({
      type: "result",
      total_cost_usd: 0.25,
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 40,
      },
    }),
  ].join("\n");
  expect(costOf(stream)).toEqual({
    usd: 0.25,
    input: 10,
    output: 20,
    cacheRead: 30,
    cacheWrite: 40,
  });
});

test("a stream with no readable result costs nothing", () => {
  expect(costOf("")).toEqual(NO_COST);
  expect(costOf('{"type":"assistant"}\n"result" broken\n{"result":')).toEqual(
    NO_COST,
  );
  expect(
    costOf(JSON.stringify({ type: "result", total_cost_usd: "x" })),
  ).toEqual(NO_COST);
});

import { expect, test } from "bun:test";
import { commandsOf } from "./start-line.ts";

test("a start line gives its command names without a slash", () => {
  const line = {
    type: "system",
    subtype: "init",
    slash_commands: ["review", "/recall", 3, ""],
  };
  expect(commandsOf(line)).toEqual(["review", "recall"]);
});

test("a start line with no command list names none", () => {
  expect(commandsOf({ type: "system", subtype: "init" })).toEqual([]);
});

test("any other event is not a start line", () => {
  expect(commandsOf({ type: "system", subtype: "status" })).toBeNull();
  expect(commandsOf({ type: "assistant" })).toBeNull();
  expect(commandsOf(null)).toBeNull();
  expect(commandsOf("x")).toBeNull();
});

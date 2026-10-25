import { expect, test } from "bun:test";
import { OPUS, SONNET } from "../agent/launch-options.ts";
import { choiceOf, DEFAULT_PICK, parsePick } from "./model-pick.ts";

test("the three choices parse and anything else is refused", () => {
  expect(parsePick({ model: "sonnet", advisor: null })).toEqual({
    model: "sonnet",
    advisor: null,
  });
  expect(parsePick({ model: "sonnet", advisor: "opus" })).toEqual(DEFAULT_PICK);
  expect(parsePick({ model: "opus", advisor: null })).toEqual({
    model: "opus",
    advisor: null,
  });
  expect(parsePick({ model: "opus", advisor: "opus" })).toBeNull();
  expect(parsePick({ model: "haiku", advisor: null })).toBeNull();
  expect(parsePick({ model: "sonnet" })).toBeNull();
  expect(parsePick(null)).toBeNull();
  expect(parsePick("sonnet")).toBeNull();
});

test("each choice launches with the pinned ids", () => {
  expect(choiceOf({ model: "opus", advisor: null })).toEqual({
    model: OPUS,
    advisor: null,
  });
  expect(choiceOf(DEFAULT_PICK)).toEqual({ model: SONNET, advisor: OPUS });
});

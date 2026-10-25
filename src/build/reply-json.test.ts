import { expect, test } from "bun:test";
import { isObject, jsonOf } from "./reply-json.ts";

test("a reply that is JSON parses as it stands", () => {
  expect(jsonOf('{"a":1}')).toEqual({ a: 1 });
});

test("the last fenced block wins over the text around it", () => {
  const reply = 'Here is { not json }\n```json\n{"a":1}\n```\n';
  expect(jsonOf(reply)).toEqual({ a: 1 });
});

test("the outermost braces parse when no fence is there", () => {
  expect(jsonOf('Result: {"a":{"b":2}} done')).toEqual({ a: { b: 2 } });
});

test("a reply with no JSON gives undefined", () => {
  expect(jsonOf("no braces here")).toBeUndefined();
  expect(jsonOf("{ broken")).toBeUndefined();
});

test("isObject rejects arrays and null", () => {
  expect(isObject({})).toBe(true);
  expect(isObject([])).toBe(false);
  expect(isObject(null)).toBe(false);
});

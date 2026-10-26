import { expect, test } from "bun:test";
import { add, twice } from "./full.ts";
test("other runs the lines of full", () => {
  expect(add(1, 2)).toBe(3);
  expect(add(-1, 2)).toBe(0);
  expect(twice(2)).toBe(4);
});

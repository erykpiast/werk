import { expect, test } from "bun:test";
import { a } from "./partial.ts";
test("partial runs only a", () => {
  expect(a(1)).toBe(10);
});

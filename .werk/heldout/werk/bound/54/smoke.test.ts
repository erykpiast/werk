import { expect, test } from "bun:test";
import { freshProject } from "../src/test/project.ts";
test("smoke", async () => {
  const p = freshProject();
  const r = await p.werk(["add", "a", "--title", "A"]);
  console.log(r);
  expect(r.code).toBe(0);
});

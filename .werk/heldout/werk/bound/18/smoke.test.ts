import { expect, test } from "bun:test";
import { freshProject } from "../src/test/project.ts";
test("smoke", async () => {
  const p = freshProject();
  const r = await p.werk(["add", "root", "--title", "Root"]);
  expect(r.out).toContain("proposed");
});

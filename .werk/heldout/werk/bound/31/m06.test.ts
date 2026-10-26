import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, decided, type Project, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

test("06.1 a new excerpt stages as a ghost and waits for the accept", async () => {
  decided(p, "card1", "A decided card", { why: "its why" });
  const before = (await werk(p, "show", "card1")).stdout;
  const r = await werk(p, "add", "say1", "--kind", "excerpt", "--title", "Sam", "--body", "the words as spoken");
  expect(r.code, `add --kind excerpt exit ${r.code}: ${r.stderr}`).toBe(0);
  expect(r.stdout.trim()).toBe("proposed");
  const l = await werk(p, "link", "card1", "say1", "--type", "supported_by");
  expect(l.code, l.stderr).toBe(0);
  const ex = (await werk(p, "show", "say1")).stdout;
  expect(ex).toContain("proposed");
  const c = (await werk(p, "show", "card1")).stdout;
  expect(c).toContain("[held]");
  expect(c).toContain("[proposed]");
  expect(c).toContain("[decided]");
  expect(c.split("\n")[0]).toBe(before.split("\n")[0]);
});

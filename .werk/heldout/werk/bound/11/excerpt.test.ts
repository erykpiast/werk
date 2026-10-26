import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import { card, seed, werk } from "./util.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

test("06.1 an agent adds an excerpt for a decided card; it stages as a ghost", async () => {
  seed(p, card("c", "Card", "decided", { why: "words" }));
  const r = await werk(p, "add", "x", "--kind", "excerpt", "--title", "Pat", "--body", "said this");
  expect(r.stderr).toBe("");
  expect(r.stdout.trim()).toBe("proposed");
  const l = await werk(p, "link", "c", "x", "--type", "supported_by", "--why", "w");
  expect(l.code).toBe(0);
  const shown = (await werk(p, "show", "x")).stdout;
  expect(shown).toContain("proposed");
  const card_ = (await werk(p, "show", "c")).stdout;
  expect(card_).toContain("[held]");
  expect(card_).toContain("[decided]");
  expect(card_).toContain("Card");
});

test("06.2 an accepted excerpt goes live with its link, no second accept", async () => {
  seed(p, card("c", "Card", "decided", { why: "words" }));
  const r = await werk(p, "add", "x", "--kind", "excerpt", "--title", "Pat", "--body", "said this");
  expect(r.code).toBe(0);
  await werk(p, "link", "c", "x", "--type", "supported_by", "--why", "w");
  const a = await werk(p, "accept", "x", "--actor", "you");
  expect(a.code).toBe(0);
  const shown = (await werk(p, "show", "c")).stdout;
  expect(shown).toContain("supported_by");
  expect(shown).not.toContain("[held]");
  expect(shown).not.toContain("[proposed]");
});

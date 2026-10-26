import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import { decide, must, realCard, werk } from "./helpers.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

async function decidedCard() {
  await realCard(p, "claim");
  await decide(p, "claim");
}

/** The agent adds an excerpt that supports the card: an excerpt kind, then a supported_by link. */
async function addExcerpt() {
  const add = await werk(
    p,
    "add",
    "ex1",
    "--title",
    "We need a refund path",
    "--body",
    "We need a refund path",
    "--kind",
    "excerpt",
  );
  return add;
}

test("06.1 a new excerpt stages as a ghost, its link is pending, the card is untouched", async () => {
  await decidedCard();
  const before = (await werk(p, "show", "claim")).stdout;
  const add = await addExcerpt();
  expect(add.stderr).not.toContain("--kind must be");
  expect(add.code).toBe(0);
  expect(add.stdout.trim()).toBe("proposed");
  const link = await werk(p, "link", "claim", "ex1", "--type", "supported_by");
  expect(link.code).toBe(0);
  const ex = await werk(p, "show", "ex1");
  expect(ex.stdout).toContain("proposed");
  const claim = (await werk(p, "show", "claim")).stdout;
  expect(claim).toMatch(/supported_by\s+ex1.*\[held\]/);
  expect(claim).toContain("[decided]");
  expect(claim.split("\n")[0]).toBe(before.split("\n")[0]);
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
  await decidedCard();
  const add = await addExcerpt();
  expect(add.code).toBe(0);
  await must(p, "link", "claim", "ex1", "--type", "supported_by");
  await must(p, "accept", "ex1", "--actor", "you");
  const ex = (await werk(p, "show", "ex1")).stdout;
  expect(ex).not.toContain("proposed");
  const claim = (await werk(p, "show", "claim")).stdout;
  expect(claim).toMatch(/->\s+supported_by\s+ex1/);
  expect(claim).not.toContain("[held]");
});

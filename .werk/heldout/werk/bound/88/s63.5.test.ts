import { expect, test } from "bun:test";
import { freshProject } from "../src/test/project.ts";
import { decided, ok, seed } from "./util.ts";

// "Storage" and its child are seeded decided; the child is decided by who you with an unchallenged waiver,
// so the unchallenged count is 1. The ghost brings its own option, kill criterion and who so it can be decided.
test("63.5 a ghost changes no count of a real card until it is accepted", async () => {
  const p = freshProject();
  seed(p, [
    ...decided("storage", { title: "Storage" }),
    ...decided("disk", { title: "Use disk", parent: "storage", who: "you", unchallenged: "no alternative" }),
  ]);
  const before = (await ok(p, ["show", "storage"])).out;
  expect(before).toContain("subtree: 2 cards, 2 decided, 1 unchallenged\n");
  expect(before).toMatch(/^card storage {2}\[decided\]\n/);
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage", "--why", "x"]);
  await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "Too heavy"]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await ok(p, ["kill", "sqlite", "--revisit"]);
  await ok(p, ["edit", "sqlite", "--who", "you"]);
  await ok(p, ["status", "sqlite", "decided"]);
  const mid = (await ok(p, ["show", "storage"])).out;
  expect(mid).toContain("subtree: 2 cards, 2 decided, 1 unchallenged\n");
  expect(mid).toMatch(/^card storage {2}\[decided\]\n/);
  expect(mid).not.toContain("stale");
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const after = (await ok(p, ["show", "storage"])).out;
  expect(after).toContain("subtree: 3 cards, 3 decided, 1 unchallenged\n");
}, 60000);

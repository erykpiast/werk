import { expect, test } from "bun:test";
import { freshProject } from "../src/test/project.ts";
import { card, decided, dep, lines, ok, seed, words } from "./util.ts";

test("64.1 a missing kill criterion refuses the decide, and the printed command fixes it", async () => {
  const p = freshProject();
  seed(p, [
    ...decided("base"),
    card("x", { who: "you" }),
    dep("x", "base"),
    ["node.added", { id: "x:opt0", kind: "option", title: "Other", why_not: "Worse" }],
    ["edge.added", { from: "x:opt0", to: "x", type: "alternative_to" }],
  ]);
  const before = lines(p);
  const run = await p.werk(["status", "x", "decided"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("kill criterion: no kill criterion is on record for #x");
  expect(run.err).toContain("werk kill x --revisit");
  expect(run.err).not.toContain("who:");
  expect((await ok(p, ["show", "x"])).out).toMatch(/^card x {2}\[open\]/);
  expect(lines(p)).toEqual(before);
  // Run the printed command: the line "werk kill x --revisit".
  const printed = run.err.split("\n").map((l) => l.trim().replace(/^or: /, "")).find((l) => l === "werk kill x --revisit") as string;
  expect((await ok(p, words(printed).slice(1))).code).toBe(0);
  expect((await p.werk(["status", "x", "decided"])).code).toBe(0);
  expect((await ok(p, ["show", "x"])).out).toMatch(/^card x {2}\[decided\]/);
}, 60000);

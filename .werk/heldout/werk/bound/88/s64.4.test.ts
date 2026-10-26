import { expect, test } from "bun:test";
import { freshProject } from "../src/test/project.ts";
import { card, decided, dep, lines, ok, seed } from "./util.ts";

// The agent amends by removing the depends_on edge of the decided card (werk unlink).
test("64.4 an amend that removes the depends_on edge is refused and the card stays the same", async () => {
  const p = freshProject();
  seed(p, [
    ...decided("base"),
    card("x", { status: "decided", who: "you", body: "Body text" }),
    ["kill.added", { id: "x", criterion: { form: "revisit" } }],
    dep("x", "base"),
    ["node.added", { id: "x:opt0", kind: "option", title: "Other", why_not: "Worse" }],
    ["edge.added", { from: "x:opt0", to: "x", type: "alternative_to" }],
  ]);
  const showBefore = (await ok(p, ["show", "x"])).out;
  const logBefore = lines(p);
  const run = await p.werk(["unlink", "x", "base", "--type", "depends_on"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("basis: no decided card is a basis of #x");
  expect(run.err).toContain("werk link x <card> --type depends_on");
  expect((await ok(p, ["show", "x"])).out).toBe(showBefore);
  expect(showBefore).toMatch(/^card x {2}\[decided\]/);
  expect(lines(p)).toEqual(logBefore);
}, 60000);

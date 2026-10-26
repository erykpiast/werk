import { expect, test } from "bun:test";
import { freshProject } from "../src/test/project.ts";
import { card, decided, dep, events, lines, ok, seed } from "./util.ts";

test("64.5 an amend that keeps every fact succeeds, and card text is not checked", async () => {
  const p = freshProject();
  seed(p, [
    ...decided("base"),
    card("x", { status: "decided", who: "you", body: "A long first sentence of the body." }),
    ["kill.added", { id: "x", criterion: { form: "revisit" } }],
    dep("x", "base"),
    ["node.added", { id: "x:opt0", kind: "option", title: "Other", why_not: "Worse" }],
    ["edge.added", { from: "x:opt0", to: "x", type: "alternative_to" }],
  ]);
  await ok(p, ["propose", "x", "--ops", JSON.stringify([{ tag: "elaborated", old: "A long first sentence of the body.", new: "Short." }])]);
  const at = lines(p).length;
  const run = await p.werk(["accept", "x", "--actor", "you"]);
  expect(run.code).toBe(0);
  const show = (await ok(p, ["show", "x"])).out;
  expect(show).toMatch(/^card x {2}\[decided\]/);
  expect(show).toContain("Short.");
  expect(show).not.toContain("A long first sentence");
  expect(events(p).slice(at).map((e) => e.type)).toEqual(["node.reopened", "change.accepted", "node.decided"]);
  expect(events(p)[at]?.payload.reason).toBe("amended");
}, 60000);

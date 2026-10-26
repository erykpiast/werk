import { expect, test } from "bun:test";
import { freshProject, type Project } from "../src/test/project.ts";
import { card, decided, edge, ok, proposed, root, seed, w } from "./h.ts";

const show = async (p: Project, ...a: string[]) => (await ok(p, ["show", ...a])).out;

test("11.1", async () => {
  const p = freshProject();
  seed(p, [
    { type: "node.added", payload: { id: "r", kind: "card", title: "R", status: "decided", who: "me", no_basis: "x" } },
    card("c1", { parent: "r" }), card("c2", { parent: "r", status: "proto" }), decided("g", { parent: "c1" }),
  ]);
  const s = await show(p, "r");
  expect(s).toMatch(/subtree: 4 cards, 1 open, 1 proto, 2 decided/);
  expect(s.split("\n").filter((l) => l.startsWith("subtree")).length).toBe(1);
});

test("11.2", async () => {
  const p = freshProject();
  seed(p, [
    { type: "node.added", payload: { id: "par", kind: "card", title: "Par", status: "decided", who: "me", no_basis: "x" } },
    decided("child", { parent: "par" }), card("g1", { parent: "child" }), decided("g2", { parent: "child" }),
  ]);
  const s = await show(p, "par");
  expect(s).toMatch(/subtree: 4 cards/);
  expect(s).toMatch(/<- refines\s+child\s+child\s+\(3 cards/);
});

test("11.3", async () => {
  const p = freshProject();
  seed(p, [
    ...root(), decided("basis", { title: "Basis" }), card("c", { title: "Cee" }), edge("c", "basis", "depends_on", "takes the basis words"),
    { type: "node.added", payload: { id: "o", kind: "option", title: "Opt title", why_not: "Opt why not" } },
    { type: "edge.added", payload: { from: "o", to: "c", type: "alternative_to" } },
    { type: "excerpt.quoted", actor: "agent", payload: { id: "c:ex0", title: "verbatim exact words", card: "c", conversation: "x", session: "s", message: 0, start: 0, end: 20, speaker: "maria", said_at: "t" } },
    { type: "change.accepted", payload: { id: "c:ex0" } },
    { type: "node.proposed", actor: "agent", payload: { id: "s", kind: "source", title: "Src title", finding: "Src finding" } },
    { type: "edge.added", payload: { from: "c", to: "s", type: "supported_by" } },
  ]);
  const s = await show(p, "c");
  console.log(s);
  expect(s).toMatch(/depends_on\s+basis/);
  expect(s).toContain("why: takes the basis words");
  expect(s.indexOf("Options")).toBeGreaterThan(s.indexOf("depends_on"));
  expect(s).toContain("Opt title");
  expect(s).toContain("Opt why not");
  expect(s).toContain("Say");
  expect(s).toContain("maria");
  expect(s).toContain("verbatim exact words");
  expect(s).toContain("Ev");
  expect(s).toContain("Src title");
  expect(s).toContain("Src finding");
  expect(s).toMatch(/Src title.*proposed|proposed.*Src title/s);
});

test("11.4", async () => {
  const p = freshProject();
  seed(p, [
    ...root(), card("c"),
    { type: "excerpt.quoted", actor: "agent", payload: { id: "c:ex0", title: "words said", card: "c", conversation: "x", session: "s", message: 0, start: 0, end: 10, speaker: "maria", said_at: "t" } },
    { type: "change.accepted", payload: { id: "c:ex0" } },
    { type: "node.added", payload: { id: "s", kind: "source", title: "Src", finding: "f" } },
    { type: "edge.added", payload: { from: "c", to: "s", type: "supported_by" } },
  ]);
  const s = await show(p, "c");
  expect(s).toContain("Say");
  expect(s).toContain("Ev");
  expect(s).not.toContain("Options");
});

test("11.5", async () => {
  const p = freshProject();
  seed(p, [...root(), decided("second", { title: "Second card" })]);
  const s = await show(p);
  expect(s).toContain("Root");
  expect(s).toMatch(/subtree: 2 cards/);
  expect(s).toMatch(/<- refines\s+second\s+Second card\s+\(1 card, 1 decided\)/);
});

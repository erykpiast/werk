import { expect, test } from "bun:test";
import { card, chat, edge, freshProject, ok, seed } from "./lib.ts";

test("11.1 rollup counts the card and its refines subtree", async () => {
  const p = freshProject();
  seed(p, [
    card("root", "Root", "decided"),
    card("c1", "Child one", "open", "root"),
    card("c2", "Child two", "proto", "root"),
    card("g1", "Grandchild", "decided", "c1"),
  ]);
  const out = (await ok(p, ["show", "root"])).out;
  const lines = out.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(lines).toEqual(["subtree: 4 cards, 1 open, 1 proto, 2 decided"]);
}, 60_000);

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const p = freshProject();
  seed(p, [
    card("parent", "Parent", "open"),
    card("child", "Child", "open", "parent"),
    card("g1", "Grand one", "open", "child"),
    card("g2", "Grand two", "decided", "child"),
  ]);
  const out = (await ok(p, ["show", "parent"])).out;
  expect(out).toContain("<- refines         child  Child  (3 cards, 2 open, 1 decided)");
  expect(out).toContain("subtree: 4 cards");
}, 60_000);

test("11.3 a card prints options, excerpts and a proposed source with their words", async () => {
  const p = freshProject();
  seed(p, [
    card("base", "Base", "decided"),
    card("x", "Card X", "open"),
    edge("x", "base", "depends_on", "x needs the base layout"),
    ["node.added", { id: "x:opt0", kind: "option", title: "Flat file", why_not: "Slow to scan" }],
    edge("x:opt0", "x", "alternative_to"),
  ]);
  chat(p, "talk", [{ kind: "spoken", text: "we keep one log per conversation", speaker: "person", at: "10:00" }]);
  await ok(p, ["quote", "x", "talk", "one log per conversation"]);
  await ok(p, ["add", "src", "--kind", "source", "--title", "Log survey", "--finding", "Most teams append"]);
  await ok(p, ["link", "x", "src", "--type", "supported_by"]);
  const out = (await ok(p, ["show", "x"])).out;
  const dep = out.indexOf("-> depends_on");
  expect(dep).toBeGreaterThan(-1);
  expect(out).toContain("why: x needs the base layout");
  const opts = out.indexOf("\nOptions\n");
  expect(opts).toBeGreaterThan(out.lastIndexOf("->"));
  expect(out).toContain("  x:opt0  Flat file");
  expect(out).toContain("why not: Slow to scan");
  expect(out).toContain('\nSay\n  x:ex0  person: "one log per conversation"');
  expect(out).toContain("\nEv\n  src  Log survey  proposed\n    finding: Most teams append");
}, 60_000);

test("11.4 a card with no options prints no Options section", async () => {
  const p = freshProject();
  seed(p, [card("x", "Card X", "open")]);
  chat(p, "talk", [{ kind: "spoken", text: "we keep one log", speaker: "person", at: "10:00" }]);
  await ok(p, ["quote", "x", "talk", "one log"]);
  await ok(p, ["add", "src", "--kind", "source", "--title", "Log survey", "--finding", "Most teams append"]);
  await ok(p, ["link", "x", "src", "--type", "supported_by"]);
  const out = (await ok(p, ["show", "x"])).out;
  expect(out).toContain("\nSay\n");
  expect(out).toContain("\nEv\n");
  expect(out).not.toContain("Options");
}, 60_000);

test("11.5 show with no id prints the root card", async () => {
  const p = freshProject();
  seed(p, [card("root", "The root", "open"), card("second", "Second card", "open", "root")]);
  const out = (await ok(p, ["show"])).out;
  expect(out).toStartWith("card root  [open]\nThe root\n");
  expect(out).toContain("subtree: 2 cards, 2 open");
  expect(out).toContain("<- refines         second  Second card  (1 card, 1 open)");
}, 60_000);

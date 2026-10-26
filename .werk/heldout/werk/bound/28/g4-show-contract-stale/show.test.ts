import { expect, test } from "bun:test";
import { card, dep, ev, freshProject, ok } from "./helpers.ts";

test("11.1 rollup counts the card and its whole refines subtree", async () => {
  const p = freshProject();
  card(p, "root", { status: "decided", who: "me", no_basis: "top" });
  card(p, "c1", { parent: "root" });
  card(p, "c2", { parent: "root", status: "proto" });
  card(p, "g1", { parent: "c1", status: "decided", who: "me" });
  const out = (await ok(p, ["show", "root"])).out;
  const roll = out.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(roll).toHaveLength(1);
  expect(roll[0]).toBe("subtree: 4 cards, 1 open, 1 proto, 2 decided");
  const n = (w: string) => Number(new RegExp(`(\\d+) ${w}`).exec(roll[0] as string)?.[1] ?? 0);
  expect(n("open") + n("proto") + n("decided")).toBe(n("cards"));
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const p = freshProject();
  card(p, "parent");
  card(p, "child", { parent: "parent" });
  card(p, "g1", { parent: "child" });
  card(p, "g2", { parent: "child", status: "decided", who: "me" });
  const out = (await ok(p, ["show", "parent"])).out;
  console.log(out);
  const link = out.split("\n").find((l) => /<- refines\s+child /.test(l));
  expect(link).toBeDefined();
  expect(link).toContain("(3 cards, 2 open, 1 decided)");
  expect(out).toContain("\nsubtree: 4 cards");
});

test("11.3 a card prints its options, excerpts and a proposed source", async () => {
  const p = freshProject();
  card(p, "root");
  card(p, "base", { parent: "root", status: "decided", who: "me" });
  card(p, "x", { parent: "root", title: "We charge per seat" });
  ev(p, "edge.added", { from: "x", to: "base", type: "depends_on", why: "X reads the plans of Base" });
  ev(p, "node.added", { id: "x:opt0", kind: "option", title: "Flat fee", why_not: "Big teams underpay" });
  ev(p, "edge.added", { from: "x:opt0", to: "x", type: "alternative_to" });
  ev(p, "excerpt.quoted", {
    id: "x:ex0", title: "Seats are what the buyer counts", card: "x", conversation: "pricing", session: "s1",
    message: 0, start: 0, end: 31, speaker: "you", said_at: "t0",
  });
  await ok(p, ["add", "survey", "--kind", "source", "--title", "Survey", "--finding", "Most pay per seat"]);
  await ok(p, ["link", "x", "survey", "--type", "supported_by"]);
  const run = await ok(p, ["show", "x"]);
  const out = run.out;
  console.log(out, run.err);
  expect(out).toContain("  -> depends_on      base  Card base\n       why: X reads the plans of Base\n");
  const linkAt = out.indexOf("-> depends_on");
  const opt = out.indexOf("\nOptions\n");
  expect(opt).toBeGreaterThan(linkAt);
  expect(out).toContain("Options\n  x:opt0  Flat fee\n    why not: Big teams underpay\n");
  expect(out).toMatch(/\nSay\n {2}x:ex0 {2}you: "Seats are what the buyer counts"/);
  expect(out).toContain("Ev\n  survey  Survey  proposed\n    finding: Most pay per seat\n");
});

test("11.4 a card with no options prints no Options section", async () => {
  const p = freshProject();
  card(p, "x", { title: "X" });
  ev(p, "excerpt.quoted", {
    id: "x:ex0", title: "Seats are what the buyer counts", card: "x", conversation: "pricing", session: "s1",
    message: 0, start: 0, end: 31, speaker: "you", said_at: "t0",
  });
  ev(p, "node.added", { id: "src", kind: "source", title: "Survey", finding: "Most pay per seat" });
  ev(p, "edge.added", { from: "x", to: "src", type: "supported_by" });
  const out = (await ok(p, ["show", "x"])).out;
  expect(out).toContain("\nSay\n");
  expect(out).toContain("\nEv\n");
  expect(out).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  const p = freshProject();
  card(p, "root", { title: "The root" });
  card(p, "second", { parent: "root", title: "Second card" });
  const out = (await ok(p, ["show"])).out;
  expect(out).toStartWith("card root  [open]\nThe root\nsubtree: 2 cards, 2 open\n");
  expect(out).toContain("  <- refines         second  Second card  (1 card, 1 open)\n");
});

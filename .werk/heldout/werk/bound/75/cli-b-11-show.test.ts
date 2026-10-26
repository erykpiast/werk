import { expect, test } from "bun:test";
import { card, decided, link, ok, withMap } from "./cli-b-helpers.ts";

const excerpt = (id: string, cardId: string, words: string, speaker: string): [string, Record<string, unknown>] => [
  "excerpt.quoted",
  { id, title: words, card: cardId, conversation: "c1", session: "s1", message: 0, start: 0, end: words.length, speaker, said_at: "t" },
];

test("11.1", async () => {
  const p = withMap([
    ...decided("root", "Root"),
    card("c1", "Child open", { parent: "root" }),
    card("c2", "Child proto", { parent: "root", status: "proto" }),
    ...decided("g1", "Grandchild", { parent: "c1" }),
  ]);
  const out = (await ok(p, ["show", "root"])).out;
  console.log(out);
  const rollups = out.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(rollups).toHaveLength(1);
  expect(rollups[0]).toBe("subtree: 4 cards, 1 open, 1 proto, 2 decided");
});

test("11.2", async () => {
  const p = withMap([
    ...decided("par", "Parent"),
    card("ch", "Child", { parent: "par" }),
    card("g1", "Grand open", { parent: "ch" }),
    ...decided("g2", "Grand decided", { parent: "ch" }),
  ]);
  const out = (await ok(p, ["show", "par"])).out;
  console.log(out);
  expect(out).toMatch(/\n {2}<- refines +ch {2}Child {2}\(3 cards, 2 open, 1 decided\)\n/);
  expect(out).toContain("\nsubtree: 4 cards, 2 open, 2 decided\n");
});

test("11.3", async () => {
  const p = withMap([
    ...decided("base", "Base card"),
    card("x", "The card", { who: "you" }),
    link("x", "base", "depends_on", "x reads the base grid"),
    ["node.added", { id: "x:opt0", kind: "option", title: "Flat fee", why_not: "Big teams underpay" }],
    link("x:opt0", "x", "alternative_to"),
    excerpt("x:ex0", "x", "we charge per seat", "you"),
    ["node.proposed", { id: "srv", kind: "source", title: "Pricing survey", finding: "Most pay per seat" }],
    link("x", "srv", "supported_by"),
  ]);
  const out = (await ok(p, ["show", "x"])).out;
  console.log(out);
  expect(out).toContain("  -> depends_on      base  Base card\n       why: x reads the base grid\n");
  const linkAt = out.indexOf("-> depends_on");
  const opt = out.indexOf("\nOptions\n");
  expect(opt).toBeGreaterThan(linkAt);
  expect(out).toContain("Options\n  x:opt0  Flat fee\n    why not: Big teams underpay\n");
  expect(out).toMatch(/Say\n {2}x:ex0 {2}you: "we charge per seat"/);
  expect(out).toContain("Ev\n  srv  Pricing survey  proposed\n    finding: Most pay per seat\n");
});

test("11.4", async () => {
  const p = withMap([
    card("x", "The card"),
    excerpt("x:ex0", "x", "per seat", "you"),
    ["node.added", { id: "srv", kind: "source", title: "Survey", finding: "F" }],
    link("x", "srv", "supported_by"),
  ]);
  const out = (await ok(p, ["show", "x"])).out;
  console.log(out);
  expect(out).toContain("\nSay\n");
  expect(out).toContain("\nEv\n");
  expect(out).not.toContain("Options");
});

test("11.5", async () => {
  const p = withMap([...decided("root", "The root title"), card("second", "Second card", { parent: "root" })]);
  const out = (await ok(p, ["show"])).out;
  console.log(out);
  expect(out).toContain("\nThe root title\n");
  expect(out).toContain("\nsubtree: 2 cards, 1 open, 1 decided\n");
  expect(out).toContain("  <- refines         second  Second card  (1 card, 1 open)\n");
});

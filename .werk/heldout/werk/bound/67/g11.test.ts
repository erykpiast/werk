import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { make, type P } from "./lib.ts";

function chat(p: P, name: string, lines: object[]): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
}

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const p = make();
  p.card("root", { title: "Root", status: "decided", who: "me" });
  p.card("c1", { title: "Child one", parent: "root" });
  p.card("c2", { title: "Child two", parent: "root", status: "proto" });
  p.card("g1", { title: "Grandchild", parent: "c1", status: "decided", who: "me" });
  const r = await p.w("show", "root");
  const rollups = r.out.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(rollups.length).toBe(1);
  expect(rollups[0]).toBe("subtree: 4 cards, 1 open, 1 proto, 2 decided");
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const p = make();
  p.card("parent", { title: "Parent" });
  p.card("child", { title: "Child", parent: "parent" });
  p.card("g1", { title: "Grand one", parent: "child" });
  p.card("g2", { title: "Grand two", parent: "child", status: "decided", who: "me" });
  const r = await p.w("show", "parent");
  expect(r.out).toMatch(/<- refines +child +Child +\(3 cards[^)]*\)/);
  expect(r.out).toMatch(/^subtree: 4 cards/m);
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  p.card("base", { title: "Base card", parent: "root" });
  p.card("card", { title: "The card", parent: "root" });
  p.seed("edge.added", { from: "card", to: "base", type: "depends_on", why: "it reuses the base format" });
  p.seed("node.added", { id: "card:opt0", kind: "option", title: "Use a queue", why_not: "a queue loses order" });
  p.seed("edge.added", { from: "card:opt0", to: "card", type: "alternative_to" });
  chat(p, "talk", [
    { speaker: "user", at: "10:00", session: "s1", kind: "spoken", text: "keep the order of every write" },
  ]);
  const q = await p.w("quote", "card", "talk", "keep the order of every write");
  expect(q.code).toBe(0);
  const add = await p.w(
    "add",
    "src-notes",
    "--kind",
    "source",
    "--title",
    "Bench notes",
    "--finding",
    "writes stay ordered",
  );
  expect(add.code).toBe(0);
  expect((await p.w("link", "card", "src-notes", "--type", "supported_by")).code).toBe(0);
  const r = await p.w("show", "card");
  const out = r.out;
  expect(out).toMatch(/-> depends_on +base +Base card/);
  expect(out).toContain("why: it reuses the base format");
  const iOpt = out.indexOf("\nOptions");
  const iSay = out.indexOf("\nSay");
  const iEv = out.indexOf("\nEv");
  const lastLink = out.lastIndexOf("  -> ");
  expect(iOpt).toBeGreaterThan(lastLink);
  expect(out.slice(iOpt)).toContain("Use a queue");
  expect(out.slice(iOpt)).toContain("a queue loses order");
  expect(iSay).toBeGreaterThan(0);
  const say = out.slice(iSay, iEv > iSay ? iEv : undefined);
  expect(say).toContain("user");
  expect(say).toContain("keep the order of every write");
  expect(iEv).toBeGreaterThan(0);
  const ev = out.slice(iEv);
  expect(ev).toContain("Bench notes");
  expect(ev).toContain("writes stay ordered");
  expect(ev).toMatch(/Bench notes.*proposed/);
});

test("11.4 a card with no options prints no Options section", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  p.card("card", { title: "The card", parent: "root" });
  chat(p, "talk", [{ speaker: "agent", at: "10:00", session: "s1", kind: "spoken", text: "every write is ordered" }]);
  expect((await p.w("quote", "card", "talk", "every write is ordered")).code).toBe(0);
  p.seed("node.added", { id: "src-a", kind: "source", title: "Notes", finding: "ordered" });
  p.seed("edge.added", { from: "card", to: "src-a", type: "supported_by" });
  const r = await p.w("show", "card");
  expect(r.out).toMatch(/^Say/m);
  expect(r.out).toMatch(/^Ev/m);
  expect(r.out).not.toMatch(/^Options/m);
});

test("11.5 show with no id prints the root card", async () => {
  const p = make();
  p.card("root", { title: "The root title" });
  p.card("second", { title: "Second card", parent: "root" });
  const r = await p.w("show");
  expect(r.code).toBe(0);
  expect(r.out).toContain("The root title");
  expect(r.out).toMatch(/^subtree: 2 cards/m);
  expect(r.out).toMatch(/<- refines +second +Second card +\(1 card, 1 open\)/);
});

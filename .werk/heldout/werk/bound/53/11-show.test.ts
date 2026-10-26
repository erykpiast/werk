// Held-out steps 11.x: what show prints for a card, its rollups and its words.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, decided, ok, type Project, seeded } from "./helpers.ts";

const edge = (from: string, to: string, type: string, why?: string) => ({
  type: "edge.added",
  payload: { from, to, type, ...(why ? { why } : {}) },
});

function chat(p: Project, name: string, rows: object[]) {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
}

/** The numbers of one rollup text: cards, open, proto, decided. */
function counts(text: string) {
  const n = (word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(text)?.[1] ?? 0);
  return { cards: n("cards?"), open: n("open"), proto: n("proto"), decided: n("decided") };
}

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const p = seeded([
    decided("root", "Root"),
    card("child-a", "Child A", { parent: "root" }),
    card("child-b", "Child B", { parent: "root", status: "proto" }),
    decided("grand", "Grandchild", { parent: "child-a" }),
  ]);
  const out = (await ok(p, ["show", "root"])).out;
  const rollups = out.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(rollups).toHaveLength(1);
  const c = counts(rollups[0] as string);
  expect(c).toEqual({ cards: 4, open: 1, proto: 1, decided: 2 });
  expect(c.open + c.proto + c.decided).toBe(c.cards);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const p = seeded([
    card("parent", "Parent"),
    card("child", "Child", { parent: "parent" }),
    card("g-open", "Open grandchild", { parent: "child" }),
    decided("g-done", "Decided grandchild", { parent: "child" }),
  ]);
  const out = (await ok(p, ["show", "parent"])).out;
  const link = out.split("\n").find((l) => /<- refines +child +Child/.test(l));
  expect(link).toBeDefined();
  expect(counts(link as string).cards).toBe(3);
  const own = out.split("\n").find((l) => l.startsWith("subtree:"));
  expect(counts(own as string).cards).toBe(4);
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const p = seeded([
    decided("base", "Base rule"),
    card("feature", "Feature"),
    edge("feature", "base", "depends_on", "the feature reads the base rule"),
    { type: "node.added", payload: { id: "feature:opt0", kind: "option", title: "Do nothing", why_not: "Users ask for it" } },
    edge("feature:opt0", "feature", "alternative_to"),
  ]);
  chat(p, "talk", [{ speaker: "person", at: "2026-10-01T09:00:00Z", session: "s-1", kind: "spoken", text: "we need the feature now" }]);
  await ok(p, ["quote", "feature", "talk", "we need the feature now"]);
  await ok(p, ["add", "survey", "--kind", "source", "--title", "User survey", "--finding", "Most users want it"]);
  await ok(p, ["link", "feature", "survey", "--type", "supported_by"]);
  const out = (await ok(p, ["show", "feature"])).out;
  expect(out).toMatch(/-> depends_on +base +Base rule.*\n +why: the feature reads the base rule/);
  const options = out.indexOf("\nOptions\n");
  const lastLink = Math.max(out.lastIndexOf("\n  -> "), out.lastIndexOf("\n  <- "));
  expect(options).toBeGreaterThan(lastLink);
  expect(out).toContain("Do nothing");
  expect(out).toContain("why not: Users ask for it");
  const say = out.slice(out.indexOf("\nSay\n"));
  expect(out).toContain("\nSay\n");
  expect(say).toContain('person: "we need the feature now"');
  expect(out).toContain("\nEv\n");
  const ev = out.slice(out.indexOf("\nEv\n"));
  expect(ev).toMatch(/survey +User survey +proposed/);
  expect(ev).toContain("finding: Most users want it");
});

test("11.4 a card with no options prints no Options section", async () => {
  const p = seeded([
    card("feature", "Feature"),
    { type: "node.added", payload: { id: "survey", kind: "source", title: "User survey", finding: "Most want it" } },
    edge("feature", "survey", "supported_by"),
  ]);
  chat(p, "talk", [{ speaker: "person", at: "t", session: "s-1", kind: "spoken", text: "ship the feature" }]);
  await ok(p, ["quote", "feature", "talk", "ship the feature"]);
  const out = (await ok(p, ["show", "feature"])).out;
  expect(out).toContain("\nSay\n");
  expect(out).toContain("\nEv\n");
  expect(out).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  const p = seeded([card("root", "Root card"), card("second", "Second card", { parent: "root" })]);
  const run = await p.werk(["show"]);
  expect(run.err).toBe("");
  expect(run.code).toBe(0);
  expect(run.out).toContain("Root card");
  expect(run.out).toContain("subtree:");
  expect(run.out).toMatch(/<- refines +second +Second card +\(1 card/);
});

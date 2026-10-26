import { expect, test } from "bun:test";
import { world } from "./b-helpers.ts";

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const w = world();
  w.decided("root", "Root");
  w.card("child-open", "Open child", "root");
  w.card("child-proto", "Proto child", "root", { status: "proto" });
  w.decided("grandchild", "Grandchild", "child-open");
  const out = await w.ok("show", "root");
  const rollups = out.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(rollups.length).toBe(1);
  const line = rollups[0] as string;
  expect(line).toMatch(/4 cards/);
  const n = (word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(line)?.[1] ?? "NaN");
  expect(n("open")).toBe(1);
  expect(n("proto")).toBe(1);
  expect(n("decided")).toBe(2);
  expect(n("open") + n("proto") + n("decided")).toBe(4);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const w = world();
  w.card("parent", "Parent");
  w.card("child", "Child", "parent");
  w.card("g-open", "Open grandchild", "child");
  w.decided("g-done", "Decided grandchild", "child");
  const out = await w.ok("show", "parent");
  const link = out.split("\n").find((l) => /<- refines\s+child\s/.test(l)) ?? "";
  expect(link).not.toBe("");
  expect(link).toMatch(/\(3 cards/);
  expect(out).toMatch(/^subtree: 4 cards/m);
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const w = world();
  w.card("root", "Root");
  w.card("base", "Base card", "root");
  w.card("card", "The card", "root");
  w.seed("edge.added", { from: "card", to: "base", type: "depends_on", why: "it reuses the base format" });
  w.seed("node.added", { id: "card:opt0", kind: "option", title: "Two logs", why_not: "they drift apart" });
  w.seed("edge.added", { from: "card:opt0", to: "card", type: "alternative_to" });
  w.chat("design", [{ speaker: "person", at: "2026-01-01T10:00:00Z", session: "s1", kind: "spoken", text: "keep one log and never rewrite it" }]);
  await w.ok("quote", "card", "design", "keep one log and never rewrite it");
  await w.ok("accept", "card:ex0", "--actor", "you");
  await w.ok("add", "paper", "--kind", "source", "--title", "Event sourcing paper", "--finding", "replay rebuilds state");
  await w.ok("link", "card", "paper", "--type", "supported_by");
  const out = await w.ok("show", "card");
  const ls = out.split("\n");
  expect(out).toMatch(/-> depends_on\s+base[^\n]*\n\s+why: it reuses the base format/);
  const lastLink = Math.max(...ls.map((l, i) => (/^\s+(->|<-) /.test(l) ? i : -1)));
  const opt = ls.indexOf("Options");
  expect(opt).toBeGreaterThan(lastLink);
  const optText = ls.slice(opt).join("\n");
  expect(optText).toContain("Two logs");
  expect(optText).toContain("they drift apart");
  const say = ls.indexOf("Say");
  expect(say).toBeGreaterThan(lastLink);
  const sayText = ls.slice(say, ls.indexOf("Ev") > say ? ls.indexOf("Ev") : undefined).join("\n");
  expect(sayText).toContain("person");
  expect(sayText).toContain("keep one log and never rewrite it");
  const ev = ls.indexOf("Ev");
  expect(ev).toBeGreaterThan(lastLink);
  const evText = ls.slice(ev).join("\n");
  expect(evText).toContain("Event sourcing paper");
  expect(evText).toContain("replay rebuilds state");
  expect(ls.find((l) => l.includes("Event sourcing paper") && ls.indexOf(l) > ev)).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  const w = world();
  w.card("root", "Root");
  w.card("card", "The card", "root");
  w.chat("design", [{ speaker: "agent", at: "2026-01-01T10:00:00Z", session: "s1", kind: "spoken", text: "one log per project" }]);
  await w.ok("quote", "card", "design", "one log per project");
  w.seed("node.added", { id: "paper", kind: "source", title: "A paper", finding: "a finding" });
  w.seed("edge.added", { from: "card", to: "paper", type: "supported_by" });
  const ls = (await w.ok("show", "card")).split("\n");
  expect(ls).toContain("Say");
  expect(ls).toContain("Ev");
  expect(ls).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  const w = world();
  w.card("root", "The root card");
  w.card("second", "Second card", "root");
  const r = await w.werk(["show"]);
  expect(r.code).toBe(0);
  expect(r.out).toContain("The root card");
  expect(r.out).toMatch(/^subtree: 2 cards/m);
  expect(r.out).toMatch(/<- refines\s+second\s+Second card\s+\(1 card/);
});

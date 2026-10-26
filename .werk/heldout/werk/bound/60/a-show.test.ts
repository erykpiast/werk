import { expect, test } from "bun:test";
import { card, map } from "./a-helpers.ts";

const rollup = (out: string) => out.split("\n").find((l) => l.startsWith("subtree:")) ?? "";
const nums = (line: string) => {
  const get = (word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(line)?.[1] ?? 0);
  return { cards: get("cards?"), open: get("open"), proto: get("proto"), decided: get("decided") };
};

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const m = map();
  card(m, "top", "Top", "root", { status: "decided" });
  card(m, "c1", "Child one", "top");
  card(m, "c2", "Child two", "top", { status: "proto" });
  card(m, "g1", "Grandchild", "c1", { status: "decided" });
  const r = await m.w("show", "top");
  const lines = r.out.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(lines.length).toBe(1);
  const n = nums(lines[0] ?? "");
  expect(n).toEqual({ cards: 4, open: 1, proto: 1, decided: 2 });
  expect(n.open + n.proto + n.decided).toBe(n.cards);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const m = map();
  card(m, "parent", "Parent");
  card(m, "child", "Child", "parent");
  card(m, "g1", "G one", "child");
  card(m, "g2", "G two", "child", { status: "decided" });
  const r = await m.w("show", "parent");
  const link = r.out.split("\n").find((l) => /<- refines\s+child/.test(l)) ?? "";
  expect(link).not.toBe("");
  expect(link).toMatch(/\(3 cards/);
  expect(nums(rollup(r.out)).cards).toBe(4);
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const m = map();
  card(m, "basis", "Basis");
  card(m, "subject", "Subject");
  m.seed("edge.added", { from: "subject", to: "basis", type: "depends_on", why: "takes the basis rule" });
  m.seed("node.added", { id: "subject:opt0", kind: "option", title: "Other way", why_not: "too slow" });
  m.seed("edge.added", { from: "subject:opt0", to: "subject", type: "alternative_to" });
  m.seed(
    "excerpt.quoted",
    {
      id: "subject-x1",
      title: "we keep one log",
      card: "subject",
      conversation: "c1",
      session: "s1",
      message: 2,
      start: 0,
      end: 15,
      speaker: "person",
      said_at: "2026-01-01T00:00:00Z",
    },
    "agent",
  );
  m.seed("node.proposed", { id: "subject-src", kind: "source", title: "Log study", url: "https://example.invalid", finding: "logs work" }, "agent");
  m.seed("edge.added", { from: "subject", to: "subject-src", type: "supported_by" }, "agent");
  const r = await m.w("show", "subject");
  expect(r.code).toBe(0);
  const out = r.out;
  const dep = out.indexOf("depends_on");
  expect(dep).toBeGreaterThan(-1);
  expect(out).toContain("takes the basis rule");
  const opts = out.indexOf("Options");
  expect(opts).toBeGreaterThan(dep);
  expect(out.slice(opts)).toContain("Other way");
  expect(out.slice(opts)).toContain("too slow");
  const say = out.indexOf("Say");
  expect(say).toBeGreaterThan(-1);
  expect(out.slice(say)).toContain("person");
  expect(out.slice(say)).toContain('"we keep one log"');
  const ev = out.indexOf("Ev");
  expect(ev).toBeGreaterThan(-1);
  const evPart = out.slice(ev);
  expect(evPart).toContain("Log study");
  expect(evPart).toContain("logs work");
  const srcLine = evPart.split("\n").find((l) => l.includes("Log study")) ?? "";
  expect(srcLine).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  const m = map();
  card(m, "subject", "Subject");
  m.seed(
    "excerpt.quoted",
    { id: "subject-x1", title: "words", card: "subject", conversation: "c1", session: "s1", message: 1, start: 0, end: 5, speaker: "agent", said_at: "t" },
    "agent",
  );
  m.seed("node.added", { id: "subject-src", kind: "source", title: "A source", url: "https://example.invalid", finding: "found" });
  m.seed("edge.added", { from: "subject", to: "subject-src", type: "supported_by" });
  const r = await m.w("show", "subject");
  const heads = r.out.split("\n").map((l) => l.trim());
  expect(heads).toContain("Say");
  expect(heads).toContain("Ev");
  expect(heads).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  const m = map();
  card(m, "second", "Second card");
  const r = await m.w("show");
  expect(r.code).toBe(0);
  expect(r.out).toContain("Root");
  expect(rollup(r.out)).not.toBe("");
  expect(r.out).toMatch(/<- refines\s+second\s+Second card\s+\(1 card/);
});

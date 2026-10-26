// Steps 11.1–11.5: werk show, its rollups and its proof sections.
import { expect, test } from "bun:test";
import { project } from "./helper.ts";

test("11.1 the rollup counts the card and its whole refines subtree", () => {
  const p = project();
  p.card("root", "Root", { status: "decided" });
  p.card("c1", "Child one", { parent: "root" });
  p.card("c2", "Child two", { parent: "root", status: "proto" });
  p.card("g", "Grandchild", { parent: "c1", status: "decided" });
  const out = p.werk("show", "root").out;
  const rollups = out.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(rollups.length).toBe(1);
  const m = /subtree: (\d+) cards, (\d+) open, (\d+) proto, (\d+) decided/.exec(rollups[0] as string);
  expect(m).not.toBeNull();
  const [, total, open, proto, decided] = (m as RegExpExecArray).map(Number);
  expect([total, open, proto, decided]).toEqual([4, 1, 1, 2]);
  expect(open + proto + decided).toBe(total);
});

test("11.2 each incoming refines link shows the child's own rollup", () => {
  const p = project();
  p.card("parent", "Parent");
  p.card("child", "Child", { parent: "parent" });
  p.card("g1", "Grand one", { parent: "child" });
  p.card("g2", "Grand two", { parent: "child", status: "decided" });
  const out = p.werk("show", "parent").out;
  const link = out.split("\n").find((l) => /<- refines\s+child/.test(l));
  expect(link).toBeDefined();
  expect(link).toContain("(3 cards");
  expect(out).toMatch(/^subtree: 4 cards/m);
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", () => {
  const p = project();
  p.card("root", "Root", { status: "decided" });
  p.card("other", "Other card", { parent: "root", status: "decided" });
  p.card("card", "The card", { parent: "root" });
  p.seed("edge.added", { from: "card", to: "other", type: "depends_on", why: "it reads the other card's format" });
  p.seed("node.added", { id: "card:opt0", kind: "option", title: "Use a database", why_not: "too heavy to install" });
  p.seed("edge.added", { from: "card:opt0", to: "card", type: "alternative_to" });
  p.seed("excerpt.quoted", {
    id: "card-quote",
    card: "card",
    title: "we keep one log",
    conversation: "conv-1",
    session: "sess-1",
    message: 2,
    start: 0,
    end: 15,
    speaker: "agent",
    said_at: "2026-10-01T10:00:00Z",
  });
  p.seed("node.proposed", { id: "bench", kind: "source", title: "Benchmark notes", finding: "reads take 2 ms" });
  p.seed("edge.added", { from: "card", to: "bench", type: "supported_by" });
  const out = p.werk("show", "card").out;
  expect(out).toMatch(/-> depends_on\s+other/);
  expect(out).toContain("it reads the other card's format");
  const ls = out.split("\n");
  const lastLink = ls.findLastIndex((l) => /^\s+(->|<-) /.test(l));
  const opts = ls.indexOf("Options");
  expect(opts).toBeGreaterThan(lastLink);
  expect(out).toContain("Use a database");
  expect(out).toContain("too heavy to install");
  expect(ls).toContain("Say");
  expect(out).toContain('agent: "we keep one log"');
  expect(ls).toContain("Ev");
  const ev = ls.slice(ls.indexOf("Ev")).join("\n");
  expect(ev).toContain("Benchmark notes");
  expect(ev).toContain("reads take 2 ms");
  expect(ls.slice(ls.indexOf("Ev")).find((l) => l.includes("Benchmark notes"))).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", () => {
  const p = project();
  p.card("root", "Root", { status: "decided" });
  p.card("card", "The card", { parent: "root" });
  p.seed("excerpt.quoted", {
    id: "card-quote",
    card: "card",
    title: "said words",
    conversation: "conv-1",
    session: "sess-1",
    message: 1,
    start: 0,
    end: 10,
    speaker: "you",
    said_at: "2026-10-01T10:00:00Z",
  });
  p.seed("node.added", { id: "src", kind: "source", title: "A source", finding: "it found a thing" });
  p.seed("edge.added", { from: "card", to: "src", type: "supported_by" });
  const ls = p.werk("show", "card").out.split("\n");
  expect(ls).toContain("Say");
  expect(ls).toContain("Ev");
  expect(ls).not.toContain("Options");
});

test("11.5 show with no id prints the root card", () => {
  const p = project();
  p.card("root", "Root card title", { status: "decided" });
  p.card("second", "Second card", { parent: "root" });
  const r = p.werk("show");
  expect(r.code).toBe(0);
  expect(r.out).toContain("Root card title");
  expect(r.out).toMatch(/^subtree: 2 cards/m);
  expect(r.out).toMatch(/<- refines\s+second\s+Second card\s+\(1 card, 1 open\)/);
});

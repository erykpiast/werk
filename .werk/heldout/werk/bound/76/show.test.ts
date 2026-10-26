import { expect, test } from "bun:test";
import { card, chat, chatLine, ok, seed, withRoot } from "./h.ts";

const edge = (from: string, to: string, type: string, why?: string) => ({
  type: "edge.added",
  payload: { from, to, type, ...(why ? { why } : {}) },
});

test("11.1 rollup counts card and subtree", async () => {
  const p = withRoot();
  seed(p, [
    card("top", "Top", { status: "decided" }),
    card("c1", "Child open", { parent: "top" }),
    card("c2", "Child proto", { status: "proto", parent: "top" }),
    card("g1", "Grand", { status: "decided", parent: "c1" }),
  ]);
  const out = (await ok(p, "show", "top")).out;
  expect(out).toMatch(/subtree: 4 cards, 1 open, 1 proto, 2 decided/);
  expect(out.match(/^subtree:/gm)?.length).toBe(1);
});

test("11.2 each incoming refines link shows the child's rollup", async () => {
  const p = withRoot();
  seed(p, [
    card("parent", "Parent", { parent: "root" }),
    card("child", "Child", { parent: "parent" }),
    card("g1", "G one", { parent: "child" }),
    card("g2", "G two", { status: "decided", parent: "child" }),
  ]);
  const out = (await ok(p, "show", "parent")).out;
  expect(out).toMatch(/<- refines\s+child\s+Child\s+\(3 cards/);
  expect(out).toMatch(/subtree: 4 cards/);
});

test("11.3 options, excerpts and a proposed source print with their words", async () => {
  const p = withRoot();
  chat(p, "conv", [chatLine("spoken", "We decided to retry three times", "Dana")]);
  seed(p, [card("base", "Base", { status: "decided", parent: "root" }), card("main", "Main", { parent: "root" })]);
  await ok(p, "link", "main", "base", "--type", "depends_on", "--why", "takes the retry limit");
  await ok(p, "add", "main:opt0", "--kind", "option", "--title", "Retry forever", "--why_not", "never ends");
  await ok(p, "link", "main:opt0", "main", "--type", "alternative_to");
  await ok(p, "quote", "main", "conv", "retry three times");
  await ok(p, "add", "src", "--kind", "source", "--title", "Incident review", "--finding", "retries doubled load");
  await ok(p, "link", "main", "src", "--type", "supported_by");
  const out = (await ok(p, "show", "main")).out;
  expect(out).toMatch(/depends_on\s+base[^\n]*\n\s+why: takes the retry limit/);
  const linksEnd = out.lastIndexOf("  <- alternative_to");
  const opt = out.indexOf("Options");
  expect(opt).toBeGreaterThan(linksEnd);
  expect(out).toMatch(/Options\n\s+main:opt0\s+Retry forever[^\n]*\n\s+why not: never ends/);
  expect(out).toMatch(/Say\n\s+main:ex0\s+Dana: "retry three times"/);
  expect(out).toMatch(/Ev\n\s+src\s+Incident review\s+proposed\n\s+finding: retries doubled load/);
});

test("11.4 no options, no Options section", async () => {
  const p = withRoot();
  chat(p, "conv", [chatLine("spoken", "We decided to retry three times", "Dana")]);
  seed(p, [card("main", "Main", { parent: "root" }), { type: "node.added", payload: { id: "src", kind: "source", title: "S", finding: "f" } }]);
  await ok(p, "link", "main", "src", "--type", "supported_by");
  await ok(p, "quote", "main", "conv", "retry three times");
  const out = (await ok(p, "show", "main")).out;
  expect(out).toContain("Say\n");
  expect(out).toContain("Ev\n");
  expect(out).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  const p = withRoot();
  seed(p, [card("second", "Second card", { parent: "root" })]);
  const out = (await ok(p, "show")).out;
  expect(out).toContain("card root");
  expect(out).toContain("Root");
  expect(out).toMatch(/subtree: 2 cards/);
  expect(out).toMatch(/<- refines\s+second\s+Second card\s+\(1 card/);
});

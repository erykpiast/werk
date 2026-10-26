import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import { card, seed, werk } from "./util.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const lineOf = (text: string, needle: string) =>
  text.split("\n").find((l) => l.includes(needle));

test("11.1 rollup counts the card and its refines subtree", async () => {
  seed(p, [
    ...card("root", "Root", "decided"),
    ...card("c1", "Child one", "open", { parent: "root" }),
    ...card("c2", "Child two", "proto", { parent: "root" }),
    ...card("g1", "Grand", "decided", { parent: "c1" }),
  ]);
  const out = (await werk(p, "show", "root")).stdout;
  const rollup = out.split("\n").filter((l) => /rollup/i.test(l));
  expect(rollup).toHaveLength(1);
  expect(rollup[0]).toMatch(/4 cards/);
  expect(rollup[0]).toMatch(/1 open/);
  expect(rollup[0]).toMatch(/1 proto/);
  expect(rollup[0]).toMatch(/2 decided/);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  seed(p, [
    ...card("parent", "Parent", "decided"),
    ...card("child", "Child", "decided", { parent: "parent" }),
    ...card("g1", "G one", "open", { parent: "child" }),
    ...card("g2", "G two", "decided", { parent: "child" }),
  ]);
  const out = (await werk(p, "show", "parent")).stdout;
  const link = lineOf(out, "<- refines");
  expect(link).toBeDefined();
  expect(out).toMatch(/<- refines[^\n]*\n?[^\n]*3 cards/);
  const rollup = out.split("\n").filter((l) => /rollup/i.test(l));
  expect(rollup.join("\n")).toMatch(/4 cards/);
});

test("11.3 options, excerpts and a proposed source print with their words", async () => {
  seed(p, [
    ...card("a", "Card A", "decided"),
    ...card("b", "Card B", "decided"),
    { type: "edge.added", from: "a", to: "b", link: "depends_on", why: "needs B first" },
    { type: "node.proposed", id: "o", kind: "option", title: "Option title", why: "too slow", status: "open" },
    { type: "node.accepted", id: "o", actor: "you" },
    { type: "edge.added", from: "o", to: "a", link: "alternative_to", why: "alt" },
    { type: "node.proposed", id: "x", kind: "excerpt", title: "Pat", body: "exact spoken words", status: "open" },
    { type: "node.accepted", id: "x", actor: "you" },
    { type: "edge.added", from: "a", to: "x", link: "supported_by", why: "said so" },
    { type: "node.proposed", id: "s", kind: "source", title: "Source title", why: "the finding", status: "open" },
    { type: "edge.added", from: "a", to: "s", link: "supported_by", why: "evidence" },
  ]);
  const out = (await werk(p, "show", "a")).stdout;
  expect(out).toContain("needs B first");
  const iLink = out.indexOf("needs B first");
  const iOpt = out.indexOf("Options");
  expect(iOpt).toBeGreaterThan(iLink);
  expect(out).toContain("Option title");
  expect(out).toContain("too slow");
  expect(out).toMatch(/\bSay\b/);
  expect(out).toContain("Pat");
  expect(out).toContain("exact spoken words");
  expect(out).toMatch(/\bEv\b/);
  expect(out).toContain("Source title");
  expect(out).toContain("the finding");
  expect(out).toMatch(/Source title[^\n]*proposed|proposed[^\n]*Source title/);
});

test("11.4 no options means no Options section", async () => {
  seed(p, [
    ...card("a", "Card A", "decided"),
    { type: "node.proposed", id: "x", kind: "excerpt", title: "Pat", body: "words", status: "open" },
    { type: "node.accepted", id: "x", actor: "you" },
    { type: "edge.added", from: "a", to: "x", link: "supported_by", why: "said" },
    { type: "node.proposed", id: "s", kind: "source", title: "Src", why: "f", status: "open" },
    { type: "node.accepted", id: "s", actor: "you" },
    { type: "edge.added", from: "a", to: "s", link: "supported_by", why: "ev" },
  ]);
  const out = (await werk(p, "show", "a")).stdout;
  expect(out).toMatch(/\bSay\b/);
  expect(out).toMatch(/\bEv\b/);
  expect(out).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  seed(p, [
    ...card("root", "The Root", "decided"),
    ...card("second", "Second", "open", { parent: "root" }),
  ]);
  const r = await werk(p, "show");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("The Root");
  expect(r.stdout).toMatch(/rollup/i);
  expect(r.stdout).toMatch(/<- refines[^\n]*second/);
});

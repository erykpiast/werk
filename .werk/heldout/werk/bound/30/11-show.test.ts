import { expect, test } from "bun:test";
import { useProject } from "../src/test-env/project.ts";
import { card, seedLog, werk } from "./helpers.ts";

const project = useProject();

const refines = (from: string, to: string) => ({
  type: "edge.added",
  from,
  to,
  link: "refines",
});

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const p = project();
  seedLog(p, [
    ...card("root", "Root", "decided"),
    ...card("a", "Child A", "open", { parent: "root" }),
    ...card("b", "Child B", "proto", { parent: "root" }),
    ...card("g", "Grandchild", "decided", { parent: "a" }),
  ]);
  const r = await werk(p, "show", "root");
  expect(r.code).toBe(0);
  const lines = r.stdout.split("\n").filter((l) => /rollup|4 cards/i.test(l));
  expect(lines.length).toBeGreaterThanOrEqual(1);
  expect(lines[0]).toMatch(/4 cards/);
  expect(lines[0]).toMatch(/1 open/);
  expect(lines[0]).toMatch(/1 proto/);
  expect(lines[0]).toMatch(/2 decided/);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const p = project();
  seedLog(p, [
    ...card("parent", "Parent", "decided"),
    ...card("child", "Child", "decided", { parent: "parent" }),
    ...card("g1", "G1", "open", { parent: "child" }),
    ...card("g2", "G2", "decided", { parent: "child" }),
  ]);
  const r = await werk(p, "show", "parent");
  const link = r.stdout.split("\n").find((l) => l.includes("<-") && l.includes("child"));
  expect(link).toBeDefined();
  expect(link).toMatch(/3 cards/);
  const own = r.stdout.split("\n").find((l) => /rollup/i.test(l) || /4 cards/.test(l));
  expect(own).toMatch(/4 cards/);
});

test("11.3 a card prints options, excerpts and a proposed source with their words", async () => {
  const p = project();
  seedLog(p, [
    ...card("base", "Base", "decided"),
    ...card("c", "The card", "open"),
    { type: "edge.added", from: "c", to: "base", link: "depends_on", why: "needs the base" },
    ...card("o", "An option", "open", { why: "too slow" }).slice(0, 0),
    { type: "node.proposed", id: "o", kind: "option", title: "Option title", status: "open", why: "option why-not" },
    { type: "edge.added", from: "o", to: "c", link: "alternative_to" },
    { type: "node.accepted", id: "o", actor: "you" },
    { type: "node.proposed", id: "x", kind: "excerpt", title: "Quote", status: "open", who: "you", body: "exact verbatim words" },
    { type: "edge.added", from: "c", to: "x", link: "supported_by" },
    { type: "node.accepted", id: "x", actor: "you" },
    { type: "node.proposed", id: "s", kind: "source", title: "Source title", status: "open", body: "the finding" },
    { type: "edge.added", from: "c", to: "s", link: "supported_by" },
  ]);
  const r = await werk(p, "show", "c");
  const out = r.stdout;
  expect(out).toContain("needs the base");
  const optionsAt = out.indexOf("Options");
  expect(optionsAt).toBeGreaterThan(out.indexOf("needs the base"));
  expect(out).toContain("Option title");
  expect(out).toContain("option why-not");
  expect(out).toMatch(/Say/);
  expect(out).toContain("exact verbatim words");
  expect(out).toMatch(/Ev/);
  expect(out).toContain("Source title");
  expect(out).toContain("the finding");
  expect(out).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  const p = project();
  seedLog(p, [
    ...card("c", "The card", "open"),
    { type: "node.proposed", id: "x", kind: "excerpt", title: "Quote", status: "open", who: "you", body: "words" },
    { type: "edge.added", from: "c", to: "x", link: "supported_by" },
    { type: "node.proposed", id: "s", kind: "source", title: "Source", status: "open", body: "finding" },
    { type: "edge.added", from: "c", to: "s", link: "supported_by" },
  ]);
  const r = await werk(p, "show", "c");
  expect(r.stdout).toMatch(/Say/);
  expect(r.stdout).toMatch(/Ev/);
  expect(r.stdout).not.toMatch(/Options/);
});

test("11.5 show with no id prints the root card", async () => {
  const p = project();
  seedLog(p, [
    ...card("root", "The Root Title", "decided"),
    ...card("kid", "Kid", "open", { parent: "root" }),
  ]);
  const r = await werk(p, "show");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("The Root Title");
  expect(r.stdout).toMatch(/2 cards/);
  const link = r.stdout.split("\n").find((l) => l.includes("<-") && l.includes("kid"));
  expect(link).toMatch(/1 card/);
});

import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, dec, link, opn, type Project, runner, seed } from "./helpers.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

function tree() {
  seed(project,
    dec("root", undefined, { title: "Root card" }),
    opn("c1", "root", { title: "Child one" }),
    { type: "node.proposed", id: "c2", kind: "card", title: "Child two", status: "proto", parent: "root" },
    { type: "node.accepted", id: "c2", actor: "you" },
    dec("g1", "c1", { title: "Grandchild" }));
}

test("11.1 the rollup counts the card and its refines subtree", async () => {
  tree();
  const r = await runner(project)("show", "root");
  expect(r.code).toBe(0);
  const roll = r.stdout.split("\n").filter((l) => /rollup/i.test(l) || /4 cards/.test(l));
  expect(roll).toHaveLength(1);
  expect(roll[0]).toMatch(/4 cards/);
  expect(roll[0]).toMatch(/1 open/);
  expect(roll[0]).toMatch(/1 proto/);
  expect(roll[0]).toMatch(/2 decided/);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  seed(project, dec("parent", undefined, { title: "Parent" }), dec("child", "parent", { title: "Child" }),
    opn("gc1", "child", { title: "GC one" }), dec("gc2", "child", { title: "GC two" }));
  const r = await runner(project)("show", "parent");
  const out = r.stdout;
  const linkLine = out.split("\n").find((l) => l.includes("<-") && l.includes("child"));
  expect(linkLine).toBeDefined();
  expect(out).toMatch(/3 cards/);
  expect(out).toMatch(/4 cards/);
  const idx = out.split("\n").findIndex((l) => l === linkLine);
  expect(out.split("\n").slice(idx, idx + 3).join("\n")).toMatch(/3 cards/);
});

test("11.3 options, excerpts and a proposed source print with their words", async () => {
  const w = runner(project);
  seed(project, dec("base", undefined, { title: "Base" }), dec("card", undefined, { title: "The card" }),
    link("card", "base", "depends_on"),
    { type: "node.proposed", id: "card:opt0", kind: "option", title: "Use files", why: "files do not scale", status: "open" },
    { type: "node.accepted", id: "card:opt0", actor: "you" },
    link("card:opt0", "card", "alternative_to"),
    { type: "node.proposed", id: "card:ex0", kind: "excerpt", title: "we bill per seat", status: "open" },
    { type: "node.accepted", id: "card:ex0", actor: "you" },
    link("card", "card:ex0", "supported_by"),
    { type: "node.proposed", id: "card:src", kind: "source", title: "Pricing study", why: "Seats win", status: "open" },
    link("card", "card:src", "supported_by"));
  void w;
  const r = await runner(project)("show", "card");
  const out = r.stdout;
  expect(out).toMatch(/depends_on\s+base/);
  expect(out).toMatch(/why: card takes base/);
  expect(out).toMatch(/Options/);
  expect(out).toContain("Use files");
  expect(out).toContain("files do not scale");
  expect(out.indexOf("Options")).toBeGreaterThan(out.indexOf("depends_on"));
  expect(out).toMatch(/Say/);
  expect(out).toContain("we bill per seat");
  expect(out).toMatch(/Ev/);
  expect(out).toContain("Pricing study");
  expect(out).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  seed(project, dec("card", undefined, { title: "The card" }),
    { type: "node.proposed", id: "card:ex0", kind: "excerpt", title: "we bill per seat", status: "open" },
    { type: "node.accepted", id: "card:ex0", actor: "you" },
    link("card", "card:ex0", "supported_by"),
    { type: "node.proposed", id: "card:src", kind: "source", title: "Pricing study", status: "open" },
    { type: "node.accepted", id: "card:src", actor: "you" },
    link("card", "card:src", "supported_by"));
  const out = (await runner(project)("show", "card")).stdout;
  expect(out).toMatch(/Say/);
  expect(out).toMatch(/Ev/);
  expect(out).not.toMatch(/Options/);
});

test("11.5 show with no id prints the root card", async () => {
  seed(project, dec("rootc", undefined, { title: "The root" }), dec("second", "rootc", { title: "Second" }));
  const r = await runner(project)("show");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("The root");
  expect(r.stdout).toMatch(/2 cards/);
  expect(r.stdout).toMatch(/<-\s+refines\s+second/);
  expect(r.stdout).toMatch(/refines\s+second[^\n]*\n?[^\n]*1 card/);
});

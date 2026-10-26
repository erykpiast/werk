import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import { AT, decided, ghost, link, open, seed, werk } from "./g2-util.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const rollupLines = (s: string) => s.split("\n").filter((l) => l.includes("rollup:"));

test("11.1 rollup counts card and refines subtree", async () => {
  seed(p, [
    decided("root", { title: "Root" }),
    // c1 is decided, then its grandchild, then c1 is reopened: open child, decided grandchild
    decided("c1", { parent: "root" }),
    open("c2", { parent: "root", status: "proto" }),
    decided("g", { parent: "c1" }),
    { type: "node.reopened", id: "c1", reason: "invalidated", at: AT },
  ]);
  const r = await werk(p, "show", "root");
  expect(r.code).toBe(0);
  const own = r.stdout.split("\n").filter((l) => l.startsWith("rollup:"));
  expect(own).toHaveLength(1);
  expect(own[0]).toContain("4 cards");
  expect(own[0]).toContain("1 open");
  expect(own[0]).toContain("1 proto");
  expect(own[0]).toContain("2 decided");
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  seed(p, [
    decided("parent", { title: "Parent" }),
    open("child", { title: "Child", parent: "parent" }),
    open("g1", { parent: "child" }),
    decided("g2", { parent: "child" }),
  ]);
  const r = await werk(p, "show", "parent");
  const link = r.stdout.split("\n").find((l) => l.includes("<- refines"));
  expect(link).toBeDefined();
  expect(link).toContain("child");
  expect(link).toContain("3 cards");
  expect(link).not.toContain("4 cards");
  const own = r.stdout.split("\n").find((l) => l.startsWith("rollup:"));
  expect(own).toContain("4 cards");
});

test("11.3 options, excerpts and a proposed source print with their words", async () => {
  seed(p, [
    decided("base", { title: "Base" }),
    ...open("card", { title: "The card" }),
    link("card", "base", "depends_on", "needs the base"),
    open("card:opt0", { kind: "option", title: "Alt option", why: "too slow" }),
    link("card:opt0", "card", "alternative_to", "weighed"),
    {
      type: "excerpt.quoted",
      id: "card:ex0",
      title: "ship it on friday",
      card: "card",
      conversation: "c1",
      session: "s1",
      message: 1,
      start: 0,
      end: 17,
      speaker: "Ann",
      said_at: AT,
    },
    { type: "node.accepted", id: "card:ex0", actor: "you" },
    ghost("card:ev0", { kind: "source", title: "RFC text", why: "the link lasts 15 minutes" }),
    link("card", "card:ev0", "supported_by", "evidence"),
  ]);
  const r = await werk(p, "show", "card");
  expect(r.code).toBe(0);
  const out = r.stdout;
  expect(out).toContain("depends_on");
  expect(out).toContain("needs the base");
  expect(out).toContain("Options:");
  expect(out).toContain("Alt option");
  expect(out).toContain("why not: too slow");
  expect(out.indexOf("needs the base")).toBeLessThan(out.indexOf("Options:"));
  expect(out).toContain("Say:");
  expect(out).toContain("Ann: ship it on friday");
  expect(out).toContain("Ev:");
  const ev = out.slice(out.indexOf("Ev:"));
  expect(ev).toContain("RFC text");
  expect(ev).toContain("proposed");
  expect(ev).toContain("the link lasts 15 minutes");
});

test("11.4 no options means no Options section", async () => {
  seed(p, [
    ...open("card", { title: "The card" }),
    {
      type: "excerpt.quoted",
      id: "card:ex0",
      title: "words",
      card: "card",
      conversation: "c1",
      session: "s1",
      message: 1,
      start: 0,
      end: 5,
      speaker: "Ann",
      said_at: AT,
    },
    { type: "node.accepted", id: "card:ex0", actor: "you" },
    ...open("card:ev0", { kind: "source", title: "Src", why: "found" }),
    link("card", "card:ev0", "supported_by", "e"),
  ]);
  const r = await werk(p, "show", "card");
  expect(r.stdout).toContain("Say:");
  expect(r.stdout).toContain("Ev:");
  expect(r.stdout).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  seed(p, [open("root", { title: "Root title" }), open("second", { title: "Second", parent: "root" })]);
  const r = await werk(p, "show");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Root title");
  expect(rollupLines(r.stdout).length).toBeGreaterThanOrEqual(1);
  const link = r.stdout.split("\n").find((l) => l.includes("<- refines"));
  expect(link).toContain("second");
  expect(link).toContain("rollup: 1 cards");
});

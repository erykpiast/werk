import { afterEach, beforeEach, expect, test } from "bun:test";
import { decided, ghost, link, open } from "../../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";
import { seed, werk } from "./helpers.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const quote = (extra: Record<string, unknown> = {}) => ({
  type: "excerpt.quoted",
  id: "x:ex0",
  title: "seats are the unit",
  card: "x",
  conversation: "pricing",
  session: "s1",
  message: 2,
  start: 0,
  end: 18,
  speaker: "agent",
  said_at: "10:02",
  ...extra,
});

test("11.1 the rollup counts the card and its refines subtree", async () => {
  seed(
    project,
    decided("root", { title: "Root" }),
    open("a", { title: "A", parent: "root" }),
    open("b", { title: "B", parent: "root", status: "proto" }),
    decided("g", { title: "G" }),
    link("g", "a", "refines"),
  );
  const r = await werk(project, "show", "root");
  expect(r.code).toBe(0);
  const rolls = r.stdout.split("\n").filter((l) => l.startsWith("rollup:"));
  expect(rolls).toEqual(["rollup: 4 cards: 1 open, 1 proto, 2 decided"]);
});

test("11.2 an incoming refines link shows the child's own rollup", async () => {
  seed(
    project,
    open("parent", { title: "Parent" }),
    open("child", { title: "Child", parent: "parent" }),
    open("g1", { title: "G1", parent: "child" }),
    decided("g2", { title: "G2" }),
    link("g2", "child", "refines"),
  );
  const r = await werk(project, "show", "parent");
  expect(r.stdout).toMatch(/^rollup: 4 cards/m);
  const row = r.stdout.split("\n").find((l) => l.includes("<- refines"));
  expect(row).toBeDefined();
  expect(row).toContain("child");
  expect(row).toContain("rollup: 3 cards: 2 open, 0 proto, 1 decided");
});

test("11.3 options, excerpts and a proposed source print with their words", async () => {
  seed(
    project,
    open("y", { title: "Y" }),
    open("x", { title: "X" }),
    link("x", "y"),
    ghost("x:opt0", { kind: "option", title: "Per call", why: "Too noisy" }),
    link("x:opt0", "x", "alternative_to"),
    quote(),
    ghost("x:src0", { kind: "source", title: "Survey", why: "70% agree" }),
    link("x", "x:src0", "supported_by"),
  );
  const r = await werk(project, "show", "x");
  expect(r.code).toBe(0);
  const t = r.stdout;
  expect(t).toContain("why: x takes y");
  expect(t.indexOf("Options:")).toBeGreaterThan(t.indexOf("depends_on"));
  expect(t).toMatch(/Options:\n\s+x:opt0\s+Per call/);
  expect(t).toContain("why not: Too noisy");
  expect(t).toContain("Say:\n  agent: seats are the unit");
  expect(t).toContain("Ev:");
  expect(t).toMatch(/x:src0\s+Survey\s+proposed/);
  expect(t).toContain("finding: 70% agree");
});

test("11.4 a card with no options prints no Options section", async () => {
  seed(
    project,
    open("x", { title: "X" }),
    quote(),
    ghost("x:src0", { kind: "source", title: "Survey", why: "70%" }),
    link("x", "x:src0", "supported_by"),
  );
  const r = await werk(project, "show", "x");
  expect(r.stdout).toContain("Say:");
  expect(r.stdout).toContain("Ev:");
  expect(r.stdout).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  seed(
    project,
    open("r", { title: "The Root" }),
    open("second", { title: "Second", parent: "r" }),
  );
  const r = await werk(project, "show");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("The Root");
  expect(r.stdout).toMatch(/^rollup: 2 cards/m);
  const row = r.stdout.split("\n").find((l) => l.includes("<- refines"));
  expect(row).toContain("second");
  expect(row).toContain("rollup: 1 cards");
});

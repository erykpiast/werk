import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import { decided, link, problems, real, seed, werk, writeChat, type Ev } from "./lib.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const optionOf = (id: string, title: string, why: string): Ev[] => [
  { type: "node.proposed", id, kind: "option", title, status: "open", why },
  { type: "node.accepted", id, actor: "you" },
];

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  seed(project, [
    ...decided("root", "Root card"),
    ...real("child-open", "Open child", { parent: "root" }),
    ...real("child-proto", "Proto child", { parent: "root", status: "proto" }),
    // decided first, then attached: a decided card cannot start under an open parent
    ...decided("grand", "Grandchild"),
    link("grand", "child-open", "refines"),
  ]);
  expect(problems(project)).toEqual([]);
  const r = await werk(project, "show", "root");
  expect(r.code, r.stderr).toBe(0);
  const rollups = r.stdout.split("\n").filter((l) => l.startsWith("rollup:"));
  expect(rollups).toEqual(["rollup: 4 cards: 1 open, 1 proto, 2 decided"]);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  seed(project, [
    ...real("parent", "Parent card"),
    ...real("child", "Child card", { parent: "parent" }),
    ...real("g1", "Grand open", { parent: "child" }),
    ...decided("g2", "Grand decided"),
    link("g2", "child", "refines"),
  ]);
  expect(problems(project)).toEqual([]);
  const r = await werk(project, "show", "parent");
  expect(r.code, r.stderr).toBe(0);
  const row = r.stdout.split("\n").find((l) => l.includes("<-") && l.includes("child"));
  expect(row).toBeDefined();
  expect(row).toContain("refines");
  expect(row).toContain("rollup: 3 cards");
  expect(row).not.toContain("rollup: 4 cards");
  expect(r.stdout).toContain("\nrollup: 4 cards");
});

async function pricingExcerpt(card: string) {
  writeChat(project, "pricing", [
    {
      speaker: "person",
      at: "10:02",
      session: "6ae61be7",
      kind: "spoken",
      text: "yes: seats are the unit we bill",
    },
  ]);
  const q = await werk(project, "quote", card, "pricing", "seats are the unit we bill");
  expect(q.code, q.stderr).toBe(0);
}

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  seed(project, [
    ...real("base", "Base card"),
    ...real("x", "The card"),
    link("x", "base", "depends_on", "x needs the base to exist"),
    ...optionOf("x-opt", "Bill per project", "projects vary too much"),
    link("x-opt", "x", "alternative_to"),
    {
      type: "node.proposed",
      id: "x-src",
      kind: "source",
      title: "Pricing survey",
      status: "open",
      why: "most customers prefer seats",
    },
    link("x", "x-src", "supported_by"),
  ]);
  expect(problems(project)).toEqual([]);
  await pricingExcerpt("x");
  const r = await werk(project, "show", "x");
  expect(r.code, r.stderr).toBe(0);
  const out = r.stdout;
  expect(out).toMatch(/-> depends_on\s+base\s+Base card/);
  expect(out).toContain("why: x needs the base to exist");
  const iLink = out.indexOf("depends_on");
  const iOpt = out.indexOf("Options:");
  expect(iOpt).toBeGreaterThan(iLink);
  expect(out).toContain("Bill per project");
  expect(out).toContain("why not: projects vary too much");
  expect(out).toContain("Say:\n  person: seats are the unit we bill");
  const ev = out.slice(out.indexOf("Ev:"));
  expect(ev).toContain("Pricing survey");
  expect(ev).toContain("finding: most customers prefer seats");
  expect(ev).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  seed(project, [
    ...real("x", "The card"),
    {
      type: "node.proposed",
      id: "x-src",
      kind: "source",
      title: "Pricing survey",
      status: "open",
      why: "a finding",
    },
    link("x", "x-src", "supported_by"),
  ]);
  await pricingExcerpt("x");
  const r = await werk(project, "show", "x");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout).toContain("Say:");
  expect(r.stdout).toContain("Ev:");
  expect(r.stdout).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  seed(project, [
    ...real("root", "The root card"),
    ...real("second", "The second card", { parent: "root" }),
  ]);
  const r = await werk(project, "show");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout).toContain("The root card");
  expect(r.stdout).toContain("rollup: 2 cards");
  const row = r.stdout.split("\n").find((l) => l.includes("<-") && l.includes("second"));
  expect(row).toBeDefined();
  expect(row).toContain("refines");
  expect(row).toContain("(rollup: 1 cards");
});

import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  decided,
  ghost,
  link,
  open,
  reopen,
} from "../../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";
import { seedMap, werk } from "./helpers.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const run = (...a: string[]) => werk(project, ...a);

const quote = (id: string, card: string, title: string) => [
  {
    type: "excerpt.quoted",
    id,
    title,
    card,
    conversation: "talk",
    session: "s1",
    speaker: "Ada",
    said_at: "2026-10-10T09:00:00.000Z",
    message: 0,
    start: 0,
    end: title.length,
  },
  { type: "node.accepted", id, actor: "you" },
];

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  seedMap(
    project,
    decided("root", { title: "Root" }),
    // c1 is decided first so that g may be decided under it, then c1 is reopened.
    decided("c1", { parent: "root", title: "Child one" }),
    open("c2", { parent: "root", title: "Child two", status: "proto" }),
    decided("g", { parent: "c1", title: "Grand" }),
    reopen("c1", { reason: "rejected" }),
  );
  const r = await run("show", "root");
  expect(r.code).toBe(0);
  const rollup = r.stdout.split("\n").filter((l) => l.startsWith("rollup:"));
  expect(rollup).toHaveLength(1);
  expect(rollup[0]).toContain("4 cards");
  expect(rollup[0]).toContain("1 open");
  expect(rollup[0]).toContain("1 proto");
  expect(rollup[0]).toContain("2 decided");
});

test("11.2 an incoming refines link shows the child's own rollup", async () => {
  seedMap(
    project,
    decided("parent", { title: "Parent" }),
    decided("child", { parent: "parent", title: "Child" }),
    open("g1", { parent: "child", title: "Grand open" }),
    decided("g2", { parent: "child", title: "Grand decided" }),
  );
  const r = await run("show", "parent");
  expect(r.code).toBe(0);
  const rows = r.stdout.split("\n");
  const own = rows.find((l) => l.startsWith("rollup:"));
  expect(own).toContain("4 cards");
  const incoming = rows.find((l) => l.includes("<- refines") && l.includes("child"));
  expect(incoming).toBeDefined();
  expect(incoming).toContain("3 cards");
});

test("11.3 options, excerpts and a proposed source print with their words", async () => {
  seedMap(
    project,
    open("base", { title: "Base card" }),
    open("card", { title: "The card" }),
    link("card", "base", "depends_on"),
    open("card:opt0", {
      kind: "option",
      title: "Option title",
      why: "too slow",
    }),
    link("card:opt0", "card", "alternative_to"),
    open("card"+"-seed", { title: "unused" }),
    quote("ex1", "card", "we want it fast"),
    ghost("src1", { kind: "source", title: "Source title", why: "the finding text" }),
    link("card", "src1", "supported_by"),
  );
  const r = await run("show", "card");
  expect(r.code).toBe(0);
  const out = r.stdout;
  expect(out).toContain("depends_on");
  expect(out).toContain("card takes base");
  const iDep = out.indexOf("depends_on");
  const iOpt = out.indexOf("Options");
  expect(iOpt).toBeGreaterThan(iDep);
  expect(out).toContain("Option title");
  expect(out).toContain("why not: too slow");
  expect(out).toMatch(/Say:\n\s+Ada: we want it fast/);
  expect(out).toContain("Ev:");
  expect(out).toContain("Source title");
  expect(out).toContain("finding: the finding text");
  expect(out).toMatch(/Source title\s+proposed/);
});

test("11.4 a card with no options prints no Options section", async () => {
  seedMap(
    project,
    open("card", { title: "The card" }),
    quote("ex1", "card", "words said"),
    open("src1", { kind: "source", title: "Src", why: "f" }),
    link("card", "src1", "supported_by"),
  );
  const r = await run("show", "card");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Say:");
  expect(r.stdout).toContain("Ev:");
  expect(r.stdout).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  seedMap(
    project,
    open("root", { title: "The Root" }),
    open("kid", { parent: "root", title: "Kid card" }),
  );
  const r = await run("show");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("The Root");
  expect(r.stdout).toContain("rollup: 2 cards");
  const inc = r.stdout.split("\n").find((l) => l.includes("<- refines"));
  expect(inc).toContain("kid");
  expect(inc).toContain("rollup: 1 cards");
});

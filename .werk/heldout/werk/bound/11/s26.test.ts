import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../src/test/project.ts";
import { card, seeded } from "./helpers.ts";

const spec = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nThe CLI.\n`;

const ticket = (o: { title?: string; cites: string; blocked: string; stories: string; what?: string; checks?: string }) =>
  `${o.title === undefined ? "" : `title: ${o.title}\n`}cites: ${o.cites}
blocked_by: ${o.blocked}
stories: ${o.stories}
touches: map view

## What to build

${o.what ?? "A person opens a card and sees its words."}

## Acceptance criteria

- [ ] The card shows its words.

## Checks

${o.checks ?? ""}
`;

function setup(seeds: Parameters<typeof seeded>[0], stories: number, files: Record<string, string>): Project {
  const p = seeded(seeds);
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", name), text);
  return p;
}

const base = () => [
  card("root", "Root", { status: "decided" }),
  card("d1", "Decided one", { parent: "root", status: "decided" }),
  card("d2", "Decided two", { parent: "root", status: "decided" }),
];

const validFiles = () => ({
  "01-first.md": ticket({ title: "First slice", cites: "root, d1", blocked: "", stories: "1", checks: "- `make test`" }),
  "02-second.md": ticket({ title: "Second slice", cites: "#d2", blocked: "1", stories: "2" }),
});

const check = (p: Project, ...args: string[]) => p.werk(["ticket-check", "tickets", ...args]);

test("26.1 a folder of valid hand-written tickets gets a clean pass", async () => {
  const p = setup(base(), 2, validFiles());
  const run = await check(p, "--root", "root", "--spec", "spec.md");
  const out = run.out.split("\n").filter((l) => l !== "");
  expect(out.length).toBe(1);
  expect(out.at(-1)).toMatch(/\b0 failures\b/);
  expect(run.code).toBe(0);
});

test("26.2 a file path and an oversized ticket are each named with their ticket and place", async () => {
  const files = validFiles();
  files["01-first.md"] = ticket({
    title: "First slice",
    cites: "root, d1",
    blocked: "",
    stories: "1",
    checks: "- `make test`",
    what: "Change src/loop.ts so the loop stops.\nThe Makefile keeps its targets.",
  });
  files["02-second.md"] = ticket({
    title: "Second slice",
    cites: "#d2",
    blocked: "1",
    stories: "2",
    what: `A person opens a card. ${"padding ".repeat(520)}`,
  });
  expect(files["02-second.md"].length).toBeGreaterThan(4000);
  expect(files["01-first.md"].split("\n")[8]).toContain("src/loop.ts");
  const p = setup(base(), 2, files);
  const run = await check(p, "--root", "root", "--spec", "spec.md");
  const out = run.out.split("\n").filter((l) => l !== "");
  const pathLine = out.find((l) => l.startsWith("01-first.md") && l.includes("no-file-paths")) ?? "";
  expect(pathLine).toContain("src/loop.ts");
  expect(pathLine).toContain("line 9");
  expect(out.some((l) => l.includes("Makefile"))).toBe(false);
  expect(out.some((l) => l.startsWith("02-second.md") && l.includes("size"))).toBe(true);
  expect(out.at(-1)).toMatch(/[1-9]\d* failures?/);
  expect(run.code).toBe(1);
});

test("26.3 the set checks report an uncited card, a missing story and a blocker cycle, but not a ghost", async () => {
  const seeds = [
    ...base(),
    ["node.proposed", { id: "g1", kind: "card", title: "Ghost one", parent: "root" }] as [string, Record<string, unknown>],
  ];
  const p = setup(seeds, 3, {
    "01-one.md": ticket({ title: "One", cites: "root, d1", blocked: "", stories: "1" }),
    "02-two.md": ticket({ title: "Two", cites: "d1", blocked: "3", stories: "2" }),
    "03-three.md": ticket({ title: "Three", cites: "root", blocked: "2", stories: "1" }),
  });
  const run = await check(p, "--root", "root", "--spec", "spec.md");
  const out = run.out.split("\n").filter((l) => l !== "");
  const cited = out.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toContain("d2");
  const stories = out.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories.length).toBe(1);
  expect(stories[0]).toContain("3");
  const cycle = out.find((l) => l.includes("blocked_by") && l.includes("cycle")) ?? "";
  expect(cycle).toContain("02-two.md");
  expect(cycle).toContain("03-three.md");
  expect(out.some((l) => l.includes("g1"))).toBe(false);
  expect(run.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, and its cites do not count for the set", async () => {
  const p = setup([card("root", "Root", { status: "decided" }), card("d1", "Decided one", { parent: "root", status: "decided" })], 1, {
    "01-untitled.md": ticket({ cites: "root, d1", blocked: "", stories: "1" }),
  });
  const run = await check(p, "--root", "root", "--spec", "spec.md");
  const out = run.out.split("\n").filter((l) => l !== "");
  const own = out.filter((l) => l.startsWith("01-untitled.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain("title");
  expect(out.some((l) => l.startsWith("ticket set") && l.includes("cards-cited") && l.includes("d1"))).toBe(true);
  expect(out.some((l) => l.startsWith("ticket set") && l.includes("stories") && l.includes("1"))).toBe(true);
  expect(run.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const p = setup(base(), 2, validFiles());
  const missing = await check(p, "--root", "root", "--spec", "nope.md");
  expect(`${missing.out}${missing.err}`).toMatch(/spec/);
  expect(`${missing.out}${missing.err}`).toContain("nope.md");
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad-spec.md"), "# Spec\n\n1. A story with no heading.\n");
  expect((await check(p, "--root", "root", "--spec", "bad-spec.md")).code).toBe(2);
  expect((await check(p, "--root", "no-such-card", "--spec", "spec.md")).code).toBe(2);
  expect((await check(p, "--spec", "spec.md")).code).toBe(2);
});

// Held-out steps 26.1-26.5: werk ticket-check.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const spec = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nNone.\n`;

const ticket = (o: {
  title?: string;
  cites: string;
  blocked?: string;
  stories: string;
  checks?: string;
  extra?: string;
}) =>
  `${o.title === undefined ? "" : `title: ${o.title}\n`}cites: ${o.cites}
blocked_by: ${o.blocked ?? ""}
stories: ${o.stories}
touches: map view, decision log

## What to build

A person opens a decided card and presses reopen.${o.extra ?? ""}

## Acceptance criteria

- [ ] A reopened card shows as open in the map.

## Checks

${o.checks ?? ""}
`;

function project(events: { type: string; payload: object }[], stories: number): Project {
  const p = freshProject();
  const log = events.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e }));
  appendFileSync(join(p.dir, ".werk", "log.jsonl"), `${log.join("\n")}\n`);
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}

const twoDecided = [
  { type: "node.added", payload: { id: "base", kind: "card", title: "Base" } },
  { type: "node.added", payload: { id: "card-a", kind: "card", title: "A", parent: "base" } },
  { type: "node.added", payload: { id: "card-b", kind: "card", title: "B", parent: "base" } },
  { type: "node.decided", payload: { id: "base" } },
  { type: "node.decided", payload: { id: "card-a" } },
  { type: "node.decided", payload: { id: "card-b" } },
];

function tickets(p: Project, files: Record<string, string>) {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", name), text);
}

const check = (p: Project, ...args: string[]) =>
  p.werk(["ticket-check", "tickets", "--root", "base", "--spec", "spec.md", ...args]);

const valid = () => ({
  "01-first.md": ticket({ title: "First slice", cites: "base, card-a", stories: "1", checks: "- `make test`" }),
  "02-second.md": ticket({ title: "Second slice", cites: "#card-b", blocked: "1", stories: "2" }),
});

test("26.1", async () => {
  const p = project(twoDecided, 2);
  tickets(p, valid());
  const r = await check(p);
  console.log("26.1:", r);
  const outLines = r.out.split("\n").filter(Boolean);
  expect(outLines).toHaveLength(1);
  expect(outLines.at(-1)).toMatch(/\b0 failures\b/);
  expect(r.code).toBe(0);
});

test("26.2", async () => {
  const p = project(twoDecided, 2);
  const v = valid();
  tickets(p, v);
  expect((await check(p)).code).toBe(0);
  const first = v["01-first.md"].split("\n");
  first[8] = "Edit src/loop.ts so the reopen runs, then the Makefile target.";
  const second = v["02-second.md"].replace("presses reopen.", `presses reopen. ${"pad ".repeat(1000)}`);
  expect(second.length).toBeGreaterThan(4000);
  tickets(p, { "01-first.md": first.join("\n"), "02-second.md": second });
  const r = await check(p);
  console.log("26.2:", r);
  const outLines = r.out.split("\n").filter(Boolean);
  const pathLine = outLines.find((l) => l.startsWith("01-first.md") && l.includes("no-file-paths"));
  expect(pathLine).toBeDefined();
  expect(pathLine).toContain("src/loop.ts");
  expect(pathLine).toContain("line 9");
  expect(outLines.slice(0, -1).filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(outLines.find((l) => l.startsWith("02-second.md") && l.includes("size"))).toBeDefined();
  expect(outLines.at(-1)).not.toMatch(/\b0 failures\b/);
  expect(r.code).toBe(1);
});

test("26.3", async () => {
  const p = project(
    [
      ...twoDecided,
      { type: "node.proposed", payload: { id: "card-ghost", kind: "card", title: "Ghost", parent: "base" } },
    ],
    3,
  );
  tickets(p, {
    "01-one.md": ticket({ title: "One", cites: "base, card-a", stories: "1" }),
    "02-two.md": ticket({ title: "Two", cites: "card-a", blocked: "3", stories: "2" }),
    "03-three.md": ticket({ title: "Three", cites: "base", blocked: "2", stories: "1" }),
  });
  const r = await check(p);
  console.log("26.3:", r);
  const outLines = r.out.split("\n").filter(Boolean);
  const cited = outLines.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited).toHaveLength(1);
  expect(cited[0]).toContain("card-b");
  const stories = outLines.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories).toHaveLength(1);
  expect(stories[0]).toMatch(/\b3\b/);
  const cycle = outLines.find((l) => l.includes("blocked_by") && l.includes("cycle"));
  expect(cycle).toBeDefined();
  expect(cycle).toContain("02-two.md");
  expect(cycle).toContain("03-three.md");
  expect(outLines.filter((l) => l.includes("card-ghost"))).toEqual([]);
  expect(r.code).toBe(1);
});

test("26.4", async () => {
  const p = project(
    [
      { type: "node.added", payload: { id: "base", kind: "card", title: "Base" } },
      { type: "node.added", payload: { id: "card-a", kind: "card", title: "A", parent: "base" } },
      { type: "node.decided", payload: { id: "card-a" } },
    ],
    1,
  );
  tickets(p, { "01-untitled.md": ticket({ cites: "card-a", stories: "1" }) });
  const r = await check(p);
  console.log("26.4:", r);
  const outLines = r.out.split("\n").filter(Boolean);
  const own = outLines.filter((l) => l.startsWith("01-untitled.md"));
  expect(own).toHaveLength(1);
  expect(own[0]).toContain("title");
  expect(outLines.find((l) => l.startsWith("ticket set") && l.includes("card-a"))).toBeDefined();
  expect(outLines.find((l) => l.startsWith("ticket set") && l.includes("stories") && /\b1\b/.test(l))).toBeDefined();
  expect(r.code).toBe(1);
});

test("26.5", async () => {
  const p = project(twoDecided, 2);
  tickets(p, valid());
  const missing = await p.werk(["ticket-check", "tickets", "--root", "base", "--spec", "none.md"]);
  console.log("26.5 missing:", missing);
  expect(`${missing.out}${missing.err}`).toMatch(/spec file/);
  expect(`${missing.out}${missing.err}`).toContain("none.md");
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "nostories.md"), "# Spec\n\n1. A line.\n");
  expect((await p.werk(["ticket-check", "tickets", "--root", "base", "--spec", "nostories.md"])).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--root", "nope", "--spec", "spec.md"])).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--spec", "spec.md"])).code).toBe(2);
});

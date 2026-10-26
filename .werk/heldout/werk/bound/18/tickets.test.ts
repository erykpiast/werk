// Held-out steps 26.1–26.5: `werk ticket-check` on a folder of hand-written tickets.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

type Ev = { type: string; payload: object };

function seed(p: Project, events: Ev[]): void {
  const lines = events.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e }));
  appendFileSync(join(p.dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
}

const spec = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nThe command line.\n`;

const ticket = (o: {
  title?: string;
  cites: string;
  blockedBy: string;
  stories: string;
  checks?: string;
  what?: string;
}) =>
  `${o.title === undefined ? "" : `title: ${o.title}\n`}cites: ${o.cites}
blocked_by: ${o.blockedBy}
stories: ${o.stories}
touches: map view, decision log

## What to build

${o.what ?? "A person opens a decided card and presses reopen."}

## Acceptance criteria

- [ ] A reopened card shows as open in the map.

## Checks

${o.checks ?? ""}
`;

function project(events: Ev[], stories: number): Project {
  const p = freshProject();
  seed(p, events);
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}

const write = (p: Project, files: Record<string, string>) => {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", name), text);
};

const check = (p: Project, root = "root", specFile = "spec.md") =>
  p.werk(["ticket-check", "tickets", "--root", root, "--spec", specFile]);

const twoDecided: Ev[] = [
  { type: "node.added", payload: { id: "root", kind: "card", title: "Root" } },
  { type: "node.added", payload: { id: "alpha", kind: "card", title: "Alpha", parent: "root" } },
  { type: "node.added", payload: { id: "beta", kind: "card", title: "Beta", parent: "root" } },
  { type: "node.decided", payload: { id: "root" } },
  { type: "node.decided", payload: { id: "alpha" } },
  { type: "node.decided", payload: { id: "beta" } },
];

const validTickets = () => ({
  "01-first.md": ticket({
    title: "First slice",
    cites: "root, alpha",
    blockedBy: "",
    stories: "1",
    checks: "- `make test`",
  }),
  "02-second.md": ticket({ title: "Second slice", cites: "#beta", blockedBy: "1", stories: "2" }),
});

test("26.1 a folder of valid hand-written tickets passes clean", async () => {
  const p = project(twoDecided, 2);
  write(p, validTickets());
  const run = await check(p);
  console.log("26.1", JSON.stringify(run));
  const lines = run.out.trimEnd().split("\n");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/\b0 failures\b/);
  expect(run.code).toBe(0);
});

test("26.2 a file path and an oversized ticket are each named with ticket and place", async () => {
  const p = project(twoDecided, 2);
  write(p, validTickets());
  expect((await check(p)).code).toBe(0);
  const t = validTickets();
  const first = t["01-first.md"].split("\n");
  // File line 9 is the first line of the What to build section text.
  first[8] = "Change src/loop.ts so the reopen runs, then run the Makefile target.";
  const second = t["02-second.md"].replace("presses reopen.", `presses reopen. ${"pad ".repeat(1100)}`);
  expect(second.length).toBeGreaterThan(4000);
  write(p, { "01-first.md": first.join("\n"), "02-second.md": second });
  const run = await check(p);
  console.log("26.2", JSON.stringify(run));
  const lines = run.out.trimEnd().split("\n");
  const failures = lines.slice(0, -1);
  const pathLine = failures.find((l) => l.startsWith("01-first.md") && l.includes("no-file-paths"));
  expect(pathLine).toBeDefined();
  expect(pathLine).toContain("src/loop.ts");
  expect(pathLine).toContain("line 9");
  expect(failures.filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(failures.find((l) => l.startsWith("02-second.md") && l.includes("size"))).toBeDefined();
  expect(lines.at(-1)).toMatch(/[1-9]\d* failures?\b/);
  expect(run.code).toBe(1);
});

test("26.3 set checks report uncited card, missing story and blocker cycle, but not a ghost", async () => {
  const p = project(
    [
      ...twoDecided,
      { type: "node.proposed", payload: { id: "ghosty", kind: "card", title: "Ghosty", parent: "root" } },
    ],
    3,
  );
  write(p, {
    "01-one.md": ticket({ title: "One", cites: "root, alpha", blockedBy: "", stories: "1" }),
    "02-two.md": ticket({ title: "Two", cites: "alpha", blockedBy: "3", stories: "2" }),
    "03-three.md": ticket({ title: "Three", cites: "root", blockedBy: "2", stories: "1, 2" }),
  });
  const run = await check(p);
  console.log("26.3", JSON.stringify(run));
  const lines = run.out.trimEnd().split("\n");
  const cited = lines.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited).toHaveLength(1);
  expect(cited[0]).toContain("beta");
  const stories = lines.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories).toHaveLength(1);
  expect(stories[0]).toContain("3");
  const cycle = lines.find((l) => l.includes("blocked_by") && l.includes("cycle"));
  expect(cycle).toBeDefined();
  expect(cycle).toContain("02-two.md");
  expect(cycle).toContain("03-three.md");
  expect(lines.filter((l) => l.includes("ghosty"))).toEqual([]);
  expect(run.code).toBe(1);
});

test("26.4 a ticket with no title fails alone and its cites do not count", async () => {
  const p = project(
    [
      { type: "node.added", payload: { id: "root", kind: "card", title: "Root" } },
      { type: "node.added", payload: { id: "alpha", kind: "card", title: "Alpha", parent: "root" } },
      { type: "node.decided", payload: { id: "root" } },
      { type: "node.decided", payload: { id: "alpha" } },
    ],
    1,
  );
  write(p, { "01-untitled.md": ticket({ cites: "root, alpha", blockedBy: "", stories: "1" }) });
  const run = await check(p);
  console.log("26.4", JSON.stringify(run));
  const lines = run.out.trimEnd().split("\n").slice(0, -1);
  const own = lines.filter((l) => l.startsWith("01-untitled.md"));
  expect(own.some((l) => l.includes("title"))).toBe(true);
  expect(own.filter((l) => /\b(shape|size)\b/.test(l) || !l.includes("title"))).toEqual([]);
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("alpha"))).toBe(true);
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("stor") && l.includes("1"))).toBe(true);
  expect(run.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const p = project(twoDecided, 2);
  write(p, validTickets());
  const missing = await check(p, "root", "none.md");
  console.log("26.5a", JSON.stringify(missing));
  expect(`${missing.out}${missing.err}`).toMatch(/spec/i);
  expect(`${missing.out}${missing.err}`).toContain("none.md");
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "nostories.md"), "# Spec\n\n1. A line.\n");
  const noHeading = await check(p, "root", "nostories.md");
  console.log("26.5b", JSON.stringify(noHeading));
  expect(noHeading.code).toBe(2);
  const badRoot = await check(p, "not-a-card", "spec.md");
  console.log("26.5c", JSON.stringify(badRoot));
  expect(badRoot.code).toBe(2);
  const noRoot = await p.werk(["ticket-check", "tickets", "--spec", "spec.md"]);
  console.log("26.5d", JSON.stringify(noRoot));
  expect(noRoot.code).toBe(2);
});

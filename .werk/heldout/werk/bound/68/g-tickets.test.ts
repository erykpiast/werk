// Held-out steps 26.1–26.5: `werk ticket-check` on hand-written ticket folders.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

type Ev = { type: string; payload: Record<string, unknown> };

function seed(p: Project, events: Ev[]): void {
  const log = events.map((event, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...event }));
  appendFileSync(join(p.dir, ".werk", "log.jsonl"), `${log.join("\n")}\n`);
}

const card = (id: string, parent?: string): Ev => ({
  type: "node.added",
  payload: { id, kind: "card", title: id, ...(parent ? { parent } : {}) },
});
const decide = (id: string): Ev => ({ type: "node.decided", payload: { id } });

function spec(p: Project, stories: number[], heading = "User stories"): void {
  const lines = stories.map((n) => `${n}. As a person, I want thing ${n}.`).join("\n");
  writeFileSync(join(p.dir, "spec.md"), `# Spec\n\n## ${heading}\n\n${lines}\n\n## Seams\n\nThe command line.\n`);
}

const ticket = (o: {
  title?: string;
  cites: string;
  blocked: string;
  stories: string;
  build?: string;
  checks?: string;
  extra?: string;
}) =>
  `${o.title === undefined ? "" : `title: ${o.title}\n`}cites: ${o.cites}
blocked_by: ${o.blocked}
stories: ${o.stories}
touches: map view, decision log

## What to build

${o.build ?? "A person opens a decided card and presses reopen."}${o.extra ?? ""}

## Acceptance criteria

- [ ] A reopened card shows as open in the map.

## Checks

${o.checks ?? ""}
`;

function tickets(p: Project, files: Record<string, string>): void {
  mkdirSync(join(p.dir, "tickets"), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", name), text);
}

const check = (p: Project, ...args: string[]) => p.werk(["ticket-check", "tickets", ...args]);
const failureLines = (out: string) => out.split("\n").filter((l) => /^\S.*?: [\w-]+: /.test(l));

function validProject(): Project {
  const p = freshProject();
  seed(p, [card("root"), card("alpha", "root"), card("beta", "root"), decide("alpha"), decide("beta")]);
  spec(p, [1, 2]);
  tickets(p, {
    "01-first.md": ticket({ title: "First", cites: "root, alpha", blocked: "", stories: "1", checks: "- `make test`" }),
    "02-second.md": ticket({ title: "Second", cites: "#beta", blocked: "1", stories: "2", checks: "" }),
  });
  return p;
}

test("26.1 a folder of valid hand-written tickets gets a clean pass", async () => {
  const p = validProject();
  const run = await check(p, "--root", "root", "--spec", "spec.md");
  const lines = run.out.trim().split("\n");
  expect(lines.length).toBe(1);
  expect(lines.at(-1)).toMatch(/\b0 failures\b/);
  expect(run.code).toBe(0);
});

test("26.2 a file path and an oversized ticket are named with their ticket and place", async () => {
  const p = validProject();
  tickets(p, {
    "01-first.md": ticket({
      title: "First",
      cites: "root, alpha",
      blocked: "",
      stories: "1",
      build: "The loop lives in src/loop.ts today.",
      extra: "\nThe Makefile gets a target.",
      checks: "- `make test`",
    }),
    "02-second.md": ticket({
      title: "Second",
      cites: "#beta",
      blocked: "1",
      stories: "2",
      extra: `\n${"padding words. ".repeat(300)}`,
    }),
  });
  const run = await check(p, "--root", "root", "--spec", "spec.md");
  const lines = run.out.trim().split("\n");
  const path = lines.find((l) => l.startsWith("01-first.md") && l.includes("no-file-paths"));
  expect(path).toBeDefined();
  expect(path).toContain("src/loop.ts");
  expect(path).toContain("line 9");
  expect(failureLines(run.out).filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(lines.some((l) => l.startsWith("02-second.md") && l.includes("size"))).toBe(true);
  expect(lines.at(-1)).toMatch(/\b[1-9]\d* failures\b/);
  expect(run.code).toBe(1);
});

test("26.3 the set checks report an uncited card, a missing story and a cycle, but not a ghost", async () => {
  const p = freshProject();
  seed(p, [
    card("root"),
    card("alpha", "root"),
    card("beta", "root"),
    { type: "node.proposed", payload: { id: "ghosty", kind: "card", title: "ghosty", parent: "root" } },
    decide("alpha"),
    decide("beta"),
  ]);
  spec(p, [1, 2, 3]);
  tickets(p, {
    "01-a.md": ticket({ title: "A", cites: "root, alpha", blocked: "", stories: "1" }),
    "02-b.md": ticket({ title: "B", cites: "alpha", blocked: "3", stories: "2" }),
    "03-c.md": ticket({ title: "C", cites: "root", blocked: "2", stories: "1" }),
  });
  const run = await check(p, "--root", "root", "--spec", "spec.md");
  const lines = run.out.trim().split("\n");
  const cited = lines.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toContain("beta");
  const stories = lines.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories.length).toBe(1);
  expect(stories[0]).toContain("3");
  const cycle = lines.find((l) => l.includes("blocked_by") && l.includes("02-b.md") && l.includes("03-c.md"));
  expect(cycle).toBeDefined();
  expect(lines.some((l) => l.includes("ghosty"))).toBe(false);
  expect(run.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, and its cites do not count", async () => {
  const p = freshProject();
  seed(p, [card("root"), card("alpha", "root"), decide("alpha")]);
  spec(p, [1]);
  tickets(p, { "01-a.md": ticket({ cites: "alpha", blocked: "", stories: "1" }) });
  const run = await check(p, "--root", "root", "--spec", "spec.md");
  const lines = run.out.trim().split("\n");
  const own = lines.filter((l) => l.startsWith("01-a.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain("title");
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("cards-cited") && l.includes("alpha"))).toBe(true);
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("stories") && l.includes("1"))).toBe(true);
  expect(run.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const p = validProject();
  const missing = await check(p, "--root", "root", "--spec", "nope.md");
  expect(`${missing.out}${missing.err}`).toMatch(/spec/i);
  expect(`${missing.out}${missing.err}`).toContain("nope.md");
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad.md"), "# Spec\n\n## Stories\n\n1. One.\n");
  expect((await check(p, "--root", "root", "--spec", "bad.md")).code).toBe(2);
  expect((await check(p, "--root", "no-such-root", "--spec", "spec.md")).code).toBe(2);
  expect((await check(p, "--spec", "spec.md")).code).toBe(2);
});

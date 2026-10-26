// Binder: steps 26.1 to 26.5, `werk ticket-check` on hand-written ticket folders.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../src/test/project.ts";
import { card, seeded } from "./f-helpers.ts";

const spec = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nThe command line.\n`;

type T = { title?: string; cites: string; blocked: string; stories: string; build?: string; checks?: string };
const ticket = (t: T) =>
  `${t.title === undefined ? "" : `title: ${t.title}\n`}cites: ${t.cites}
blocked_by: ${t.blocked}
stories: ${t.stories}
touches: map view

## What to build

${t.build ?? "A person reopens a card and sees it open."}

## Acceptance criteria

- [ ] The card shows as open.

## Checks
${t.checks ?? ""}`;

function setup(events: object[], stories: number, tickets: Record<string, string>): { p: Project; dir: string } {
  const p = seeded(events as never);
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  const dir = join(p.dir, "tickets");
  mkdirSync(dir);
  for (const [name, text] of Object.entries(tickets)) writeFileSync(join(dir, name), text);
  return { p, dir };
}

const decided = (id: string, parent?: string) => card(id, { status: "decided", ...(parent && { parent }) });
const failureLines = (out: string) => out.split("\n").filter((l) => /^(ticket set|\S+): [a-z_-]+: /.test(l));

test("26.1 a folder of valid hand-written tickets gets a clean pass", async () => {
  const { p, dir } = setup([decided("root"), decided("one", "root"), decided("two", "root")], 2, {
    "01-first.md": ticket({ title: "First", cites: "root, one", blocked: "", stories: "1", checks: "\n- `make test`\n" }),
    "02-second.md": ticket({ title: "Second", cites: "#two", blocked: "1", stories: "2" }),
  });
  const run = await p.werk(["ticket-check", dir, "--root", "root", "--spec", "spec.md"]);
  expect(failureLines(run.out)).toEqual([]);
  const last = run.out.trimEnd().split("\n").at(-1) as string;
  expect(last).toMatch(/\b0 failures\b/);
  expect(run.code).toBe(0);
});

test("26.2 a file path and an oversized ticket are each named with their ticket and place", async () => {
  // The What to build text starts on line 9 of the file.
  const pathTicket = ticket({
    title: "First",
    cites: "root, one",
    blocked: "",
    stories: "1",
    build: "The loop in src/loop.ts reads the log.\nThe Makefile gains no target.",
  });
  expect(pathTicket.split("\n")[8]).toContain("src/loop.ts");
  const padded = ticket({ title: "Second", cites: "#two", blocked: "1", stories: "2", build: "Words. ".repeat(600) });
  expect(padded.length).toBeGreaterThan(4000);
  const { p, dir } = setup([decided("root"), decided("one", "root"), decided("two", "root")], 2, {
    "01-first.md": pathTicket,
    "02-second.md": padded,
  });
  const run = await p.werk(["ticket-check", dir, "--root", "root", "--spec", "spec.md"]);
  const fails = failureLines(run.out);
  const pathLine = fails.find((l) => l.startsWith("01-first.md") && l.includes("no-file-paths"));
  expect(pathLine).toBeDefined();
  expect(pathLine).toContain("src/loop.ts");
  expect(pathLine).toContain("line 9");
  expect(fails.some((l) => l.includes("Makefile"))).toBe(false);
  expect(fails.some((l) => l.startsWith("02-second.md") && l.includes("size"))).toBe(true);
  const last = run.out.trimEnd().split("\n").at(-1) as string;
  expect(last).toMatch(/[1-9]\d* failures?\b/);
  expect(run.code).toBe(1);
});

test("26.3 the set checks report an uncited card, a missing story and a blocker cycle, but not a ghost", async () => {
  const ghost = { type: "node.proposed", payload: { id: "spook", kind: "card", title: "Ghost", parent: "root" } };
  const { p, dir } = setup(
    [decided("root"), decided("one", "root"), decided("two", "root"), ghost, { type: "node.decided", payload: { id: "spook" } }],
    3,
    {
      "01-a.md": ticket({ title: "A", cites: "root, one", blocked: "", stories: "1" }),
      "02-b.md": ticket({ title: "B", cites: "one", blocked: "3", stories: "2" }),
      "03-c.md": ticket({ title: "C", cites: "root", blocked: "2", stories: "1" }),
    },
  );
  const run = await p.werk(["ticket-check", dir, "--root", "root", "--spec", "spec.md"]);
  const fails = failureLines(run.out);
  const cited = fails.filter((l) => l.startsWith("ticket set: cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toContain("two");
  const stories = fails.filter((l) => l.startsWith("ticket set: stories"));
  expect(stories.length).toBe(1);
  expect(stories[0]).toContain("3");
  const cycle = fails.find((l) => l.includes("blocked_by"));
  expect(cycle).toBeDefined();
  expect(cycle).toMatch(/02-b\.md|\b2\b/);
  expect(cycle).toMatch(/03-c\.md|\b3\b/);
  expect(run.out).not.toContain("spook");
  expect(run.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, and its cites do not count for the set", async () => {
  const { p, dir } = setup([decided("root"), decided("one", "root")], 1, {
    "01-untitled.md": ticket({ cites: "root, one", blocked: "", stories: "1" }),
  });
  const run = await p.werk(["ticket-check", dir, "--root", "root", "--spec", "spec.md"]);
  const fails = failureLines(run.out);
  const own = fails.filter((l) => l.startsWith("01-untitled.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain("title");
  expect(fails.some((l) => l.startsWith("ticket set: cards-cited") && l.includes("one"))).toBe(true);
  expect(fails.some((l) => l.startsWith("ticket set: stories") && l.includes("1"))).toBe(true);
  expect(run.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const { p, dir } = setup([decided("root")], 1, {
    "01-a.md": ticket({ title: "A", cites: "root", blocked: "", stories: "1" }),
  });
  const missing = await p.werk(["ticket-check", dir, "--root", "root", "--spec", "nope.md"]);
  expect(missing.out + missing.err).toMatch(/spec/i);
  expect(missing.out + missing.err).toContain("nope.md");
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad.md"), "# Spec\n\n## Stories\n\n1. One.\n");
  expect((await p.werk(["ticket-check", dir, "--root", "root", "--spec", "bad.md"])).code).toBe(2);
  expect((await p.werk(["ticket-check", dir, "--root", "nowhere", "--spec", "spec.md"])).code).toBe(2);
  expect((await p.werk(["ticket-check", dir, "--spec", "spec.md"])).code).toBe(2);
});

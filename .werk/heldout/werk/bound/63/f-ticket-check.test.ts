// Held-out steps 26.1-26.5: `werk ticket-check` on hand-written tickets in a fresh project.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

type Ev = { type: string; payload: Record<string, unknown> };

function seed(p: Project, events: Ev[]): void {
  const lines = events.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e }));
  appendFileSync(join(p.dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
}

const card = (id: string, title: string, parent?: string): Ev => ({
  type: "node.added",
  payload: parent ? { id, kind: "card", title, parent } : { id, kind: "card", title },
});
const decided = (id: string): Ev => ({ type: "node.decided", payload: { id } });

function spec(n: number): string {
  const lines = Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`);
  return `# Spec: test\n\n## User stories\n\n${lines.join("\n")}\n\n## Seams\n\nThe command line.\n`;
}

/** A ticket in the fixed format. Line 9 is the first text line of What to build. */
function ticket(o: {
  title?: string;
  cites: string;
  blocked: string;
  stories: string;
  checks?: string;
  what?: string;
}) {
  const header = [
    o.title === undefined ? "" : `title: ${o.title}`,
    `cites: ${o.cites}`,
    `blocked_by: ${o.blocked}`,
    `stories: ${o.stories}`,
    "touches: map view, decision log",
  ].filter((line) => line !== "");
  return `${header.join("\n")}

## What to build

${o.what ?? "A person opens a decided card and presses reopen."}

## Acceptance criteria

- [ ] A reopened card shows as open in the map.

## Checks

${o.checks ?? ""}
`;
}

function write(p: Project, files: Record<string, string>): void {
  mkdirSync(join(p.dir, "tickets"), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", name), text);
}

const check = (p: Project, root: string, specFile = "spec.md") =>
  p.werk(["ticket-check", "tickets", "--root", root, "--spec", specFile]);

const failureLines = (out: string) =>
  out
    .split("\n")
    .filter((line) => line !== "")
    .slice(0, -1);

test("26.1 a folder of valid hand-written tickets gets a clean pass", async () => {
  const p = freshProject();
  seed(p, [card("root", "Root"), card("a", "A", "root"), card("b", "B", "root"), decided("a"), decided("b")]);
  writeFileSync(join(p.dir, "spec.md"), spec(2));
  write(p, {
    "01-first.md": ticket({
      title: "First slice",
      cites: "root, a",
      blocked: "",
      stories: "1",
      checks: "- `make test`",
    }),
    "02-second.md": ticket({ title: "Second slice", cites: "#b", blocked: "1", stories: "2", checks: "" }),
  });
  const run = await check(p, "root");
  const lines = run.out.split("\n").filter((line) => line !== "");
  expect(lines.length).toBe(1);
  expect(lines.at(-1)).toMatch(/\b0 failures\b/);
  expect(run.code).toBe(0);
});

function validSet(p: Project): void {
  seed(p, [card("root", "Root"), card("a", "A", "root"), card("b", "B", "root"), decided("a"), decided("b")]);
  writeFileSync(join(p.dir, "spec.md"), spec(2));
  write(p, {
    "01-first.md": ticket({ title: "First slice", cites: "a", blocked: "", stories: "1", checks: "- `make test`" }),
    "02-second.md": ticket({ title: "Second slice", cites: "b", blocked: "1", stories: "2", checks: "- `make test`" }),
  });
}

test("26.2 a file path and an oversized ticket are each named with their ticket and place", async () => {
  const p = freshProject();
  validSet(p);
  expect((await check(p, "root")).code).toBe(0);
  write(p, {
    "01-first.md": ticket({
      title: "First slice",
      cites: "a",
      blocked: "",
      stories: "1",
      checks: "- `make test`",
      what: "Change src/loop.ts so the reopen runs, and the Makefile target too.",
    }),
    "02-second.md": ticket({
      title: "Second slice",
      cites: "b",
      blocked: "1",
      stories: "2",
      checks: "- `make test`",
      what: `A person presses reopen. ${"pad ".repeat(1100)}`,
    }),
  });
  const run = await check(p, "root");
  const failures = failureLines(run.out);
  const path = failures.find((line) => line.startsWith("01-first.md") && line.includes("no-file-paths"));
  expect(path).toBeDefined();
  expect(path).toContain("src/loop.ts");
  expect(path).toContain("line 9");
  expect(failures.filter((line) => line.includes("Makefile"))).toEqual([]);
  expect(failures.find((line) => line.startsWith("02-second.md") && line.includes("size"))).toBeDefined();
  expect(run.out.trim().split("\n").at(-1)).toContain(`${failures.length} failures`);
  expect(run.code).toBe(1);
});

test("26.3 set checks report an uncited card, a missing story and a blocker cycle, not a ghost", async () => {
  const p = freshProject();
  seed(p, [
    card("root", "Root"),
    card("one", "One", "root"),
    card("two", "Two", "root"),
    { type: "node.proposed", payload: { id: "ghosty", kind: "card", title: "Ghost", parent: "root" } },
    decided("root"),
    decided("one"),
    decided("two"),
  ]);
  writeFileSync(join(p.dir, "spec.md"), spec(3));
  write(p, {
    "01-a.md": ticket({ title: "Slice a", cites: "root", blocked: "", stories: "1", checks: "- `make test`" }),
    "02-b.md": ticket({ title: "Slice b", cites: "one", blocked: "3", stories: "2", checks: "- `make test`" }),
    "03-c.md": ticket({ title: "Slice c", cites: "one", blocked: "2", stories: "2", checks: "- `make test`" }),
  });
  const run = await check(p, "root");
  const lines = failureLines(run.out);
  const cited = lines.filter((line) => line.startsWith("ticket set") && line.includes("cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toContain("two");
  const stories = lines.filter((line) => line.startsWith("ticket set") && line.includes("stories"));
  expect(stories.length).toBe(1);
  expect(stories[0]).toContain("story 3");
  const cycle = lines.find((line) => line.includes("blocked_by") && line.includes("cycle"));
  expect(cycle).toBeDefined();
  expect(cycle).toContain("02-b.md");
  expect(cycle).toContain("03-c.md");
  expect(run.out).not.toContain("ghosty");
  expect(run.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, and its cites do not count for the set", async () => {
  const p = freshProject();
  seed(p, [card("root", "Root"), card("only", "Only", "root"), decided("only")]);
  writeFileSync(join(p.dir, "spec.md"), spec(1));
  write(p, { "01-notitle.md": ticket({ cites: "only", blocked: "", stories: "1", checks: "- `make test`" }) });
  const run = await check(p, "root");
  const lines = failureLines(run.out);
  const own = lines.filter((line) => line.startsWith("01-notitle.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain(": title:");
  expect(lines.find((line) => line.startsWith("ticket set") && line.includes("only"))).toBeDefined();
  expect(lines.find((line) => line.startsWith("ticket set") && line.includes("story 1"))).toBeDefined();
  expect(run.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const p = freshProject();
  validSet(p);
  const missing = await check(p, "root", "nope.md");
  expect(`${missing.out}${missing.err}`).toMatch(/spec/);
  expect(`${missing.out}${missing.err}`).toContain("nope.md");
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad-spec.md"), "# Spec\n\n1. A line.\n");
  expect((await check(p, "root", "bad-spec.md")).code).toBe(2);
  expect((await check(p, "no-such-root")).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--spec", "spec.md"])).code).toBe(2);
});

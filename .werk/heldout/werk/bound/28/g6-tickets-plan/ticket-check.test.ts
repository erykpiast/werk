import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../../src/test/project.ts";

const specWith = (n: number) =>
  `# Spec: s\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nThe command line.\n`;

const ticket = (o: { title?: string; cites: string; blockedBy: string; stories: string; extra?: string; checks?: string }) =>
  `${o.title === undefined ? "" : `title: ${o.title}\n`}cites: ${o.cites}
blocked_by: ${o.blockedBy}
stories: ${o.stories}
touches: map view, decision log

## What to build

A person opens a decided card and presses reopen.${o.extra ?? ""}

## Acceptance criteria

- [ ] A reopened card shows as open in the map.

## Checks
${o.checks ?? ""}`;

function project(events: { type: string; payload: Record<string, unknown> }[], stories: number): Project {
  const p = freshProject();
  const log = events.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e }));
  appendFileSync(join(p.dir, ".werk", "log.jsonl"), `${log.join("\n")}\n`);
  writeFileSync(join(p.dir, "spec.md"), specWith(stories));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}
const card = (id: string, parent?: string) => ({ type: "node.added", payload: { id, kind: "card", title: id, ...(parent ? { parent } : {}) } });
const decided = (id: string) => ({ type: "node.decided", payload: { id } });
const ghost = (id: string, parent: string) => ({ type: "node.proposed", payload: { id, kind: "card", title: id, parent } });

function tickets(p: Project, files: Record<string, string>) {
  for (const [n, t] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", n), t);
}
const check = (p: Project, ...args: string[]) => p.werk(["ticket-check", "tickets", ...args]);

function base2() {
  const p = project([card("root"), card("root-a", "root"), card("root-b", "root"), decided("root"), decided("root-a"), decided("root-b")], 2);
  const valid = {
    "01-first.md": ticket({ title: "First slice", cites: "root, root-a", blockedBy: "", stories: "1", checks: "\n- `make test`\n" }),
    "02-second.md": ticket({ title: "Second slice", cites: "#root-b", blockedBy: "1", stories: "2" }),
  };
  return { p, valid };
}

test("26.1 valid hand-written tickets pass", async () => {
  const { p, valid } = base2();
  tickets(p, valid);
  const run = await check(p, "--root", "root", "--spec", "spec.md");
  console.log("26.1", JSON.stringify(run));
  const lines = run.out.trimEnd().split("\n");
  expect(lines.length).toBe(1);
  expect(lines.at(-1)).toMatch(/ 0 failures/);
  expect(run.code).toBe(0);
});

test("26.2 a file path and an oversized ticket", async () => {
  const { p, valid } = base2();
  tickets(p, valid);
  expect((await check(p, "--root", "root", "--spec", "spec.md")).code).toBe(0);
  const first = valid["01-first.md"].split("\n");
  expect(first[6]).toBe("## What to build");
  first[8] = "Change src/loop.ts so the reopen runs, then the Makefile target.";
  const second = valid["02-second.md"].replace("presses reopen.", `presses reopen. ${"pad ".repeat(1000)}`);
  expect(second.length).toBeGreaterThan(4000);
  tickets(p, { "01-first.md": first.join("\n"), "02-second.md": second });
  const run = await check(p, "--root", "root", "--spec", "spec.md");
  console.log("26.2", JSON.stringify(run));
  const lines = run.out.trimEnd().split("\n");
  const failures = lines.slice(0, -1);
  expect(failures.some((l) => l.startsWith("01-first.md") && l.includes("no-file-paths") && l.includes("src/loop.ts") && l.includes("line 9"))).toBe(true);
  expect(failures.filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(failures.some((l) => l.startsWith("02-second.md") && l.includes("size"))).toBe(true);
  expect(lines.at(-1)).toContain(`${failures.length} failures`);
  expect(run.code).toBe(1);
});

test("26.3 set checks: uncited card, missing story, cycle, not the ghost", async () => {
  const p = project(
    [card("root"), card("root-a", "root"), card("root-b", "root"), ghost("root-ghost", "root"), decided("root"), decided("root-a"), decided("root-b")],
    3,
  );
  tickets(p, {
    "01-one.md": ticket({ title: "One", cites: "root", blockedBy: "", stories: "1" }),
    "02-two.md": ticket({ title: "Two", cites: "root-a", blockedBy: "3", stories: "2" }),
    "03-three.md": ticket({ title: "Three", cites: "root", blockedBy: "2", stories: "1" }),
  });
  const run = await check(p, "--root", "root", "--spec", "spec.md");
  console.log("26.3", JSON.stringify(run));
  const lines = run.out.trimEnd().split("\n");
  expect(lines.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited") && l.includes("root-b")).length).toBe(1);
  expect(lines.filter((l) => l.startsWith("ticket set") && l.includes("stories") && /story 3/.test(l)).length).toBe(1);
  expect(lines.some((l) => l.includes("blocked_by") && l.includes("cycle") && l.includes("02-two.md") && l.includes("03-three.md"))).toBe(true);
  expect(lines.filter((l) => l.includes("root-ghost"))).toEqual([]);
  expect(run.code).toBe(1);
});

test("26.4 a ticket with no title fails alone", async () => {
  const p = project([card("root"), card("root-a", "root"), decided("root"), decided("root-a")], 1);
  tickets(p, { "01-notitle.md": ticket({ cites: "root, root-a", blockedBy: "", stories: "1" }) });
  const run = await check(p, "--root", "root", "--spec", "spec.md");
  console.log("26.4", JSON.stringify(run));
  const lines = run.out.trimEnd().split("\n").slice(0, -1);
  const own = lines.filter((l) => l.startsWith("01-notitle.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain("title");
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("root-a"))).toBe(true);
  expect(lines.some((l) => l.startsWith("ticket set") && /story 1/.test(l))).toBe(true);
  expect(run.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const { p, valid } = base2();
  tickets(p, valid);
  const a = await check(p, "--root", "root", "--spec", "none.md");
  console.log("26.5a", JSON.stringify(a));
  expect(`${a.out}${a.err}`).toMatch(/spec/);
  expect(`${a.out}${a.err}`).toMatch(/no spec file|missing|not found/);
  expect(a.code).toBe(2);
  writeFileSync(join(p.dir, "bad.md"), "# Spec\n\n1. A line.\n");
  expect((await check(p, "--root", "root", "--spec", "bad.md")).code).toBe(2);
  expect((await check(p, "--root", "nope", "--spec", "spec.md")).code).toBe(2);
  expect((await check(p, "--spec", "spec.md")).code).toBe(2);
});

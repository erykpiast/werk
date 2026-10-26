import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../../src/test/project.ts";

const spec = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nCLI.\n`;

const ticket = (o: { title?: string; cites: string; blocked?: string; stories: string; extra?: string; checks?: string }) =>
  `${o.title === undefined ? "" : `title: ${o.title}\n`}cites: ${o.cites}
blocked_by: ${o.blocked ?? ""}
stories: ${o.stories}
touches: map view

## What to build

A person opens the map and sees a thing.${o.extra ?? ""}

## Acceptance criteria

- [ ] The thing shows.

## Checks

${o.checks ?? ""}
`;

function project(cards: { id: string; ghost?: boolean }[], stories: number): Project {
  const p = freshProject();
  const events: object[] = [{ type: "node.added", payload: { id: "top", kind: "card", title: "Top" } }];
  for (const c of cards)
    events.push({
      type: c.ghost ? "node.proposed" : "node.added",
      payload: { id: c.id, kind: "card", title: c.id, parent: "top" },
    });
  for (const c of cards) events.push({ type: "node.decided", payload: { id: c.id } });
  const log = events.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e }));
  appendFileSync(join(p.dir, ".werk", "log.jsonl"), `${log.join("\n")}\n`);
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}
const put = (p: Project, files: Record<string, string>) => {
  for (const [n, t] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", n), t);
};
const check = (p: Project, ...args: string[]) =>
  p.werk(["ticket-check", "tickets", ...(args.length ? args : ["--root", "top", "--spec", "spec.md"])]);
const failLines = (out: string) => out.split("\n").filter((l) => l !== "").slice(0, -1);

const valid = {
  "01-a.md": ticket({ title: "First", cites: "top, card-a", stories: "1", checks: "- `make test`" }),
  "02-b.md": ticket({ title: "Second", cites: "#card-b", blocked: "1", stories: "2" }),
};

test("26.1", async () => {
  const p = project([{ id: "card-a" }, { id: "card-b" }], 2);
  put(p, valid);
  const r = await check(p);
  console.log(JSON.stringify(r));
  expect(failLines(r.out)).toEqual([]);
  const last = r.out.trim().split("\n").at(-1) ?? "";
  expect(last).toMatch(/\b0 failures\b/);
  expect(r.code).toBe(0);
});

test("26.2", async () => {
  const p = project([{ id: "card-a" }, { id: "card-b" }], 2);
  put(p, valid);
  expect((await check(p)).code).toBe(0);
  const lines = valid["01-a.md"].split("\n");
  // line 9 of the What to build section counted from the file's top is line 9 in the existing test form
  lines[8] = "Edit src/loop.ts so the thing runs, and the Makefile target too.";
  const second = valid["02-b.md"].replace("sees a thing.", `sees a thing. ${"pad ".repeat(1100)}`);
  put(p, { "01-a.md": lines.join("\n"), "02-b.md": second });
  const r = await check(p);
  console.log(JSON.stringify(r));
  const f = failLines(r.out);
  const path = f.find((l) => l.startsWith("01-a.md") && l.includes("no-file-paths"));
  expect(path).toBeDefined();
  expect(path).toContain("src/loop.ts");
  expect(path).toMatch(/line 9\b/);
  expect(f.filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(f.find((l) => l.startsWith("02-b.md") && l.includes("size"))).toBeDefined();
  expect(r.out.trim().split("\n").at(-1)).toMatch(/[1-9]\d* failures/);
  expect(r.code).toBe(1);
});

test("26.3", async () => {
  const p = project([{ id: "card-a" }, { id: "card-b" }, { id: "card-ghost", ghost: true }], 3);
  put(p, {
    "01-a.md": ticket({ title: "First", cites: "card-a", stories: "1" }),
    "02-b.md": ticket({ title: "Second", cites: "card-a", blocked: "3", stories: "2" }),
    "03-c.md": ticket({ title: "Third", cites: "top", blocked: "2", stories: "1" }),
  });
  const r = await check(p);
  console.log(JSON.stringify(r));
  const f = failLines(r.out);
  const cited = f.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited).toHaveLength(1);
  expect(cited[0]).toContain("card-b");
  const st = f.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(st).toHaveLength(1);
  expect(st[0]).toContain("3");
  const cyc = f.find((l) => l.includes("blocked_by") && l.includes("cycle"));
  expect(cyc).toContain("02-b.md");
  expect(cyc).toContain("03-c.md");
  expect(r.out).not.toContain("card-ghost");
  expect(r.code).toBe(1);
});

test("26.4", async () => {
  const p = project([{ id: "card-a" }], 1);
  put(p, { "01-a.md": ticket({ cites: "top, card-a", stories: "1" }) });
  const r = await check(p);
  console.log(JSON.stringify(r));
  const f = failLines(r.out);
  const own = f.filter((l) => l.startsWith("01-a.md"));
  expect(own).toHaveLength(1);
  expect(own[0]).toContain("title");
  expect(f.some((l) => l.startsWith("ticket set") && l.includes("card-a"))).toBe(true);
  expect(f.some((l) => l.startsWith("ticket set") && l.includes("stories") && l.includes("1"))).toBe(true);
  expect(r.code).toBe(1);
});

test("26.5", async () => {
  const p = project([{ id: "card-a" }, { id: "card-b" }], 2);
  put(p, valid);
  const a = await check(p, "--root", "top", "--spec", "missing.md");
  console.log(JSON.stringify(a));
  expect(`${a.out}${a.err}`).toMatch(/spec/i);
  expect(`${a.out}${a.err}`).toMatch(/no spec|missing|not exist|not found/i);
  expect(a.code).toBe(2);
  writeFileSync(join(p.dir, "nostories.md"), "# Spec\n\n## Goals\n\n1. A line.\n");
  expect((await check(p, "--root", "top", "--spec", "nostories.md")).code).toBe(2);
  expect((await check(p, "--root", "nope", "--spec", "spec.md")).code).toBe(2);
  expect((await check(p, "--spec", "spec.md")).code).toBe(2);
});

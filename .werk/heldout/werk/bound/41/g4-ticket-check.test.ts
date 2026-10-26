import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const spec = (n: number) =>
  `# Spec: s\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nThe command line.\n`;

const ticket = (o: { title?: string | null; cites: string; blocked?: string; stories: string; checks?: string; extra?: string }) =>
  `${o.title === null ? "" : `title: ${o.title ?? "A slice"}\n`}cites: ${o.cites}
blocked_by: ${o.blocked ?? ""}
stories: ${o.stories}
touches: map view

## What to build

A person opens a decided card and presses reopen.${o.extra ?? ""}

## Acceptance criteria

- [ ] A reopened card shows as open.

## Checks

${o.checks ?? ""}
`;

function proj(opts: { cards: string[]; ghost?: boolean; stories: number }): Project {
  const p = freshProject();
  const ev: object[] = [{ type: "node.added", payload: { id: "root", kind: "card", title: "Root" } }];
  for (const c of opts.cards) ev.push({ type: "node.added", payload: { id: c, kind: "card", title: c, parent: "root" } });
  if (opts.ghost) ev.push({ type: "node.proposed", payload: { id: "ghosty", kind: "card", title: "Ghost", parent: "root" } });
  ev.push({ type: "node.decided", payload: { id: "root" } });
  for (const c of opts.cards) ev.push({ type: "node.decided", payload: { id: c } });
  appendFileSync(
    join(p.dir, ".werk", "log.jsonl"),
    `${ev.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e })).join("\n")}\n`,
  );
  writeFileSync(join(p.dir, "spec.md"), spec(opts.stories));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}
const put = (p: Project, files: Record<string, string>) => {
  for (const [n, t] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", n), t);
};
const check = (p: Project) => p.werk(["ticket-check", "tickets", "--root", "root", "--spec", "spec.md"]);
const valid = () => ({
  "01-a.md": ticket({ title: "First", cites: "root, card-a", stories: "1", checks: "- `make test`" }),
  "02-b.md": ticket({ title: "Second", cites: "#card-b", blocked: "1", stories: "2" }),
});

test("26.1 valid folder passes", async () => {
  const p = proj({ cards: ["card-a", "card-b"], stories: 2 });
  put(p, valid());
  const r = await check(p);
  console.log(r);
  expect(r.code).toBe(0);
  expect(r.out).not.toMatch(/: (no-file-paths|size|title|shape|cards-cited|stories|blocked_by)/);
  expect(r.out.trimEnd().split("\n").at(-1)).toMatch(/\b0 failures\b/);
  expect(r.out.trimEnd().split("\n")).toHaveLength(1);
});

test("26.2 file path and oversized ticket", async () => {
  const p = proj({ cards: ["card-a", "card-b"], stories: 2 });
  put(p, valid());
  expect((await check(p)).code).toBe(0);
  const first = ticket({ title: "First", cites: "root, card-a", stories: "1", checks: "- `make test`", extra: " Edit src/loop.ts and the Makefile." });
  const second = ticket({ title: "Second", cites: "#card-b", blocked: "1", stories: "2", extra: ` ${"pad ".repeat(1100)}` });
  expect(first.split("\n")[8]).toContain("src/loop.ts");
  put(p, { "01-a.md": first, "02-b.md": second });
  const r = await check(p);
  console.log(r.out);
  const lines = r.out.trimEnd().split("\n");
  expect(lines.some((l) => l.startsWith("01-a.md") && l.includes("no-file-paths") && l.includes("src/loop.ts") && l.includes("line 9"))).toBe(true);
  expect(lines.slice(0, -1).filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(lines.some((l) => l.startsWith("02-b.md") && l.includes("size"))).toBe(true);
  expect(lines.at(-1)).toMatch(/[1-9]\d* failures/);
  expect(r.code).toBe(1);
});

test("26.3 set checks", async () => {
  const p = proj({ cards: ["card-a", "card-b"], ghost: true, stories: 3 });
  put(p, {
    "01-a.md": ticket({ title: "One", cites: "root, card-a", stories: "1", checks: "- `make test`" }),
    "02-b.md": ticket({ title: "Two", cites: "root", blocked: "3", stories: "2" }),
    "03-c.md": ticket({ title: "Three", cites: "card-a", blocked: "2", stories: "1,2" }),
  });
  const r = await check(p);
  console.log(r.out);
  const lines = r.out.split("\n");
  expect(lines.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited") && l.includes("card-b"))).toHaveLength(1);
  expect(lines.filter((l) => l.startsWith("ticket set") && l.includes("stories") && l.includes("3"))).toHaveLength(1);
  expect(lines.some((l) => l.includes("blocked_by") && l.includes("02-b.md") && l.includes("03-c.md"))).toBe(true);
  expect(r.out).not.toContain("ghosty");
  expect(r.code).toBe(1);
});

test("26.4 no title fails alone", async () => {
  const p = proj({ cards: ["card-a"], stories: 1 });
  put(p, { "01-a.md": ticket({ title: null, cites: "card-a", stories: "1", checks: "- `make test`" }) });
  const r = await check(p);
  console.log(r.out);
  const lines = r.out.trimEnd().split("\n");
  const own = lines.filter((l) => l.startsWith("01-a.md"));
  expect(own).toHaveLength(1);
  expect(own[0]).toContain("title");
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("card-a"))).toBe(true);
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("stories") && l.includes("1"))).toBe(true);
  expect(r.code).toBe(1);
});

test("26.5 malformed calls", async () => {
  const p = proj({ cards: ["card-a", "card-b"], stories: 2 });
  put(p, valid());
  let r = await p.werk(["ticket-check", "tickets", "--root", "root", "--spec", "missing.md"]);
  expect(r.code).toBe(2);
  expect(r.err + r.out).toMatch(/spec file/i);
  writeFileSync(join(p.dir, "nostories.md"), "# Spec\n\n1. A line.\n");
  r = await p.werk(["ticket-check", "tickets", "--root", "root", "--spec", "nostories.md"]);
  expect(r.code).toBe(2);
  r = await p.werk(["ticket-check", "tickets", "--root", "nope", "--spec", "spec.md"]);
  expect(r.code).toBe(2);
  r = await p.werk(["ticket-check", "tickets", "--spec", "spec.md"]);
  expect(r.code).toBe(2);
});

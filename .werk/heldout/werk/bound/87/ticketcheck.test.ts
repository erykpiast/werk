import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, freshProject, type Project, seed } from "./lib.ts";

const spec = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want story ${i + 1}.`).join("\n")}\n\n## Seams\n\nThe CLI.\n`;

const ticket = (o: { title?: string; cites: string; blocked?: string; stories: string; checks?: string; extra?: string }) =>
  `${o.title === undefined ? "" : `title: ${o.title}\n`}cites: ${o.cites}
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

function proj(opts: { ghost?: boolean; stories?: number } = {}): Project {
  const p = freshProject();
  card(p, "top", { title: "Top", parent: undefined });
  card(p, "c1", { title: "Card one", parent: "top" });
  card(p, "c2", { title: "Card two", parent: "top" });
  if (opts.ghost) seed(p, "node.proposed", { id: "gh", kind: "card", title: "Ghost", parent: "top", status: "decided" }, "agent");
  writeFileSync(join(p.dir, "spec.md"), spec(opts.stories ?? 2));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}
const put = (p: Project, files: Record<string, string>) => {
  for (const [n, t] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", n), t);
};
const run = (p: Project, ...extra: string[]) => p.werk(["ticket-check", "tickets", "--root", "top", "--spec", "spec.md", ...extra]);
const good = () => ({
  "01-a.md": ticket({ title: "First", cites: "top, c1", stories: "1", checks: "- `make test`" }),
  "02-b.md": ticket({ title: "Second", cites: "#c2", blocked: "1", stories: "2" }),
});

test("26.1 valid tickets: clean pass", async () => {
  const p = proj();
  put(p, good());
  const r = await run(p);
  expect(r.code).toBe(0);
  const ls = r.out.split("\n").filter(Boolean);
  expect(ls.length).toBe(1);
  expect(ls[0]).toMatch(/0 failures/);
});

test("26.2 file path and oversize ticket", async () => {
  const p = proj();
  const g = good();
  const first = g["01-a.md"].split("\n");
  first[8] = "Edit src/loop.ts and the Makefile target.";
  put(p, { ...g, "01-a.md": first.join("\n"), "02-b.md": g["02-b.md"].replace("presses reopen.", `presses reopen. ${"pad ".repeat(1100)}`) });
  const r = await run(p);
  expect(r.code).toBe(1);
  const ls = r.out.split("\n");
  expect(ls.some((l) => l.startsWith("01-a.md") && l.includes("no-file-paths") && l.includes("src/loop.ts") && l.includes("line 9"))).toBe(true);
  expect(ls.filter((l) => l.includes("failure") === false && l.includes("Makefile"))).toEqual([]);
  expect(ls.some((l) => l.startsWith("02-b.md") && l.includes("size"))).toBe(true);
  expect(ls.at(-2)).toMatch(/failures/);
});

test("26.3 set checks: uncited card, missing story, cycle, ghost not named", async () => {
  const p = proj({ ghost: true, stories: 3 });
  put(p, {
    "01-a.md": ticket({ title: "One", cites: "top, c1", stories: "1" }),
    "02-b.md": ticket({ title: "Two", cites: "top", blocked: "3", stories: "2" }),
    "03-c.md": ticket({ title: "Three", cites: "top", blocked: "2", stories: "2" }),
  });
  const r = await run(p);
  expect(r.code).toBe(1);
  const ls = r.out.split("\n");
  expect(ls.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited") && l.includes("c2")).length).toBe(1);
  expect(ls.filter((l) => l.startsWith("ticket set") && l.includes("stories") && l.includes("3")).length).toBe(1);
  expect(ls.some((l) => l.includes("blocked_by") && /02/.test(l) && /03/.test(l))).toBe(true);
  expect(r.out).not.toContain("gh");
  expect(r.out).not.toContain("Ghost");
});

test("26.4 ticket with no title fails alone; its cites do not count", async () => {
  const p = proj({ stories: 1 });
  card(p, "dummy", { title: "x", parent: "top" });
  // one decided card under root only: remove c2 from consideration by using a fresh project
  const q = freshProject();
  card(q, "top", { title: "Top", parent: undefined });
  card(q, "c1", { title: "Card one", parent: "top" });
  writeFileSync(join(q.dir, "spec.md"), spec(1));
  mkdirSync(join(q.dir, "tickets"));
  put(q, { "01-a.md": ticket({ cites: "c1", stories: "1" }) });
  const r = await run(q);
  expect(r.code).toBe(1);
  const ls = r.out.split("\n");
  expect(ls.some((l) => l.startsWith("01-a.md") && l.includes("title"))).toBe(true);
  const own = ls.filter((l) => l.startsWith("01-a.md"));
  expect(own.length).toBe(1);
  expect(ls.some((l) => l.startsWith("ticket set") && l.includes("c1"))).toBe(true);
  expect(ls.some((l) => l.startsWith("ticket set") && l.includes("stor"))).toBe(true);
  void p;
});

test("26.5 malformed calls exit 2", async () => {
  const p = proj();
  put(p, good());
  const a = await p.werk(["ticket-check", "tickets", "--root", "top", "--spec", "nope.md"]);
  expect(a.code).toBe(2);
  expect(a.out + a.err).toMatch(/spec/i);
  expect(a.out + a.err).toMatch(/no spec file|missing|not exist|no such/i);
  writeFileSync(join(p.dir, "nostories.md"), "# Spec\n\nNothing here.\n");
  expect((await p.werk(["ticket-check", "tickets", "--root", "top", "--spec", "nostories.md"])).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--root", "nope", "--spec", "spec.md"])).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--spec", "spec.md"])).code).toBe(2);
});

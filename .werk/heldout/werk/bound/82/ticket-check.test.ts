import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { all, card, freshProject, root, seed, w } from "./helpers.ts";

const spec = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want story ${i + 1}.`).join("\n")}\n\n## Seams\n\nNone.\n`;

const ticket = (o: { title?: string | null; cites: string; blocked?: string; stories: string; checks?: string; extra?: string }) =>
  `${o.title === null ? "" : `title: ${o.title ?? "A ticket"}\n`}cites: ${o.cites}
blocked_by: ${o.blocked ?? ""}
stories: ${o.stories}
touches: map view

## What to build

A person opens a card and presses a button.${o.extra ?? ""}

## Acceptance criteria

- [ ] The card changes.

## Checks

${o.checks ?? ""}
`;

type P = ReturnType<typeof freshProject>;
function setup(nStories = 2, ghost = false) {
  const p = freshProject();
  root(p);
  card(p, "top", { title: "Top", status: "decided", who: "me" });
  card(p, "one", { title: "One", parent: "top", status: "decided", who: "me" });
  card(p, "two", { title: "Two", parent: "top", status: "decided", who: "me" });
  if (ghost) seed(p, "node.proposed", { id: "ghost", kind: "card", title: "Ghost", parent: "top", status: "decided" });
  writeFileSync(join(p.dir, "spec.md"), spec(nStories));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}
const put = (p: P, files: Record<string, string>) => {
  for (const [n, t] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", n), t);
};
const check = (p: P, ...x: string[]) => p.werk(["ticket-check", "tickets", "--root", "top", "--spec", "spec.md", ...x]);
const good = () => ({
  "01-a.md": ticket({ cites: "top, one", stories: "1", checks: "- `make test`" }),
  "02-b.md": ticket({ cites: "#two", stories: "2", blocked: "1" }),
});

test("[26.1] a folder of valid tickets gets a clean pass", async () => {
  const p = setup();
  put(p, good());
  const r = await check(p);
  expect(r.code, all(r)).toBe(0);
  const ls = r.out.split("\n").filter(Boolean);
  expect(ls.length).toBe(1);
  expect(ls[0]).toMatch(/\b0 failures\b/);
});

test("[26.2] an agent finds a file path and an oversized ticket", async () => {
  const p = setup();
  const g = good();
  const lines = g["01-a.md"].split("\n");
  lines[8] = "Edit src/loop.ts and the Makefile.";
  put(p, { ...g, "01-a.md": lines.join("\n"), "02-b.md": g["02-b.md"].replace("button.", `button. ${"pad ".repeat(1100)}`) });
  const r = await check(p);
  expect(r.code).toBe(1);
  const ls = r.out.split("\n");
  const fp = ls.find((l) => l.startsWith("01-a.md:") && l.includes("no-file-paths"));
  expect(fp).toBeDefined();
  expect(fp).toContain("src/loop.ts");
  expect(fp).toContain("line 9");
  expect(ls.some((l) => l.includes("Makefile"))).toBe(false);
  expect(ls.some((l) => l.startsWith("02-b.md:") && l.includes("size"))).toBe(true);
  expect(ls.at(-2)).toMatch(/failures/);
});

test("[26.3] set checks report an uncited card, a missing story and a blocker cycle, not a ghost", async () => {
  const p = setup(3, true);
  put(p, {
    "01-a.md": ticket({ cites: "top, one", stories: "1" }),
    "02-b.md": ticket({ cites: "one", stories: "1", blocked: "3" }),
    "03-c.md": ticket({ cites: "one", stories: "2", blocked: "2" }),
  });
  p; // story 2 delivered by 03; story 3 by none
  const r = await check(p);
  expect(r.code).toBe(1);
  const set = r.out.split("\n").filter((l) => l.startsWith("ticket set"));
  expect(set.filter((l) => l.includes("cards-cited")).length).toBe(1);
  expect(set.find((l) => l.includes("cards-cited"))).toContain("two");
  expect(set.filter((l) => l.includes("stories")).length).toBeGreaterThanOrEqual(1);
  expect(set.find((l) => l.includes("stories"))).toContain("story 3");
  const cyc = r.out.split("\n").find((l) => l.includes("blocked_by") && l.includes("cycle"));
  expect(cyc).toBeDefined();
  expect(cyc).toContain("02-b.md");
  expect(cyc).toContain("03-c.md");
  expect(r.out).not.toContain("ghost");
});

test("[26.4] a ticket with no title fails alone, and its cites do not count for the set", async () => {
  const p = freshProject();
  root(p);
  card(p, "top", { title: "Top", status: "decided", who: "me" });
  card(p, "one", { title: "One", parent: "top", status: "decided", who: "me" });
  writeFileSync(join(p.dir, "spec.md"), spec(1));
  mkdirSync(join(p.dir, "tickets"));
  put(p, { "01-a.md": ticket({ title: null, cites: "top, one", stories: "1" }) });
  const r = await check(p);
  expect(r.code).toBe(1);
  const ls = r.out.split("\n").filter(Boolean);
  const own = ls.filter((l) => l.startsWith("01-a.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain("title");
  expect(ls.some((l) => l.startsWith("ticket set") && l.includes("one") && /cite/i.test(l))).toBe(true);
  expect(ls.some((l) => l.startsWith("ticket set") && /story 1/.test(l))).toBe(true);
});

test("[26.5] a malformed call never reads as a pass", async () => {
  const p = setup();
  put(p, good());
  const a = await p.werk(["ticket-check", "tickets", "--root", "top", "--spec", "missing.md"]);
  expect(a.code).toBe(2);
  expect(all(a)).toMatch(/spec file/);
  writeFileSync(join(p.dir, "nostories.md"), "# Spec\n\nNothing.\n");
  expect((await p.werk(["ticket-check", "tickets", "--root", "top", "--spec", "nostories.md"])).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--root", "nope", "--spec", "spec.md"])).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--spec", "spec.md"])).code).toBe(2);
});

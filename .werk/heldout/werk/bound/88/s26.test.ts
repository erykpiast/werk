import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, decide, files, ghost, mapProject, SPEC, ticket } from "./h2628.ts";

const base = () =>
  mapProject([card("root"), card("a", "root"), card("b", "root"), decide("root"), decide("a"), decide("b")]);
const check = (p: ReturnType<typeof base>, ...x: string[]) =>
  p.werk(["ticket-check", "tickets", "--root", "root", "--spec", "spec.md", ...x]);

function valid(p: ReturnType<typeof base>) {
  writeFileSync(join(p.dir, "spec.md"), SPEC(2));
  files(p, "tickets", {
    "01-first.md": ticket("First", "root, a", "", "1"),
    "02-second.md": ticket("Second", "#b", "1", "2", ""),
  });
}

test("26.1 valid folder passes", async () => {
  const p = base();
  valid(p);
  const run = await check(p);
  const lines = run.out.split("\n").filter((l) => l !== "");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/ 0 failures/);
  expect(run.out).not.toMatch(/: (shape|size|title|no-file-paths|cards-cited|stories|blocked_by):/);
  expect(run.code).toBe(0);
});

test("26.2 path and oversized", async () => {
  const p = base();
  valid(p);
  expect((await check(p)).code).toBe(0);
  const t1 = ticket("First", "root, a", "", "1").split("\n");
  t1[8] = "Edit src/loop.ts and the Makefile.";
  const t2 = ticket("Second", "#b", "1", "2", "").replace("A person logs in.", `A person logs in. ${"pad ".repeat(1100)}`);
  files(p, "tickets", { "01-first.md": t1.join("\n"), "02-second.md": t2 });
  const run = await check(p);
  const ls = run.out.split("\n");
  expect(ls.some((l) => l.startsWith("01-first.md") && l.includes("no-file-paths") && l.includes("src/loop.ts") && l.includes("line 9"))).toBe(true);
  expect(ls.filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(ls.some((l) => l.startsWith("02-second.md") && l.includes("size"))).toBe(true);
  expect(ls.filter((l) => l !== "").at(-1)).toMatch(/[12] (own-check )?failures?|failures/);
  expect(ls.filter((l) => l !== "").at(-1)).not.toMatch(/ 0 failures/);
  expect(run.code).toBe(1);
});

test("26.3 set checks", async () => {
  const p = mapProject([
    card("root"), card("a", "root"), card("b", "root"), ghost("g", "root"),
    decide("root"), decide("a"), decide("b"),
  ]);
  writeFileSync(join(p.dir, "spec.md"), SPEC(3));
  files(p, "tickets", {
    "01-one.md": ticket("One", "root, a", "", "1"),
    "02-two.md": ticket("Two", "root, a", "3", "2"),
    "03-three.md": ticket("Three", "root, a", "2", "1"),
  });
  const run = await check(p);
  const ls = run.out.split("\n");
  expect(ls.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited") && l.includes("b"))).toHaveLength(1);
  expect(ls.filter((l) => l.startsWith("ticket set") && l.includes("stories") && l.includes("story 3"))).toHaveLength(1);
  expect(ls.some((l) => l.includes("blocked_by") && l.includes("02-two.md") && l.includes("03-three.md"))).toBe(true);
  expect(run.out).not.toMatch(/\bg\b/);
  expect(run.code).toBe(1);
});

test("26.4 no title", async () => {
  const p = mapProject([card("root"), card("a", "root"), decide("root"), decide("a")]);
  writeFileSync(join(p.dir, "spec.md"), SPEC(1));
  files(p, "tickets", { "01-x.md": ticket(null, "a", "", "1") });
  const run = await check(p);
  const ls = run.out.split("\n");
  const own = ls.filter((l) => l.startsWith("01-x.md"));
  expect(own.length).toBeGreaterThan(0);
  expect(own.every((l) => l.includes("title"))).toBe(true);
  expect(own.some((l) => l.includes("title"))).toBe(true);
  expect(ls.some((l) => l.startsWith("ticket set") && l.includes("#a") && l.includes("no ticket cites"))).toBe(true);
  expect(ls.some((l) => l.startsWith("ticket set") && l.includes("story 1"))).toBe(true);
  expect(run.code).toBe(1);
});

test("26.5 malformed", async () => {
  const p = base();
  valid(p);
  const r1 = await p.werk(["ticket-check", "tickets", "--root", "root", "--spec", "none.md"]);
  expect(r1.err + r1.out).toMatch(/no spec file/);
  expect(r1.code).toBe(2);
  writeFileSync(join(p.dir, "nostories.md"), "# Spec\n\n1. A line.\n");
  expect((await p.werk(["ticket-check", "tickets", "--root", "root", "--spec", "nostories.md"])).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--root", "nope", "--spec", "spec.md"])).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--spec", "spec.md"])).code).toBe(2);
});

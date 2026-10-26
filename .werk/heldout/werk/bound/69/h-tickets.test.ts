// Held-out steps 26.1–26.5: `werk ticket-check` on a folder of hand-written tickets.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const spec = (n: number) =>
  `# Spec: billing\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nThe command line.\n`;

type T = { title?: string; cites: string; blockedBy?: string; stories: string; build?: string; checks?: string };
const ticket = (t: T) =>
  `${t.title === undefined ? "" : `title: ${t.title}\n`}cites: ${t.cites}
blocked_by: ${t.blockedBy ?? ""}
stories: ${t.stories}
touches: map view

## What to build

${t.build ?? "A person sees the invoice."}

## Acceptance criteria

- [ ] The invoice shows.

## Checks

${t.checks ?? ""}`;

type Card = { id: string; parent?: string; ghost?: boolean };
function setup(cards: Card[], stories: number): Project {
  const p = freshProject();
  const events: object[] = [];
  for (const c of cards)
    events.push({
      type: c.ghost ? "node.proposed" : "node.added",
      payload: { id: c.id, kind: "card", title: `Card ${c.id}`, ...(c.parent ? { parent: c.parent } : {}) },
    });
  for (const c of cards) events.push({ type: "node.decided", payload: { id: c.id } });
  const lines = events.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e }));
  appendFileSync(join(p.dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}
const put = (p: Project, files: Record<string, string>) => {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", name), text);
};
const check = (p: Project, ...args: string[]) => p.werk(["ticket-check", "tickets", ...args]);
const failureLines = (out: string) =>
  out
    .split("\n")
    .filter((l) => l !== "")
    .slice(0, -1);
const countLine = (out: string) =>
  out
    .split("\n")
    .filter((l) => l !== "")
    .at(-1) ?? "";

const BASE: Card[] = [{ id: "bill" }, { id: "bill-a", parent: "bill" }, { id: "bill-b", parent: "bill" }];
const VALID = {
  "01-invoice.md": ticket({ title: "Invoice shows", cites: "bill, bill-a", stories: "1", checks: "- `make test`" }),
  "02-seats.md": ticket({ title: "Seats show", cites: "#bill-b", blockedBy: "1", stories: "2" }),
};

test("26.1 a folder of valid hand-written tickets gets a clean pass", async () => {
  const p = setup(BASE, 2);
  put(p, VALID);
  const run = await check(p, "--root", "bill", "--spec", "spec.md");
  expect(failureLines(run.out)).toEqual([]);
  expect(countLine(run.out)).toMatch(/\b0 failures\b/);
  expect(run.code).toBe(0);
});

test("26.2 a file path and an oversized ticket are each named with their ticket and place", async () => {
  const p = setup(BASE, 2);
  put(p, VALID);
  expect((await check(p, "--root", "bill", "--spec", "spec.md")).code).toBe(0);
  const lines = VALID["01-invoice.md"].split("\n");
  // Line 9 of the file is the first line of the What to build section.
  lines[8] = "Change src/loop.ts so the invoice shows.";
  lines.splice(9, 0, "Also run the Makefile target.");
  const second = VALID["02-seats.md"].replace("sees the invoice.", `sees the invoice. ${"pad ".repeat(1100)}`);
  expect(second.length).toBeGreaterThan(4000);
  put(p, { "01-invoice.md": lines.join("\n"), "02-seats.md": second });
  const run = await check(p, "--root", "bill", "--spec", "spec.md");
  const fails = failureLines(run.out);
  const path = fails.find((l) => l.startsWith("01-invoice.md") && l.includes("no-file-paths"));
  expect(path).toBeDefined();
  expect(path).toContain("src/loop.ts");
  expect(path).toMatch(/line 9\b/);
  expect(fails.filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(fails.find((l) => l.startsWith("02-seats.md") && l.includes("size"))).toBeDefined();
  expect(countLine(run.out)).toContain(`${fails.length} failure`);
  expect(run.code).toBe(1);
});

test("26.3 set checks report an uncited card, a missing story and a blocker cycle, not a ghost", async () => {
  const p = setup([...BASE, { id: "bill-ghost", parent: "bill", ghost: true }], 3);
  put(p, {
    "01-invoice.md": ticket({ title: "Invoice shows", cites: "bill", stories: "1" }),
    "02-seats.md": ticket({ title: "Seats show", cites: "bill-a", blockedBy: "3", stories: "2" }),
    "03-tax.md": ticket({ title: "Tax shows", cites: "bill-a", blockedBy: "2", stories: "1" }),
  });
  const run = await check(p, "--root", "bill", "--spec", "spec.md");
  const fails = failureLines(run.out);
  const cited = fails.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited).toHaveLength(1);
  expect(cited[0]).toContain("bill-b");
  const stories = fails.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories).toHaveLength(1);
  expect(stories[0]).toContain("3");
  const cycle = fails.find((l) => l.includes("blocked_by") && l.includes("cycle"));
  expect(cycle).toContain("02-seats.md");
  expect(cycle).toContain("03-tax.md");
  expect(run.out).not.toContain("bill-ghost");
  expect(run.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, and its cites do not count for the set", async () => {
  const p = setup([{ id: "bill" }, { id: "bill-a", parent: "bill" }], 1);
  put(p, { "01-untitled.md": ticket({ cites: "bill, bill-a", stories: "1" }) });
  const run = await check(p, "--root", "bill", "--spec", "spec.md");
  const fails = failureLines(run.out);
  const own = fails.filter((l) => l.startsWith("01-untitled.md"));
  expect(own).toHaveLength(1);
  expect(own[0]).toContain("title");
  const set = fails.filter((l) => l.startsWith("ticket set"));
  expect(set.some((l) => l.includes("cards-cited") && l.includes("bill-a"))).toBe(true);
  expect(set.some((l) => l.includes("stories") && l.includes("1"))).toBe(true);
  expect(run.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const p = setup(BASE, 2);
  put(p, VALID);
  const missing = await check(p, "--root", "bill", "--spec", "nope.md");
  expect(`${missing.out}${missing.err}`).toMatch(/spec/i);
  expect(`${missing.out}${missing.err}`).toContain("nope.md");
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad.md"), "# Spec\n\n1. A line.\n");
  expect((await check(p, "--root", "bill", "--spec", "bad.md")).code).toBe(2);
  expect((await check(p, "--root", "nowhere", "--spec", "spec.md")).code).toBe(2);
  expect((await check(p, "--spec", "spec.md")).code).toBe(2);
  expect(readFileSync(join(p.dir, "spec.md"), "utf8")).toContain("User stories");
});

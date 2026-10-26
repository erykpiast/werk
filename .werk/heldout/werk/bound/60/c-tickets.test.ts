// Held-out steps 26.1-26.5: werk ticket-check.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const spec = (n: number) =>
  `# Spec: billing\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nThe command line.\n`;

const ticket = (o: {
  title?: string;
  cites: string;
  blocked?: string;
  stories: string;
  build?: string;
  checks?: string;
}) =>
  `${o.title === undefined ? "" : `title: ${o.title}\n`}cites: ${o.cites}
blocked_by: ${o.blocked ?? ""}
stories: ${o.stories}
touches: invoices, billing page

## What to build

${o.build ?? "A person sees the invoice total on the billing page."}

## Acceptance criteria

- [ ] The total shows.

## Checks

${o.checks ?? ""}`;

function project(cards: { id: string; parent?: string; ghost?: boolean }[], stories: number): Project {
  const p = freshProject();
  const events = cards.map((c, i) => ({
    seq: i + 1,
    at: "t",
    actor: "you",
    type: c.ghost ? "node.proposed" : "node.added",
    payload: { id: c.id, kind: "card", title: `Card ${c.id}`, parent: c.parent, status: "decided" },
  }));
  appendFileSync(join(p.dir, ".werk", "log.jsonl"), `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}
const put = (p: Project, files: Record<string, string>) => {
  for (const [n, t] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", n), t);
};
const check = (p: Project, root = "bill", specFile = "spec.md") =>
  p.werk(["ticket-check", "tickets", "--root", root, "--spec", specFile]);

const twoCards = [{ id: "bill" }, { id: "bill-a", parent: "bill" }, { id: "bill-b", parent: "bill" }];
const valid = () => ({
  "01-total.md": ticket({ title: "The total shows", cites: "bill, bill-a", stories: "1", checks: "- `make test`\n" }),
  "02-tax.md": ticket({ title: "Tax shows", cites: "#bill-b", blocked: "1", stories: "2" }),
});

test("26.1 valid hand-written tickets give a clean pass", async () => {
  const p = project(twoCards, 2);
  put(p, valid());
  const r = await check(p);
  console.log("26.1", JSON.stringify(r));
  const lines = r.out.trimEnd().split("\n");
  expect(lines).toHaveLength(1);
  expect(lines.at(-1)).toMatch(/\b0 failures\b/);
  expect(r.code).toBe(0);
});

test("26.2 a file path and an oversized ticket are each named with ticket and place", async () => {
  const p = project(twoCards, 2);
  put(p, valid());
  expect((await check(p)).code).toBe(0);
  const v = valid();
  const first = ticket({
    title: "The total shows",
    cites: "bill, bill-a",
    stories: "1",
    checks: "- `make test`\n",
    build: "Change src/loop.ts and the Makefile so the total shows.",
  });
  expect(first.split("\n")[8]).toContain("src/loop.ts");
  const second = v["02-tax.md"].replace("billing page.", `billing page. ${"pad ".repeat(1100)}`);
  expect(second.length).toBeGreaterThan(4000);
  put(p, { "01-total.md": first, "02-tax.md": second });
  const r = await check(p);
  console.log("26.2", r.out);
  const lines = r.out.trimEnd().split("\n");
  const fails = lines.slice(0, -1);
  expect(
    fails.some(
      (l) =>
        l.startsWith("01-total.md") && l.includes("no-file-paths") && l.includes("src/loop.ts") && l.includes("line 9"),
    ),
  ).toBe(true);
  expect(fails.filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(fails.some((l) => l.startsWith("02-tax.md") && l.includes("size"))).toBe(true);
  expect(lines.at(-1)).toContain(`${fails.length} failure`);
  expect(r.code).toBe(1);
});

test("26.3 set checks report an uncited card, a missing story and a cycle, not a ghost", async () => {
  const p = project([...twoCards, { id: "bill-ghost", parent: "bill", ghost: true }], 3);
  put(p, {
    "01-a.md": ticket({ title: "One", cites: "bill, bill-a", stories: "1" }),
    "02-b.md": ticket({ title: "Two", cites: "bill-a", blocked: "3", stories: "2" }),
    "03-c.md": ticket({ title: "Three", cites: "bill", blocked: "2", stories: "1" }),
  });
  const r = await check(p);
  console.log("26.3", r.out);
  const lines = r.out.trimEnd().split("\n");
  const cited = lines.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited).toHaveLength(1);
  expect(cited[0]).toContain("bill-b");
  const stories = lines.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories).toHaveLength(1);
  expect(stories[0]).toContain("3");
  const cycle = lines.find((l) => l.includes("blocked_by") && l.includes("cycle"));
  expect(cycle).toContain("02-b.md");
  expect(cycle).toContain("03-c.md");
  expect(r.out).not.toContain("bill-ghost");
  expect(r.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, and its cites do not count", async () => {
  const p = project([{ id: "bill" }, { id: "bill-a", parent: "bill" }], 1);
  put(p, { "01-a.md": ticket({ cites: "bill, bill-a", stories: "1" }) });
  const r = await check(p);
  console.log("26.4", r.out);
  const lines = r.out.trimEnd().split("\n");
  const own = lines.filter((l) => l.startsWith("01-a.md"));
  expect(own).toHaveLength(1);
  expect(own[0]).toContain("title");
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("bill-a"))).toBe(true);
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("story 1"))).toBe(true);
  expect(r.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const p = project(twoCards, 2);
  put(p, valid());
  const missing = await check(p, "bill", "none.md");
  console.log("26.5", JSON.stringify(missing));
  expect(`${missing.out}${missing.err}`).toMatch(/spec/i);
  expect(`${missing.out}${missing.err}`).toContain("none.md");
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad.md"), "# Spec\n\n1. A thing.\n");
  expect((await check(p, "bill", "bad.md")).code).toBe(2);
  expect((await check(p, "nope")).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--spec", "spec.md"])).code).toBe(2);
});

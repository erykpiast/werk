// Held-out steps 26.x: werk ticket-check on a folder of hand-written tickets.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

type Ev = { type: string; payload: Record<string, unknown> };
function map(p: Project, events: Ev[]): void {
  const log = events.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e }));
  appendFileSync(join(p.dir, ".werk", "log.jsonl"), `${log.join("\n")}\n`);
}
const card = (id: string, parent?: string, status = "decided"): Ev => ({
  type: "node.added",
  payload: { id, kind: "card", title: `Title ${id}`, ...(parent ? { parent } : {}), status, who: "me" },
});
const spec = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nNone.\n`;

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
touches: map view, decision log

## What to build

${o.build ?? "A person opens a card and sees it."}

## Acceptance criteria

- [ ] The card shows.

## Checks

${o.checks ?? ""}`;

function setup(events: Ev[], stories: number, files: Record<string, string>): Project {
  const p = freshProject();
  map(p, events);
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"));
  for (const [n, t] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", n), t);
  return p;
}
const check = (p: Project, root = "root", specFile = "spec.md") =>
  p.werk(["ticket-check", "tickets", "--root", root, "--spec", specFile]);

const twoCards = [card("root"), card("alpha", "root"), card("beta", "root")];
const valid = () => ({
  "01-first.md": ticket({ title: "First slice", cites: "root, alpha", stories: "1", checks: "- `make test`\n" }),
  "02-second.md": ticket({ title: "Second slice", cites: "#beta", blocked: "1", stories: "2", checks: "" }),
});

test("26.1 a folder of valid tickets passes clean", async () => {
  const p = setup(twoCards, 2, valid());
  const r = await check(p);
  const out = r.out.trimEnd().split("\n");
  expect(out.length).toBe(1);
  expect(out.at(-1)).toMatch(/\b0 failures\b/);
  expect(r.code).toBe(0);
});

test("26.2 a file path and an oversized ticket are named with ticket and place", async () => {
  const files = valid();
  const p = setup(twoCards, 2, files);
  expect((await check(p)).code).toBe(0);
  const first = files["01-first.md"].split("\n");
  // Line 9 is the first line of What to build.
  expect(first[6]).toBe("## What to build");
  first[8] = "Change src/loop.ts so the card opens, and the Makefile target too.";
  writeFileSync(join(p.dir, "tickets", "01-first.md"), first.join("\n"));
  const second = files["02-second.md"].replace("sees it.", `sees it. ${"pad ".repeat(1100)}`);
  expect(second.length).toBeGreaterThan(4000);
  writeFileSync(join(p.dir, "tickets", "02-second.md"), second);
  const r = await check(p);
  const out = r.out.trimEnd().split("\n");
  const failures = out.slice(0, -1);
  expect(
    failures.some(
      (l) =>
        l.startsWith("01-first.md") && l.includes("no-file-paths") && l.includes("line 9") && l.includes("src/loop.ts"),
    ),
  ).toBe(true);
  expect(failures.filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(failures.some((l) => l.startsWith("02-second.md") && l.includes("size"))).toBe(true);
  expect(out.at(-1)).toContain(`${failures.length} failure`);
  expect(r.code).toBe(1);
});

test("26.3 set checks report uncited card, missing story and blocker cycle, not the ghost", async () => {
  const events = [
    card("root"),
    card("alpha", "root"),
    card("beta", "root"),
    { type: "node.proposed", payload: { id: "ghosty", kind: "card", title: "Ghost", parent: "root" } },
  ];
  const p = setup(events, 3, {
    "01-a.md": ticket({ title: "A", cites: "root, alpha", stories: "1" }),
    "02-b.md": ticket({ title: "B", cites: "alpha", blocked: "3", stories: "2" }),
    "03-c.md": ticket({ title: "C", cites: "root", blocked: "2", stories: "1, 2" }),
  });
  const r = await check(p);
  const out = r.out.trimEnd().split("\n");
  const cited = out.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toContain("beta");
  const stories = out.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories.length).toBe(1);
  expect(stories[0]).toContain("3");
  const cycle = out.find((l) => l.includes("blocked_by") && l.includes("cycle"));
  expect(cycle).toContain("02-b.md");
  expect(cycle).toContain("03-c.md");
  expect(out.filter((l) => l.includes("ghosty"))).toEqual([]);
  expect(r.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, and its cites do not count", async () => {
  const p = setup([card("root"), card("alpha", "root")], 1, {
    "01-x.md": ticket({ cites: "root, alpha", stories: "1" }),
  });
  const r = await check(p);
  const out = r.out.trimEnd().split("\n");
  const own = out.filter((l) => l.startsWith("01-x.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain("title");
  expect(out.some((l) => l.startsWith("ticket set") && l.includes("alpha"))).toBe(true);
  expect(out.some((l) => l.startsWith("ticket set") && l.includes("story 1"))).toBe(true);
  expect(r.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const p = setup(twoCards, 2, valid());
  const missing = await check(p, "root", "nope.md");
  expect(`${missing.out}${missing.err}`).toMatch(/spec/);
  expect(`${missing.out}${missing.err}`).toContain("nope.md");
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "nostories.md"), "# Spec\n\n## Seams\n\n1. x\n");
  expect((await check(p, "root", "nostories.md")).code).toBe(2);
  expect((await check(p, "nosuchcard", "spec.md")).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--spec", "spec.md"])).code).toBe(2);
});

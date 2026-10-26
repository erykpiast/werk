import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, type Project, withMap } from "./helpers.ts";

const spec = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nThe command line.\n`;

const ticket = (o: { title?: string; cites: string; blocked: string; stories: string; what?: string; checks?: string }) =>
  `${o.title === undefined ? "" : `title: ${o.title}\n`}cites: ${o.cites}
blocked_by: ${o.blocked}
stories: ${o.stories}
touches: map view, decision log

## What to build

${o.what ?? "A person opens a decided card and presses reopen."}

## Acceptance criteria

- [ ] A reopened card shows as open in the map.

## Checks

${o.checks ?? ""}
`;

function setup(cards: [string, Record<string, unknown>][], stories: number, files: Record<string, string>): Project {
  const p = withMap(cards);
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", name), text);
  return p;
}
const decided = (id: string, parent?: string) => card(id, id.toUpperCase(), parent, { status: "decided" });
const ghost = (id: string, parent: string): [string, Record<string, unknown>] => [
  "node.proposed",
  { id, kind: "card", title: id, parent },
];
const check = (p: Project, root = "root", specFile = "spec.md") =>
  p.werk(["ticket-check", "tickets", "--root", root, "--spec", specFile]);

const valid = () => ({
  "01-first.md": ticket({ title: "First", cites: "root, a", blocked: "", stories: "1", checks: "- `make test`" }),
  "02-second.md": ticket({ title: "Second", cites: "#b", blocked: "1", stories: "2", checks: "" }),
});
const tree = () => [decided("root"), decided("a", "root"), decided("b", "root")];

test("26.1 a folder of valid hand-written tickets gets a clean pass", async () => {
  const p = setup(tree(), 2, valid());
  const r = await check(p);
  const out = r.out.trim().split("\n");
  expect(out.length).toBe(1);
  expect(out.at(-1)).toMatch(/\b0 failures\b/);
  expect(r.code).toBe(0);
});

test("26.2 a file path and an oversized ticket are named with their ticket and place", async () => {
  const files = valid();
  files["01-first.md"] = ticket({
    title: "First",
    cites: "root, a",
    blocked: "",
    stories: "1",
    what: "Change the loop in src/loop.ts so it stops.\nAlso run the Makefile target.",
    checks: "- `make test`",
  });
  files["02-second.md"] = ticket({ title: "Second", cites: "#b", blocked: "1", stories: "2", what: `Pad. ${"x ".repeat(2100)}` });
  const p = setup(tree(), 2, files);
  const lines = (await check(p)).out.trim().split("\n");
  const r = await check(p);
  expect(lines.some((l) => l.startsWith("01-first.md") && l.includes("no-file-paths") && l.includes("src/loop.ts") && /line 9\b/.test(l))).toBe(true);
  expect(lines.some((l) => l.includes("Makefile"))).toBe(false);
  expect(lines.some((l) => l.startsWith("02-second.md") && l.includes("size"))).toBe(true);
  expect(lines.at(-1)).not.toMatch(/\b0 failures\b/);
  expect(r.code).toBe(1);
});

test("26.3 the set checks report an uncited card, a missing story and a blocker cycle, but not a ghost", async () => {
  const p = setup([...tree(), ghost("g", "root")], 3, {
    "01-one.md": ticket({ title: "One", cites: "root, a", blocked: "", stories: "1" }),
    "02-two.md": ticket({ title: "Two", cites: "a", blocked: "3", stories: "2" }),
    "03-three.md": ticket({ title: "Three", cites: "root", blocked: "2", stories: "1" }),
  });
  const r = await check(p);
  const lines = r.out.trim().split("\n");
  const cited = lines.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toMatch(/\bb\b/);
  const stories = lines.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories.length).toBe(1);
  expect(stories[0]).toContain("3");
  const cycle = lines.filter((l) => l.includes("blocked_by") && l.includes("cycle"));
  expect(cycle.length).toBeGreaterThan(0);
  expect(cycle.join("\n")).toContain("02-two.md");
  expect(cycle.join("\n")).toContain("03-three.md");
  expect(lines.some((l) => /\bg\b/.test(l.replace(/^[^:]*:/, "")))).toBe(false);
  expect(r.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, and its cites do not count for the set", async () => {
  const p = setup([decided("root"), decided("a", "root")], 1, {
    "01-untitled.md": ticket({ cites: "root, a", blocked: "", stories: "1" }),
  });
  const r = await check(p);
  const lines = r.out.trim().split("\n");
  const own = lines.filter((l) => l.startsWith("01-untitled.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain("title");
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("cards-cited") && /\ba\b/.test(l))).toBe(true);
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("stories") && l.includes("1"))).toBe(true);
  expect(r.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const p = setup(tree(), 2, valid());
  const missing = await check(p, "root", "nope.md");
  expect(missing.err + missing.out).toMatch(/spec/i);
  expect(missing.err + missing.out).toContain("nope.md");
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad.md"), "# Spec\n\n## Stories\n\n1. x\n");
  expect((await check(p, "root", "bad.md")).code).toBe(2);
  expect((await check(p, "no-such-root")).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--spec", "spec.md"])).code).toBe(2);
});

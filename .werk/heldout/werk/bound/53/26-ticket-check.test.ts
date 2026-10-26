// Held-out steps 26.1-26.5: werk ticket-check at the command line.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const spec = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nCLI.\n`;

const ticket = (o: { title?: string; cites: string; blocked: string; stories: string; build?: string; checks?: string }) =>
  `${o.title === undefined ? "" : `title: ${o.title}\n`}cites: ${o.cites}
blocked_by: ${o.blocked}
stories: ${o.stories}
touches: map view

## What to build

${o.build ?? "A person opens a card and sees it."}

## Acceptance criteria

- [ ] The card shows.

## Checks

${o.checks ?? ""}`;

function setup(events: object[], stories: number): Project {
  const p = freshProject();
  const log = events.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e }));
  appendFileSync(join(p.dir, ".werk", "log.jsonl"), `${log.join("\n")}\n`);
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}
const card = (id: string, parent?: string) => ({ type: "node.added", payload: { id, kind: "card", title: id, ...(parent ? { parent } : {}) } });
const decide = (id: string) => ({ type: "node.decided", payload: { id } });
const put = (p: Project, files: Record<string, string>) => {
  for (const [n, t] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", n), t);
};
const check = (p: Project, ...args: string[]) => p.werk(["ticket-check", "tickets", ...args]);

const twoCards = () => [card("root"), card("a", "root"), card("b", "root"), decide("root"), decide("a"), decide("b")];

test("26.1 valid tickets give a clean pass", async () => {
  const p = setup(twoCards(), 2);
  put(p, {
    "01-one.md": ticket({ title: "One", cites: "root, a", blocked: "", stories: "1", checks: "- `make test`\n" }),
    "02-two.md": ticket({ title: "Two", cites: "#b", blocked: "1", stories: "2", checks: "" }),
  });
  const run = await check(p, "--root", "root", "--spec", "spec.md");
  console.log(JSON.stringify(run));
  const lines = run.out.trim().split("\n");
  expect(lines.length).toBe(1);
  expect(lines.at(-1)).toMatch(/\b0 failures\b/);
  expect(run.code).toBe(0);
});

test("26.2 a file path and an oversized ticket", async () => {
  const p = setup(twoCards(), 2);
  const first = ticket({ title: "One", cites: "root, a", blocked: "", stories: "1", checks: "- `make test`\n" });
  const second = ticket({ title: "Two", cites: "#b", blocked: "1", stories: "2" });
  put(p, { "01-one.md": first, "02-two.md": second });
  expect((await check(p, "--root", "root", "--spec", "spec.md")).code).toBe(0);
  const lines = first.split("\n");
  expect(lines[6]).toBe("## What to build");
  lines[8] = "Edit src/loop.ts so the card shows.";
  lines.splice(9, 0, "Then run the Makefile target.");
  const padded = second.replace("sees it.", `sees it. ${"pad ".repeat(1100)}`);
  expect(padded.length).toBeGreaterThan(4000);
  put(p, { "01-one.md": lines.join("\n"), "02-two.md": padded });
  const run = await check(p, "--root", "root", "--spec", "spec.md");
  console.log(JSON.stringify(run));
  const out = run.out.trim().split("\n");
  const fails = out.slice(0, -1);
  expect(fails.some((l) => l.startsWith("01-one.md") && l.includes("no-file-paths") && l.includes("src/loop.ts") && /line 9\b/.test(l))).toBe(true);
  expect(fails.filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(fails.some((l) => l.startsWith("02-two.md") && l.includes("size"))).toBe(true);
  expect(out.at(-1)).toMatch(/[1-9]\d* failures?\b/);
  expect(run.code).toBe(1);
});

test("26.3 set checks: uncited card, missing story, cycle, not a ghost", async () => {
  const p = setup(
    [...twoCards(), { type: "node.proposed", payload: { id: "ghosty", kind: "card", title: "ghosty", parent: "root" } }],
    3,
  );
  put(p, {
    "01-one.md": ticket({ title: "One", cites: "root, a", blocked: "", stories: "1" }),
    "02-two.md": ticket({ title: "Two", cites: "a", blocked: "3", stories: "2" }),
    "03-three.md": ticket({ title: "Three", cites: "root", blocked: "2", stories: "1" }),
  });
  const run = await check(p, "--root", "root", "--spec", "spec.md");
  console.log(JSON.stringify(run));
  const lines = run.out.split("\n");
  const cited = lines.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toContain("#b");
  const st = lines.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(st.length).toBe(1);
  expect(st[0]).toContain("story 3");
  const cyc = lines.find((l) => l.includes("blocked_by") && l.includes("cycle"));
  expect(cyc).toBeDefined();
  expect(cyc).toContain("02-two.md");
  expect(cyc).toContain("03-three.md");
  expect(lines.filter((l) => l.includes("ghosty"))).toEqual([]);
  expect(run.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, its cites do not count", async () => {
  const p = setup([card("root"), card("a", "root"), decide("root"), decide("a")], 1);
  put(p, { "01-one.md": ticket({ cites: "root, a", blocked: "", stories: "1", checks: "- `make test`\n" }) });
  const run = await check(p, "--root", "root", "--spec", "spec.md");
  console.log(JSON.stringify(run));
  const lines = run.out.trim().split("\n").slice(0, -1);
  const own = lines.filter((l) => l.startsWith("01-one.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain("title");
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("#a") && /cite/.test(l))).toBe(true);
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("story 1"))).toBe(true);
  expect(run.code).toBe(1);
});

test("26.5 a malformed call exits 2", async () => {
  const p = setup(twoCards(), 2);
  put(p, {
    "01-one.md": ticket({ title: "One", cites: "root, a", blocked: "", stories: "1" }),
    "02-two.md": ticket({ title: "Two", cites: "#b", blocked: "1", stories: "2" }),
  });
  const missing = await check(p, "--root", "root", "--spec", "nope.md");
  console.log(JSON.stringify(missing));
  expect(`${missing.out}${missing.err}`).toMatch(/nope\.md/);
  expect(`${missing.out}${missing.err}`).toMatch(/missing|not found|no spec file|no such|does not exist|cannot read/i);
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad.md"), "# Spec\n\n## Seams\n\nnothing\n");
  const bad = await check(p, "--root", "root", "--spec", "bad.md");
  console.log(JSON.stringify(bad));
  expect(bad.code).toBe(2);
  const noRootCard = await check(p, "--root", "zzz", "--spec", "spec.md");
  console.log(JSON.stringify(noRootCard));
  expect(noRootCard.code).toBe(2);
  const noRoot = await check(p, "--spec", "spec.md");
  console.log(JSON.stringify(noRoot));
  expect(noRoot.code).toBe(2);
});

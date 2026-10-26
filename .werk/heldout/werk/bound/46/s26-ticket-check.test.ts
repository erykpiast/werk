// Scenarios 26.1 - 26.5: werk ticket-check on a folder of hand-written tickets.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project, real, seed } from "./helpers.ts";

const spec = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nThe command line.\n`;

type T = { title?: string; cites: string; blockedBy?: string; stories: string; build?: string; checks?: string };

const ticket = ({ title, cites, blockedBy = "", stories, build = "A person does the thing.", checks = "- `make test`" }: T) =>
  `${title === undefined ? "" : `title: ${title}\n`}cites: ${cites}
blocked_by: ${blockedBy}
stories: ${stories}
touches: map view, decision log

## What to build

${build}

## Acceptance criteria

- [ ] The thing works.

## Checks

${checks}
`;

function project(ghost = false, decidedCount = 2, stories = 2): Project {
  const p = freshProject();
  const events: { type: string; actor?: string; payload: object }[] = [real("root", "Root")];
  for (let i = 1; i <= decidedCount; i++) events.push(real(`card-${i}`, `Card ${i}`, { parent: "root" }));
  if (ghost) events.push({ type: "node.proposed", actor: "agent", payload: { id: "ghost-card", kind: "card", title: "Ghost", parent: "root" } });
  events.push({ type: "node.decided", payload: { id: "root" } });
  for (let i = 1; i <= decidedCount; i++) events.push({ type: "node.decided", payload: { id: `card-${i}` } });
  seed(p, events);
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}

const write = (p: Project, files: Record<string, string>) => {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", name), text);
};
const check = (p: Project, extra: string[] = ["--root", "root", "--spec", "spec.md"]) =>
  p.werk(["ticket-check", "tickets", ...extra]);
const outLines = (out: string) => out.split("\n").filter((line) => line !== "");

test("26.1 a folder of valid tickets passes clean", async () => {
  const p = project();
  write(p, {
    "01-first.md": ticket({ title: "First", cites: "root, card-1", stories: "1" }),
    "02-second.md": ticket({ title: "Second", cites: "#card-2", blockedBy: "1", stories: "2", checks: "" }),
  });
  const run = await check(p);
  const all = outLines(run.out);
  expect(all.length).toBe(1);
  expect(all.at(-1)).toContain("0 failures");
  expect(run.code).toBe(0);
});

test("26.2 a file path and an oversized ticket are named with ticket and place", async () => {
  const p = project();
  write(p, {
    "01-first.md": ticket({ title: "First", cites: "root, card-1", stories: "1" }),
    "02-second.md": ticket({ title: "Second", cites: "#card-2", blockedBy: "1", stories: "2", checks: "" }),
  });
  expect((await check(p)).code).toBe(0);
  write(p, {
    "01-first.md": ticket({
      title: "First",
      cites: "root, card-1",
      stories: "1",
      build: "The loop in src/loop.ts runs each pass.\nThe Makefile gets a target.",
    }),
    "02-second.md": ticket({
      title: "Second",
      cites: "#card-2",
      blockedBy: "1",
      stories: "2",
      checks: "",
      build: `A person does the thing.\n\n${"Padding text for the size check. ".repeat(130)}`,
    }),
  });
  const first = readFileSync(join(p.dir, "tickets", "01-first.md"), "utf8").split("\n");
  expect(first[8]).toContain("src/loop.ts"); // line 9, inside What to build
  expect(readFileSync(join(p.dir, "tickets", "02-second.md"), "utf8").length).toBeGreaterThan(4000);
  const run = await check(p);
  const all = outLines(run.out);
  const pathLine = all.find((line) => line.startsWith("01-first.md") && line.includes("no-file-paths"));
  expect(pathLine).toBeDefined();
  expect(pathLine).toContain("src/loop.ts");
  expect(pathLine).toContain("line 9");
  expect(all.slice(0, -1).some((line) => line.includes("Makefile"))).toBe(false);
  expect(all.some((line) => line.startsWith("02-second.md") && line.includes("size"))).toBe(true);
  expect(all.at(-1)).toMatch(/[1-9]\d* failures?/);
  expect(run.code).toBe(1);
});

test("26.3 set checks report an uncited card, a missing story and a cycle, but not a ghost", async () => {
  const p = project(true, 2, 3);
  write(p, {
    "01-a.md": ticket({ title: "A", cites: "root, card-1", stories: "1" }),
    "02-b.md": ticket({ title: "B", cites: "card-1", blockedBy: "3", stories: "2" }),
    "03-c.md": ticket({ title: "C", cites: "root", blockedBy: "2", stories: "1" }),
  });
  const run = await check(p);
  const all = outLines(run.out);
  const cited = all.filter((line) => line.startsWith("ticket set") && line.includes("cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toContain("card-2");
  const stories = all.filter((line) => line.startsWith("ticket set") && line.includes("stories"));
  expect(stories.length).toBe(1);
  expect(stories[0]).toContain("3");
  const cycle = all.find((line) => line.includes("blocked_by") && line.includes("cycle"));
  expect(cycle).toBeDefined();
  expect(cycle).toContain("02-b.md");
  expect(cycle).toContain("03-c.md");
  expect(all.some((line) => line.includes("ghost-card"))).toBe(false);
  expect(run.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, and its cites do not count", async () => {
  const p = project(false, 1, 1);
  write(p, { "01-untitled.md": ticket({ cites: "root, card-1", stories: "1" }) });
  const run = await check(p);
  const all = outLines(run.out);
  const own = all.filter((line) => line.startsWith("01-untitled.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain("title");
  const set = all.filter((line) => line.startsWith("ticket set"));
  expect(set.some((line) => line.includes("cards-cited") && line.includes("card-1"))).toBe(true);
  expect(set.some((line) => line.includes("stories") && line.includes("1"))).toBe(true);
  expect(run.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const p = project();
  write(p, {
    "01-first.md": ticket({ title: "First", cites: "root, card-1", stories: "1" }),
    "02-second.md": ticket({ title: "Second", cites: "#card-2", blockedBy: "1", stories: "2", checks: "" }),
  });
  const missing = await check(p, ["--root", "root", "--spec", "no-such-spec.md"]);
  expect(missing.out + missing.err).toMatch(/spec/i);
  expect(missing.out + missing.err).toContain("no-such-spec.md");
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad-spec.md"), "# Spec\n\n## Stories\n\n1. One.\n");
  expect((await check(p, ["--root", "root", "--spec", "bad-spec.md"])).code).toBe(2);
  expect((await check(p, ["--root", "no-such-root", "--spec", "spec.md"])).code).toBe(2);
  expect((await check(p, ["--spec", "spec.md"])).code).toBe(2);
});

// Held-out steps 26.x: werk ticket-check.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, type P, project } from "./helpers.ts";

const spec = (stories: number) =>
  `# Spec: exports\n\n## User stories\n\n${Array.from({ length: stories }, (_, i) => `${i + 1}. As a person, I want export part ${i + 1}.`).join("\n")}\n\n## Seams\n\nThe command line.\n`;

type T = { title?: string; cites: string; blockedBy?: string; stories: string; checks?: string; build?: string[] };

/** A ticket in the fixed format. Line 9 is the first line of What to build. */
function ticket(t: T): string {
  const head = [
    ...(t.title === undefined ? [] : [`title: ${t.title}`]),
    `cites: ${t.cites}`,
    `blocked_by: ${t.blockedBy ?? ""}`,
    `stories: ${t.stories}`,
    "touches: export view, decision log",
    "",
    "## What to build",
    "",
  ];
  const build = t.build ?? ["A person exports the map as one file."];
  return [
    ...head,
    ...build,
    "",
    "## Acceptance criteria",
    "",
    "- [ ] The export holds every card.",
    "",
    "## Checks",
    "",
    ...(t.checks === undefined ? [] : [t.checks]),
    "",
  ].join("\n");
}

function setup(cards: object[], stories: number, tickets: Record<string, string>): P {
  const p = project();
  p.seed(...(cards as { type: string; payload: object }[]));
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"), { recursive: true });
  for (const [name, text] of Object.entries(tickets)) writeFileSync(join(p.dir, "tickets", name), text);
  return p;
}

const tree = [
  card("exports", "Exports", { status: "decided" }),
  card("export-format", "Export format", { status: "decided", parent: "exports" }),
  card("export-size", "Export size", { status: "decided", parent: "exports" }),
];

const check = (p: P, ...extra: string[]) =>
  p.werk(["ticket-check", "tickets", "--root", "exports", "--spec", "spec.md", ...extra]);

const valid = () => ({
  "01-format.md": ticket({
    title: "Export writes one file",
    cites: "exports, export-format",
    stories: "1",
    checks: "- `make test`",
  }),
  "02-size.md": ticket({ title: "Export caps its size", cites: "#export-size", blockedBy: "1", stories: "2" }),
});

const failureLines = (out: string) =>
  out
    .split("\n")
    .filter((line) => line !== "")
    .slice(0, -1);

test("26.1 a folder of valid hand-written tickets gets a clean pass", async () => {
  const p = setup(tree, 2, valid());
  const run = await check(p);
  expect(failureLines(run.out)).toEqual([]);
  const last = run.out.trim().split("\n").at(-1) as string;
  expect(last).toMatch(/\b0 failures\b/);
  expect(run.code).toBe(0);
});

test("26.2 a file path and an oversized ticket are each named with their ticket and place", async () => {
  const p = setup(tree, 2, valid());
  expect((await check(p)).code).toBe(0);
  const build = ["A person exports the map as one file.", "The `Makefile` gets a target for it."];
  const first = ticket({
    title: "Export writes one file",
    cites: "exports, export-format",
    stories: "1",
    checks: "- `make test`",
    build: [...build],
  });
  // Put the path on line 9 of the file: the first line of What to build.
  const lines = first.split("\n");
  expect(lines[7]).toBe("");
  lines[8] = "Change src/loop.ts so the export runs.";
  writeFileSync(join(p.dir, "tickets", "01-format.md"), lines.join("\n"));
  const second = ticket({
    title: "Export caps its size",
    cites: "#export-size",
    blockedBy: "1",
    stories: "2",
    build: [`A person exports a big map. ${"pad ".repeat(1100)}`],
  });
  expect(second.length).toBeGreaterThan(4000);
  writeFileSync(join(p.dir, "tickets", "02-size.md"), second);

  const run = await check(p);
  const failures = failureLines(run.out);
  const path = failures.find((line) => line.startsWith("01-format.md") && line.includes("no-file-paths"));
  expect(path).toBeDefined();
  expect(path).toContain("src/loop.ts");
  expect(path).toMatch(/line 9\b/);
  expect(failures.filter((line) => line.includes("Makefile"))).toEqual([]);
  expect(failures.find((line) => line.startsWith("02-size.md") && line.includes("size"))).toBeDefined();
  const last = run.out.trim().split("\n").at(-1) as string;
  expect(last).toMatch(new RegExp(`\\b${failures.length} failures\\b`));
  expect(run.code).toBe(1);
});

test("26.3 the set checks report an uncited card, a missing story and a blocker cycle, but not a ghost", async () => {
  const cards = [
    ...tree,
    {
      type: "node.proposed",
      actor: "agent",
      payload: { id: "export-ghost", kind: "card", title: "Ghost", parent: "exports" },
    },
  ];
  const p = setup(cards, 3, {
    "01-format.md": ticket({ title: "Export writes one file", cites: "exports, export-format", stories: "1" }),
    "02-more.md": ticket({ title: "Export more", cites: "export-format", blockedBy: "3", stories: "2" }),
    "03-again.md": ticket({ title: "Export again", cites: "exports", blockedBy: "2", stories: "1" }),
  });
  const run = await check(p);
  const failures = failureLines(run.out);
  const cited = failures.filter((line) => line.startsWith("ticket set") && line.includes("cards-cited"));
  expect(cited).toHaveLength(1);
  expect(cited[0]).toContain("export-size");
  const stories = failures.filter((line) => line.startsWith("ticket set") && line.includes("stories"));
  expect(stories).toHaveLength(1);
  expect(stories[0]).toMatch(/story 3\b/);
  const cycle = failures.find((line) => line.includes("blocked_by") && line.includes("cycle"));
  expect(cycle).toContain("02-more.md");
  expect(cycle).toContain("03-again.md");
  expect(run.out).not.toContain("export-ghost");
  expect(run.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, and its cites do not count for the set", async () => {
  const cards = [
    card("exports", "Exports", { status: "decided" }),
    card("export-format", "Export format", { status: "decided", parent: "exports" }),
  ];
  const p = setup(cards, 1, { "01-format.md": ticket({ cites: "exports, export-format", stories: "1" }) });
  const run = await check(p);
  const failures = failureLines(run.out);
  const own = failures.filter((line) => line.startsWith("01-format.md"));
  expect(own).toHaveLength(1);
  expect(own[0]).toContain("title");
  expect(failures.find((line) => line.startsWith("ticket set") && line.includes("export-format"))).toBeDefined();
  expect(failures.find((line) => line.startsWith("ticket set") && /story 1\b/.test(line))).toBeDefined();
  expect(run.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const p = setup(tree, 2, valid());
  const missing = await p.werk(["ticket-check", "tickets", "--root", "exports", "--spec", "nowhere.md"]);
  expect(`${missing.out}${missing.err}`).toMatch(/spec/);
  expect(`${missing.out}${missing.err}`).toContain("nowhere.md");
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad-spec.md"), "# Spec\n\n1. A line with no heading.\n");
  expect((await p.werk(["ticket-check", "tickets", "--root", "exports", "--spec", "bad-spec.md"])).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--root", "no-such-card", "--spec", "spec.md"])).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--spec", "spec.md"])).code).toBe(2);
});

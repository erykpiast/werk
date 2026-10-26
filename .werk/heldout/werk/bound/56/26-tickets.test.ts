import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, type Held, held } from "./helpers.ts";

const spec = (stories: number) => `# Spec: export

## User stories

${Array.from({ length: stories }, (_, i) => `${i + 1}. As a person, I want export part ${i + 1}.`).join("\n")}

## Seams

The command line.
`;

type T = { title?: string; cites: string; blockedBy: string; stories: string; build?: string; checks?: string };

function ticket(t: T): string {
  return [
    ...(t.title === undefined ? [] : [`title: ${t.title}`]),
    `cites: ${t.cites}`,
    `blocked_by: ${t.blockedBy}`,
    `stories: ${t.stories}`,
    "touches: export screen, decision log",
    "",
    "## What to build",
    "",
    t.build ?? "A person presses export and gets one file of orders.",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] The export file holds every order.",
    "",
    "## Checks",
    "",
    ...(t.checks === undefined ? [] : [t.checks]),
    "",
  ].join("\n");
}

function setup(h: Held, stories: number, files: Record<string, string>): void {
  writeFileSync(join(h.dir, "spec.md"), spec(stories));
  mkdirSync(join(h.dir, "tickets"), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(h.dir, "tickets", name), text);
}

const check = (h: Held, root = "export") => h.w("ticket-check", "tickets", "--root", root, "--spec", "spec.md");

function exportMap(h: Held): void {
  card(h, "export", "Export");
  card(h, "export-format", "Export format", { parent: "export" }, true);
  card(h, "export-button", "Export button", { parent: "export" }, true);
}

const validTickets = () => ({
  "01-format.md": ticket({
    title: "Export writes one file",
    cites: "export, export-format",
    blockedBy: "",
    stories: "1",
    checks: "- `make test`",
  }),
  "02-button.md": ticket({
    title: "A button starts the export",
    cites: "#export-button",
    blockedBy: "1",
    stories: "2",
  }),
});

const failureLines = (out: string) =>
  out
    .split("\n")
    .filter((line) => line !== "")
    .slice(0, -1);

test("26.1 a folder of valid hand-written tickets gets a clean pass", async () => {
  const h = held();
  exportMap(h);
  setup(h, 2, validTickets());
  const run = await check(h);
  const lines = run.out.split("\n").filter((line) => line !== "");
  expect(failureLines(run.out)).toEqual([]);
  expect(lines.at(-1)).toMatch(/(^|, )0 failures/);
  expect(run.code).toBe(0);
});

test("26.2 an agent finds a file path and an oversized ticket, each named with its ticket and place", async () => {
  const h = held();
  exportMap(h);
  setup(h, 2, validTickets());
  expect((await check(h)).code).toBe(0);

  // Line 9 of the ticket file is the first line of its What to build section.
  const first = validTickets()["01-format.md"].split("\n");
  expect(first[6]).toBe("## What to build");
  first[8] = "The export code lives in src/loop.ts, and the Makefile gets a target.";
  const second = validTickets()["02-button.md"].replace(
    "gets one file of orders.",
    `gets one file of orders. ${"more words ".repeat(400)}`,
  );
  expect(second.length).toBeGreaterThan(4000);
  setup(h, 2, { "01-format.md": first.join("\n"), "02-button.md": second });

  const run = await check(h);
  const failures = failureLines(run.out);
  const path = failures.find((line) => line.startsWith("01-format.md") && line.includes("no-file-paths"));
  expect(path).toBeDefined();
  expect(path).toContain("src/loop.ts");
  expect(path).toContain("line 9");
  expect(failures.filter((line) => line.includes("Makefile"))).toEqual([]);
  expect(failures.find((line) => line.startsWith("02-button.md") && line.includes("size"))).toBeDefined();
  const count =
    run.out
      .split("\n")
      .filter((line) => line !== "")
      .at(-1) ?? "";
  expect(count).toMatch(/[1-9]\d* failures/);
  expect(run.code).toBe(1);
});

test("26.3 the set checks report an uncited card, a missing story and a blocker cycle, but not a ghost", async () => {
  const h = held();
  exportMap(h);
  h.seed("node.proposed", { id: "export-ghost", kind: "card", title: "Export ghost", parent: "export" }, "agent");
  setup(h, 3, {
    "01-format.md": ticket({ title: "Export writes one file", cites: "export-format", blockedBy: "", stories: "1" }),
    "02-more.md": ticket({ title: "Export writes more", cites: "export-format", blockedBy: "3", stories: "2" }),
    "03-again.md": ticket({ title: "Export writes again", cites: "export-format", blockedBy: "2", stories: "1, 2" }),
  });
  const run = await check(h);
  const lines = failureLines(run.out);
  const cited = lines.filter((line) => line.startsWith("ticket set") && line.includes("cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toContain("export-button");
  const stories = lines.filter((line) => line.startsWith("ticket set") && line.includes("stories"));
  expect(stories.length).toBe(1);
  expect(stories[0]).toContain("story 3");
  const cycle = lines.find((line) => line.includes("blocked_by") && line.includes("cycle"));
  expect(cycle).toBeDefined();
  expect(cycle).toContain("02-more.md");
  expect(cycle).toContain("03-again.md");
  expect(run.out).not.toContain("export-ghost");
  expect(run.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, and its cites do not count for the set", async () => {
  const h = held();
  card(h, "export", "Export");
  card(h, "export-format", "Export format", { parent: "export" }, true);
  setup(h, 1, {
    "01-format.md": ticket({ cites: "export-format", blockedBy: "", stories: "1", checks: "- `make test`" }),
  });
  const run = await check(h);
  const lines = failureLines(run.out);
  const own = lines.filter((line) => line.startsWith("01-format.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain("title");
  const set = lines.filter((line) => line.startsWith("ticket set"));
  expect(set.some((line) => line.includes("export-format"))).toBe(true);
  expect(set.some((line) => line.includes("story 1"))).toBe(true);
  expect(run.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const h = held();
  exportMap(h);
  setup(h, 2, validTickets());

  const missing = await h.w("ticket-check", "tickets", "--root", "export", "--spec", "no-such-spec.md");
  expect(`${missing.out}${missing.err}`).toMatch(/no spec file|missing|not found/i);
  expect(missing.code).toBe(2);

  writeFileSync(join(h.dir, "bare.md"), "# Spec\n\n1. One line.\n");
  expect((await h.w("ticket-check", "tickets", "--root", "export", "--spec", "bare.md")).code).toBe(2);
  expect((await h.w("ticket-check", "tickets", "--root", "no-such-card", "--spec", "spec.md")).code).toBe(2);
  expect((await h.w("ticket-check", "tickets", "--spec", "spec.md")).code).toBe(2);
});

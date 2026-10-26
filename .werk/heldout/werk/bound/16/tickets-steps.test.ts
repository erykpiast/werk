// Held-out steps 26.x: `werk ticket-check` on folders of hand-written tickets.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type MapProject, mapProject } from "./map-helpers.ts";

const spec = (stories: string[]) => `# Spec: exports

## User stories

${stories.map((s, i) => `${i + 1}. ${s}`).join("\n")}

## Seams

The command line.
`;

type T = { title?: string; cites: string; blockedBy: string; stories: string; what?: string; checks?: string };

const ticket = (t: T) => `${t.title === undefined ? "" : `title: ${t.title}\n`}cites: ${t.cites}
blocked_by: ${t.blockedBy}
stories: ${t.stories}
touches: export view, decision log

## What to build

${t.what ?? "A person exports the orders as one file."}

## Acceptance criteria

- [ ] The export holds every order.

## Checks

${t.checks ?? "- `make test`"}
`;

function setup(
  cards: [string, string, string?][],
  ghost?: string,
  stories = ["As a person, I export.", "As a person, I import."],
) {
  const m = mapProject();
  m.seed("node.added", { id: "exports", kind: "card", title: "Exports", status: "decided" });
  for (const [id, title] of cards)
    m.seed("node.added", { id, kind: "card", title, status: "decided", parent: "exports" });
  if (ghost !== undefined)
    m.seed("node.proposed", { id: ghost, kind: "card", title: "A ghost", parent: "exports" }, "agent");
  writeFileSync(join(m.p.dir, "spec.md"), spec(stories));
  mkdirSync(join(m.p.dir, "tickets"));
  return m;
}

const write = (m: MapProject, files: Record<string, string>) => {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(m.p.dir, "tickets", name), text);
};
const check = (m: MapProject, ...args: string[]) =>
  m.w("ticket-check", "tickets", ...(args.length > 0 ? args : ["--root", "exports", "--spec", "spec.md"]));
const failureLines = (out: string) =>
  out
    .split("\n")
    .filter(Boolean)
    .filter((l) => !/^\d+ tickets?, /.test(l));

const validTwo = {
  "01-export.md": ticket({
    title: "A person exports orders",
    cites: "exports, export-format",
    blockedBy: "",
    stories: "1",
  }),
  "02-import.md": ticket({
    title: "A person imports orders",
    cites: "#import-format",
    blockedBy: "1",
    stories: "2",
    checks: "",
  }),
};

test("26.1 a folder of valid hand-written tickets gets a clean pass", async () => {
  const m = setup([
    ["export-format", "Export format"],
    ["import-format", "Import format"],
  ]);
  write(m, validTwo);
  const run = await check(m);
  expect(failureLines(run.out)).toEqual([]);
  const last = run.out.trimEnd().split("\n").at(-1) ?? "";
  expect(last).toMatch(/\b0 failures\b/);
  expect(run.code).toBe(0);
});

test("26.2 a file path and an oversized ticket are each named with their ticket and place", async () => {
  const m = setup([
    ["export-format", "Export format"],
    ["import-format", "Import format"],
  ]);
  write(m, validTwo);
  expect((await check(m)).code).toBe(0);

  // Line 9 of the file is the line under "## What to build".
  const first = ticket({
    title: "A person exports orders",
    cites: "exports, export-format",
    blockedBy: "",
    stories: "1",
    what: "The loop in src/loop.ts writes the export.\nThe Makefile gains no target.",
  });
  expect(first.split("\n")[8]).toContain("src/loop.ts");
  const second = ticket({
    title: "A person imports orders",
    cites: "#import-format",
    blockedBy: "1",
    stories: "2",
    checks: "",
    what: `A person imports orders. ${"The import reads every row of the file. ".repeat(110)}`,
  });
  expect(second.length).toBeGreaterThan(4000);
  write(m, { "01-export.md": first, "02-import.md": second });

  const run = await check(m);
  const lines = failureLines(run.out);
  const pathLine = lines.find((l) => l.startsWith("01-export.md") && l.includes("no-file-paths"));
  expect(pathLine).toBeDefined();
  expect(pathLine).toContain("src/loop.ts");
  expect(pathLine).toContain("line 9");
  expect(lines.filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(lines.some((l) => l.startsWith("02-import.md") && l.includes("size"))).toBe(true);
  const last = run.out.trimEnd().split("\n").at(-1) ?? "";
  expect(last).toMatch(/[1-9]\d* own-check failures?/);
  expect(run.code).toBe(1);
});

test("26.3 the set checks report an uncited card, a missing story and a blocker cycle, but not a ghost", async () => {
  const m = setup(
    [
      ["export-format", "Export format"],
      ["import-format", "Import format"],
    ],
    "ghost-card",
    ["As a person, I export.", "As a person, I import.", "As a person, I audit."],
  );
  write(m, {
    "01-export.md": ticket({
      title: "A person exports orders",
      cites: "exports, export-format",
      blockedBy: "",
      stories: "1",
    }),
    "02-import.md": ticket({ title: "A person imports orders", cites: "export-format", blockedBy: "3", stories: "2" }),
    "03-retry.md": ticket({ title: "A person retries an import", cites: "exports", blockedBy: "2", stories: "2" }),
  });
  const run = await check(m);
  const lines = failureLines(run.out);
  const cited = lines.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toContain("import-format");
  const stories = lines.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories.length).toBe(1);
  expect(stories[0]).toContain("3");
  const cycle = lines.filter((l) => l.includes("blocked_by"));
  expect(cycle.length).toBeGreaterThan(0);
  expect(cycle.join("\n")).toMatch(/02-import\.md|\b2\b/);
  expect(cycle.join("\n")).toMatch(/03-retry\.md|\b3\b/);
  expect(run.out).not.toContain("ghost-card");
  expect(run.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, and its cites do not count for the set", async () => {
  const m = setup([["export-format", "Export format"]], undefined, ["As a person, I export."]);
  write(m, { "01-export.md": ticket({ cites: "export-format", blockedBy: "", stories: "1" }) });
  const run = await check(m);
  const lines = failureLines(run.out);
  const own = lines.filter((l) => l.startsWith("01-export.md"));
  expect(own.some((l) => l.includes(": title:"))).toBe(true);
  expect(own.filter((l) => !l.includes(": title:"))).toEqual([]);
  expect(
    lines.some((l) => l.startsWith("ticket set") && l.includes("cards-cited") && l.includes("export-format")),
  ).toBe(true);
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("stories") && l.includes("1"))).toBe(true);
  expect(run.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const m = setup([
    ["export-format", "Export format"],
    ["import-format", "Import format"],
  ]);
  write(m, validTwo);
  const missing = await check(m, "--root", "exports", "--spec", "no-such-spec.md");
  expect(`${missing.out}${missing.err}`).toMatch(/spec/i);
  expect(`${missing.out}${missing.err}`).toMatch(/missing|not found|no such|does not exist|cannot read|no spec file/i);
  expect(missing.code).toBe(2);

  writeFileSync(join(m.p.dir, "bare.md"), "# Spec\n\n## Seams\n\nNone.\n");
  expect((await check(m, "--root", "exports", "--spec", "bare.md")).code).toBe(2);
  expect((await check(m, "--root", "no-such-card", "--spec", "spec.md")).code).toBe(2);
  expect((await check(m, "--spec", "spec.md")).code).toBe(2);
});

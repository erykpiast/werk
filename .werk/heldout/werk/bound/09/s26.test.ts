import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, decided, ghost, type Project, withMap } from "./helpers.ts";

const spec = (n: number) =>
  `# Spec: export\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want story ${i + 1}.`).join("\n")}\n\n## Seams\n\nThe command line.\n`;

type T = { title?: string; cites: string; blocked?: string; stories: string; what?: string; checks?: string };
const ticket = ({ title, cites, blocked = "", stories, what, checks = "- `make test`" }: T) =>
  [
    ...(title === undefined ? [] : [`title: ${title}`]),
    `cites: ${cites}`,
    `blocked_by: ${blocked}`,
    `stories: ${stories}`,
    "touches: export view, decision log",
    "",
    "## What to build",
    "",
    what ?? "A person exports the orders as one file.",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] The export holds every order.",
    "",
    "## Checks",
    "",
    checks,
    "",
  ].join("\n");

function setup(p: Project, stories: number, files: Record<string, string>): void {
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", name), text);
}

const map = (...extra: Parameters<typeof withMap>[0]) =>
  withMap([
    card("export", "Export"),
    card("export-one", "One file", "export"),
    card("export-two", "Two formats", "export"),
    decided("export"),
    decided("export-one"),
    decided("export-two"),
    ...extra,
  ]);

const run = (p: Project, root = "export", specFile = "spec.md") =>
  p.werk(["ticket-check", "tickets", "--root", root, "--spec", specFile]);

const failureLines = (out: string) =>
  out
    .split("\n")
    .filter((l) => l !== "")
    .slice(0, -1);

const valid = () => ({
  "01-export.md": ticket({ title: "A person exports orders", cites: "export, export-one", stories: "1" }),
  "02-formats.md": ticket({ title: "Two formats", cites: "#export-two", blocked: "1", stories: "2", checks: "" }),
});

test("26.1", async () => {
  const p = map();
  setup(p, 2, valid());
  const r = await run(p);
  expect(failureLines(r.out)).toEqual([]);
  const last = r.out.trimEnd().split("\n").at(-1) ?? "";
  expect(last).toMatch(/\b0 failures\b/);
  expect(r.code).toBe(0);
});

test("26.2", async () => {
  const p = map();
  const files = valid();
  // Line 9 of the ticket file is the first line of its What to build section; it names src/loop.ts.
  const what = ["Edit src/loop.ts here.", "Also the Makefile."].join("\n");
  files["01-export.md"] = ticket({ title: "A person exports orders", cites: "export, export-one", stories: "1", what });
  files["02-formats.md"] = ticket({
    title: "Two formats",
    cites: "#export-two",
    blocked: "1",
    stories: "2",
    what: `Pad. ${"word ".repeat(820)}`,
  });
  setup(p, 2, files);
  const r = await run(p);
  const lines = failureLines(r.out);
  const path = lines.find((l) => l.startsWith("01-export.md") && l.includes("no-file-paths"));
  expect(path).toBeDefined();
  expect(path).toContain("src/loop.ts");
  expect(path).toMatch(/line 9\b/);
  expect(lines.some((l) => l.includes("Makefile"))).toBe(false);
  expect(lines.some((l) => l.startsWith("02-formats.md") && l.includes("size"))).toBe(true);
  expect(r.out.trimEnd().split("\n").at(-1)).toMatch(/[1-9]\d* failures?/);
  expect(r.code).toBe(1);
});

test("26.3", async () => {
  const p = map(ghost("export-ghost", "Ghost under export", "export"));
  setup(p, 3, {
    "01-a.md": ticket({ title: "Slice one", cites: "export", stories: "1" }),
    "02-b.md": ticket({ title: "Slice two", cites: "export-one", blocked: "3", stories: "2" }),
    "03-c.md": ticket({ title: "Slice three", cites: "export", blocked: "2", stories: "1, 2" }),
  });
  const r = await run(p);
  const lines = failureLines(r.out);
  const cited = lines.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited).toHaveLength(1);
  expect(cited[0]).toContain("export-two");
  const stories = lines.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories).toHaveLength(1);
  expect(stories[0]).toContain("3");
  const cycle = lines.find((l) => l.includes("blocked_by") && l.includes("cycle"));
  expect(cycle).toContain("02-b.md");
  expect(cycle).toContain("03-c.md");
  expect(r.out).not.toContain("export-ghost");
  expect(r.code).toBe(1);
});

test("26.4", async () => {
  const p = withMap([
    card("export", "Export"),
    card("export-one", "One file", "export"),
    decided("export"),
    decided("export-one"),
  ]);
  setup(p, 1, { "01-untitled.md": ticket({ cites: "export-one", stories: "1" }) });
  const r = await run(p);
  const lines = failureLines(r.out);
  const own = lines.filter((l) => l.startsWith("01-untitled.md"));
  expect(own.some((l) => l.includes("title"))).toBe(true);
  expect(own.filter((l) => !l.includes("title"))).toEqual([]);
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("export-one"))).toBe(true);
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("stories") && l.includes("1"))).toBe(true);
  expect(r.code).toBe(1);
});

test("26.5", async () => {
  const p = map();
  setup(p, 2, valid());
  const missing = await run(p, "export", "nope.md");
  expect(`${missing.out}${missing.err}`).toMatch(/no spec file|missing|not exist/i);
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad-spec.md"), "# Spec\n\n1. Only a list.\n");
  expect((await run(p, "export", "bad-spec.md")).code).toBe(2);
  expect((await run(p, "nowhere")).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--spec", "spec.md"])).code).toBe(2);
});

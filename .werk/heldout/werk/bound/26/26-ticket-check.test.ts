import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project, seed } from "./helpers.ts";

const spec = (n: number) =>
  `# Spec: export\n\nSome intro.\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nThe command line.\n`;

type T = { title?: string; cites: string; blocked: string; stories: string; what?: string; checks?: string };
const ticket = (t: T) =>
  `${t.title === undefined ? "" : `title: ${t.title}\n`}cites: ${t.cites}
blocked_by: ${t.blocked}
stories: ${t.stories}
touches: export command, decision log

## What to build
${t.what ?? "\nThe person runs the export and gets one file of orders."}

## Acceptance criteria

- [ ] The export writes one file.

## Checks
${t.checks ?? ""}
`;

function project(cards: { id: string; parent?: string; ghost?: boolean; decided?: boolean }[], stories: number): Project {
  const p = freshProject();
  seed(
    p,
    cards.flatMap((c) => [
      { type: c.ghost ? "node.proposed" : "node.added", actor: c.ghost ? "agent" : "you", payload: { id: c.id, kind: "card", title: `Card ${c.id}`, ...(c.parent ? { parent: c.parent } : {}) } },
      ...(c.decided ? [{ type: "node.decided", payload: { id: c.id } }] : []),
    ]),
  );
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}
const put = (p: Project, files: Record<string, string>) => {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", name), text);
};
const run = (p: Project, root = "export", specFile = "spec.md") =>
  p.werk(["ticket-check", "tickets", "--root", root, "--spec", specFile]);

const two = [{ id: "export" }, { id: "export-format", parent: "export", decided: true }, { id: "export-file", parent: "export", decided: true }];
const validTwo = {
  "01-format.md": ticket({ title: "The export writes orders", cites: "export, export-format", blocked: "", stories: "1", checks: "\n- `make test`" }),
  "02-file.md": ticket({ title: "The export names its file", cites: "#export-file", blocked: "1", stories: "2" }),
};

test("26.1 a folder of valid hand-written tickets gets a clean pass", async () => {
  const p = project(two, 2);
  put(p, validTwo);
  const r = await run(p);
  console.log("26.1:", JSON.stringify(r));
  const lines = r.out.trim().split("\n");
  expect(lines.length).toBe(1);
  expect(lines.at(-1)).toMatch(/ 0 failures/);
  expect(r.code).toBe(0);
});

test("26.2 a file path and an oversized ticket are named with ticket and place", async () => {
  const p = project(two, 2);
  put(p, validTwo);
  expect((await run(p)).code).toBe(0);
  const what = "\nThe export reads src/loop.ts to find the orders.\nIt also updates the Makefile with a new target.";
  const first = ticket({ title: "The export writes orders", cites: "export, export-format", blocked: "", stories: "1", what, checks: "\n- `make test`" });
  expect(first.split("\n")[8]).toContain("src/loop.ts");
  const pad = `\n${"The export keeps every order in the file it writes. ".repeat(90)}`;
  const second = ticket({ title: "The export names its file", cites: "#export-file", blocked: "1", stories: "2", what: pad });
  expect(second.length).toBeGreaterThan(4000);
  put(p, { "01-format.md": first, "02-file.md": second });
  const r = await run(p);
  console.log("26.2:", JSON.stringify(r));
  const lines = r.out.trim().split("\n");
  const pathLine = lines.find((l) => l.startsWith("01-format.md") && l.includes("no-file-paths"));
  expect(pathLine).toBeDefined();
  expect(pathLine).toContain("src/loop.ts");
  expect(pathLine).toContain("line 9");
  expect(lines.some((l) => l.includes("Makefile"))).toBe(false);
  expect(lines.some((l) => l.startsWith("02-file.md") && l.includes("size"))).toBe(true);
  expect(lines.at(-1)).toMatch(/ [1-9]\d* failures?/);
  expect(r.code).toBe(1);
});

test("26.3 set checks report an uncited card, a missing story and a blocker cycle, not a ghost", async () => {
  const p = project(
    [{ id: "export" }, { id: "export-format", parent: "export", decided: true }, { id: "export-file", parent: "export", decided: true }, { id: "export-ghost", parent: "export", ghost: true }],
    3,
  );
  put(p, {
    "01-a.md": ticket({ title: "First", cites: "export-format", blocked: "", stories: "1" }),
    "02-b.md": ticket({ title: "Second", cites: "export-format", blocked: "3", stories: "2" }),
    "03-c.md": ticket({ title: "Third", cites: "export", blocked: "2", stories: "1" }),
  });
  const r = await run(p);
  console.log("26.3:", JSON.stringify(r));
  const lines = r.out.trim().split("\n");
  const cited = lines.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toContain("export-file");
  const stories = lines.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories.length).toBe(1);
  expect(stories[0]).toMatch(/story 3/);
  const cycle = lines.find((l) => l.includes("blocked_by") && l.includes("cycle"));
  expect(cycle).toBeDefined();
  expect(cycle).toContain("02-b.md");
  expect(cycle).toContain("03-c.md");
  expect(lines.some((l) => l.includes("export-ghost"))).toBe(false);
  expect(r.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, and its cites do not count", async () => {
  const p = project([{ id: "export" }, { id: "export-format", parent: "export", decided: true }], 1);
  put(p, { "01-a.md": ticket({ cites: "export-format", blocked: "", stories: "1" }) });
  const r = await run(p);
  console.log("26.4:", JSON.stringify(r));
  const lines = r.out.trim().split("\n");
  const own = lines.filter((l) => l.startsWith("01-a.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain("title");
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("cards-cited") && l.includes("export-format"))).toBe(true);
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("stories") && /story 1\b/.test(l))).toBe(true);
  expect(r.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const p = project(two, 2);
  put(p, validTwo);
  const missing = await run(p, "export", "no-such-spec.md");
  console.log("26.5 missing spec:", JSON.stringify(missing));
  expect(`${missing.out}${missing.err}`.toLowerCase()).toMatch(/spec/);
  expect(`${missing.out}${missing.err}`).toContain("no-such-spec.md");
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad-spec.md"), "# Spec\n\n## Stories\n\n1. one\n");
  const noHeading = await run(p, "export", "bad-spec.md");
  console.log("26.5 no heading:", JSON.stringify(noHeading));
  expect(noHeading.code).toBe(2);
  const badRoot = await run(p, "no-such-root");
  console.log("26.5 bad root:", JSON.stringify(badRoot));
  expect(badRoot.code).toBe(2);
  const noRoot = await p.werk(["ticket-check", "tickets", "--spec", "spec.md"]);
  console.log("26.5 no root:", JSON.stringify(noRoot));
  expect(noRoot.code).toBe(2);
});

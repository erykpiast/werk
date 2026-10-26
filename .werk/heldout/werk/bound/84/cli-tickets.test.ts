import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";
import { card, seed } from "./cli-helpers.ts";

const spec = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a user I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nNone.\n`;

const ticket = (title: string | null, cites: string, blocked: string, stories: string, build = "Build the slice.", checks = "- `make test`") =>
  `${title === null ? "" : `title: ${title}\n`}cites: ${cites}
blocked_by: ${blocked}
stories: ${stories}
touches: the map view

## What to build

${build}

## Acceptance criteria

- [ ] The thing works.

## Checks

${checks}
`;

function setup(opts: { rootDecided: boolean; decided: string[]; ghost?: boolean; stories: number }): Project {
  const p = freshProject();
  seed(p, [
    card("top", "Top", opts.rootDecided ? { status: "decided" } : {}),
    ...opts.decided.map((id) => card(id, `Card ${id}`, { parent: "top", status: "decided" })),
    ...(opts.ghost
      ? [{ type: "node.proposed", actor: "agent", payload: { id: "ghosty", kind: "card", title: "Ghost one", parent: "top", status: "decided" } }]
      : []),
  ]);
  writeFileSync(join(p.dir, "spec.md"), spec(opts.stories));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}
const put = (p: Project, files: Record<string, string>) => {
  for (const [n, t] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", n), t);
};
const check = (p: Project, ...x: string[]) => p.werk(["ticket-check", "tickets", "--root", "top", "--spec", "spec.md", ...x]);

test("26.1 valid tickets pass", async () => {
  const p = setup({ rootDecided: true, decided: ["one", "two"], stories: 2 });
  put(p, {
    "01-a.md": ticket("First", "top, one", "", "1"),
    "02-b.md": ticket("Second", "#two", "1", "2", "Build the slice.", ""),
  });
  const r = await check(p);
  expect(r.code).toBe(0);
  const lines = r.out.split("\n").filter(Boolean);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/0 failures/);
});

test("26.2 file path and size", async () => {
  const p = setup({ rootDecided: true, decided: ["one", "two"], stories: 2 });
  const t1 = ticket("First", "top, one", "", "1").split("\n");
  put(p, { "01-a.md": t1.join("\n"), "02-b.md": ticket("Second", "two", "1", "2") });
  expect((await check(p)).code).toBe(0);
  const idx = t1.findIndex((l) => l === "Build the slice.");
  // put the path on line 9 of the file
  const lines = t1.filter((l) => l !== "Build the slice.");
  lines.splice(8, 0, "Edit src/loop.ts and the Makefile too.");
  put(p, {
    "01-a.md": lines.join("\n"),
    "02-b.md": ticket("Second", "two", "1", "2", `Build it. ${"pad ".repeat(1100)}`),
  });
  expect(idx).toBeGreaterThan(0);
  const r = await check(p);
  expect(r.code).toBe(1);
  const out = r.out.split("\n");
  const a = out.find((l) => l.startsWith("01-a.md"));
  expect(a).toContain("no-file-paths");
  expect(a).toContain("src/loop.ts");
  expect(a).toContain("line 9");
  expect(out.filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(out.find((l) => l.startsWith("02-b.md"))).toContain("size");
  expect(r.out).toMatch(/\d+ failures/);
});

test("26.3 set checks", async () => {
  const p = setup({ rootDecided: true, decided: ["one", "two"], ghost: true, stories: 3 });
  put(p, {
    "01-a.md": ticket("First", "top, one", "", "1"),
    "02-b.md": ticket("Second", "top", "3", "2"),
    "03-c.md": ticket("Third", "top", "2", "2"),
  });
  const r = await check(p);
  expect(r.code).toBe(1);
  const out = r.out.split("\n");
  const cited = out.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited).toHaveLength(1);
  expect(cited[0]).toContain("two");
  const st = out.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(st).toHaveLength(1);
  expect(st[0]).toContain("3");
  const cyc = out.find((l) => l.includes("blocked_by") && l.includes("cycle"));
  expect(cyc).toContain("02-b.md");
  expect(cyc).toContain("03-c.md");
  expect(out.filter((l) => l.includes("ghosty"))).toEqual([]);
});

test("26.4 ticket with no title", async () => {
  const p = setup({ rootDecided: false, decided: ["one"], stories: 1 });
  put(p, { "01-a.md": ticket(null, "one", "", "1") });
  const r = await check(p);
  expect(r.code).toBe(1);
  const out = r.out.split("\n").filter(Boolean);
  const own = out.filter((l) => l.startsWith("01-a.md"));
  expect(own).toHaveLength(1);
  expect(own[0]).toContain("title");
  const set = out.filter((l) => l.startsWith("ticket set"));
  expect(set.some((l) => l.includes("one") && l.includes("cards-cited"))).toBe(true);
  expect(set.some((l) => l.includes("stories") && /story 1|1/.test(l))).toBe(true);
});

test("26.5 malformed calls exit 2", async () => {
  const p = setup({ rootDecided: true, decided: ["one"], stories: 1 });
  put(p, { "01-a.md": ticket("First", "top, one", "", "1") });
  const a = await p.werk(["ticket-check", "tickets", "--root", "top", "--spec", "missing.md"]);
  expect(a.code).toBe(2);
  expect(a.out + a.err).toMatch(/spec/);
  expect(a.out + a.err).toMatch(/no spec file|missing/);
  writeFileSync(join(p.dir, "nostories.md"), "# Spec\n\n1. A line.\n");
  expect((await p.werk(["ticket-check", "tickets", "--root", "top", "--spec", "nostories.md"])).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--root", "nope", "--spec", "spec.md"])).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--spec", "spec.md"])).code).toBe(2);
});

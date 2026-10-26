import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, freshProject, seed } from "./d-lib.ts";
import type { Project } from "../src/test/project.ts";

const spec = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want story ${i + 1}.`).join("\n")}\n\n## Seams\n\nx\n`;
const ticket = (o: { title?: string; cites: string; blocked?: string; stories: string; line9?: string; checks?: string }) =>
  [
    ...(o.title === undefined ? [] : [`title: ${o.title}`]),
    `cites: ${o.cites}`,
    `blocked_by: ${o.blocked ?? ""}`,
    `stories: ${o.stories}`,
    "touches: map view",
    "",
    "## What to build",
    "",
    o.line9 ?? "A person opens a card and presses reopen.",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] It shows.",
    "",
    "## Checks",
    "",
    o.checks ?? "- `make test`",
    "",
  ].join("\n");

function setup(opts: { ghost?: boolean; stories?: number } = {}): Project {
  const p = freshProject();
  seed(p, [
    card("rt", undefined),
    card("one", "rt"),
    card("two", "rt"),
    ...(opts.ghost ? [{ type: "node.proposed", payload: { id: "gh", kind: "card", title: "Ghost", parent: "rt" } }, { type: "node.decided", payload: { id: "gh" } }] : []),
  ]);
  writeFileSync(join(p.dir, "spec.md"), spec(opts.stories ?? 2));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}
const put = (p: Project, files: Record<string, string>) => {
  for (const [n, t] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", n), t);
};
const check = (p: Project, ...a: string[]) => p.werk(["ticket-check", "tickets", "--root", "rt", "--spec", "spec.md", ...a]);

const validFiles = {
  "01-a.md": ticket({ title: "First", cites: "rt, one", stories: "1" }),
  "02-b.md": ticket({ title: "Second", cites: "#two", blocked: "1", stories: "2", checks: "" }),
};

test("26.1 valid tickets pass", async () => {
  const p = setup();
  put(p, validFiles);
  const r = await check(p);
  console.log(r);
  expect(r.code).toBe(0);
  const lines = r.out.trim().split("\n");
  expect(lines.length).toBe(1);
  expect(lines[0]).toMatch(/\b0 failures\b/);
});

test("26.2 file path and size", async () => {
  const p = setup();
  put(p, {
    "01-a.md": ticket({ title: "First", cites: "rt, one", stories: "1", line9: "Edit src/loop.ts and the Makefile." }),
    "02-b.md": ticket({ title: "Second", cites: "#two", blocked: "1", stories: "2", line9: `Text ${"pad ".repeat(1100)}` }),
  });
  const r = await check(p);
  console.log(r.out);
  expect(r.code).toBe(1);
  const lines = r.out.split("\n");
  expect(lines.some((l) => l.startsWith("01-a.md") && l.includes("no-file-paths") && l.includes("src/loop.ts") && l.includes("line 9"))).toBe(true);
  expect(lines.filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(lines.some((l) => l.startsWith("02-b.md") && l.includes("size"))).toBe(true);
  expect(r.out).toMatch(/failures/);
});

test("26.3 set checks", async () => {
  const p = setup({ ghost: true, stories: 3 });
  put(p, {
    "01-a.md": ticket({ title: "First", cites: "rt, one", stories: "1" }),
    "02-b.md": ticket({ title: "Second", cites: "one", blocked: "3", stories: "2" }),
    "03-c.md": ticket({ title: "Third", cites: "one", blocked: "2", stories: "2" }),
  });
  const r = await check(p);
  console.log(r.out);
  expect(r.code).toBe(1);
  const set = r.out.split("\n").filter((l) => l.startsWith("ticket set"));
  expect(set.filter((l) => l.includes("cards-cited") && l.includes("two")).length).toBe(1);
  expect(set.filter((l) => l.includes("stories") && l.includes("3")).length).toBeGreaterThanOrEqual(1);
  expect(r.out.split("\n").some((l) => l.includes("blocked_by") && l.includes("02-b.md") && l.includes("03-c.md"))).toBe(true);
  expect(r.out).not.toContain("gh");
});

test("26.4 no title", async () => {
  const p = freshProject();
  seed(p, [card("rt"), card("one", "rt")]);
  writeFileSync(join(p.dir, "spec.md"), spec(1));
  mkdirSync(join(p.dir, "tickets"));
  put(p, { "01-a.md": ticket({ cites: "one", stories: "1" }) });
  const r = await check(p);
  console.log(r.out);
  expect(r.code).toBe(1);
  const lines = r.out.split("\n");
  const own = lines.filter((l) => l.startsWith("01-a.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain("title");
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("one"))).toBe(true);
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("stories"))).toBe(true);
});

test("26.5 malformed calls exit 2", async () => {
  const p = setup();
  put(p, validFiles);
  const miss = await p.werk(["ticket-check", "tickets", "--root", "rt", "--spec", "nope.md"]);
  console.log(miss);
  expect(miss.code).toBe(2);
  expect(miss.out + miss.err).toMatch(/spec/i);
  expect(miss.out + miss.err).toMatch(/no spec file/i);
  writeFileSync(join(p.dir, "nohead.md"), "# Spec\n\nnothing\n");
  expect((await p.werk(["ticket-check", "tickets", "--root", "rt", "--spec", "nohead.md"])).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--root", "zzz", "--spec", "spec.md"])).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--spec", "spec.md"])).code).toBe(2);
});

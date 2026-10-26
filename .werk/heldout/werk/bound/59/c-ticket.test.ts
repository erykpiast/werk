// Held-out steps 26.1-26.5: werk ticket-check.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const spec = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nCLI.\n`;

type T = { title?: string; cites: string; blocked: string; stories: string; extra?: string; checks?: string };
const ticket = (t: T) =>
  `${t.title === undefined ? "" : `title: ${t.title}\n`}cites: ${t.cites}
blocked_by: ${t.blocked}
stories: ${t.stories}
touches: map view

## What to build

A person does a thing in the map.
It shows the result.
More words follow here.${t.extra ?? ""}

## Acceptance criteria

- [ ] The thing shows.

## Checks
${t.checks ?? ""}`;

function project(cards: { id: string; parent?: string; ghost?: boolean }[], stories: number): Project {
  const p = freshProject();
  const ev: object[] = [];
  for (const c of cards) {
    ev.push({
      type: c.ghost ? "node.proposed" : "node.added",
      payload: { id: c.id, kind: "card", title: c.id, ...(c.parent ? { parent: c.parent } : {}) },
    });
    ev.push({ type: "node.decided", payload: { id: c.id } });
  }
  const log = ev.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e }));
  appendFileSync(join(p.dir, ".werk", "log.jsonl"), `${log.join("\n")}\n`);
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}
const put = (p: Project, files: Record<string, string>) => {
  for (const [n, t] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", n), t);
};
const check = (p: Project, root = "root", specFile = "spec.md") =>
  p.werk(["ticket-check", "tickets", "--root", root, "--spec", specFile]);

const twoCards = [{ id: "root" }, { id: "alpha", parent: "root" }, { id: "beta", parent: "root" }];
const validTwo = () => ({
  "01-first.md": ticket({ title: "First slice", cites: "root, alpha", blocked: "", stories: "1", checks: "\n- `make test`\n" }),
  "02-second.md": ticket({ title: "Second slice", cites: "#beta", blocked: "1", stories: "2" }),
});

test("26.1 a folder of valid tickets gets a clean pass", async () => {
  const p = project(twoCards, 2);
  put(p, validTwo());
  const r = await check(p);
  const outLines = r.out.trimEnd().split("\n");
  expect(outLines.length).toBe(1);
  expect(outLines.at(-1)).toMatch(/\b0 failures\b/);
  expect(r.code).toBe(0);
});

test("26.2 a file path and an oversized ticket each fail with ticket and place", async () => {
  const p = project(twoCards, 2);
  const files = validTwo();
  put(p, files);
  expect((await check(p)).code).toBe(0);
  const first = files["01-first.md"].split("\n");
  // Line 9 of the file is in the What to build section.
  expect(first[6]).toBe("## What to build");
  first[8] = "Change src/loop.ts so the thing runs, and the Makefile target too.";
  const second = files["02-second.md"].replace("More words follow here.", `More words follow here. ${"pad ".repeat(1100)}`);
  expect(second.length).toBeGreaterThan(4000);
  put(p, { "01-first.md": first.join("\n"), "02-second.md": second });
  const r = await check(p);
  const ls = r.out.trimEnd().split("\n");
  const fails = ls.slice(0, -1);
  const fp = fails.find((l) => l.startsWith("01-first.md") && l.includes("no-file-paths"));
  expect(fp).toBeDefined();
  expect(fp).toContain("src/loop.ts");
  expect(fp).toMatch(/line 9\b/);
  expect(fails.filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(fails.find((l) => l.startsWith("02-second.md") && l.includes("size"))).toBeDefined();
  expect(ls.at(-1)).toMatch(/[1-9]\d* failures/);
  expect(r.code).toBe(1);
});

test("26.3 set checks report an uncited card, a missing story and a cycle, but not a ghost", async () => {
  const p = project([...twoCards, { id: "ghosty", parent: "root", ghost: true }], 3);
  put(p, {
    "01-a.md": ticket({ title: "A", cites: "root", blocked: "", stories: "1" }),
    "02-b.md": ticket({ title: "B", cites: "alpha", blocked: "3", stories: "2" }),
    "03-c.md": ticket({ title: "C", cites: "alpha", blocked: "2", stories: "1" }),
  });
  const r = await check(p);
  const ls = r.out.split("\n");
  const cited = ls.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toContain("beta");
  const st = ls.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(st.length).toBe(1);
  expect(st[0]).toContain("story 3");
  const cyc = ls.find((l) => l.includes("blocked_by") && l.includes("cycle"));
  expect(cyc).toBeDefined();
  expect(cyc).toContain("02-b.md");
  expect(cyc).toContain("03-c.md");
  expect(r.out).not.toContain("ghosty");
  expect(r.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, and its cites do not count", async () => {
  const p = project([{ id: "root" }, { id: "alpha", parent: "root" }], 1);
  put(p, { "01-x.md": ticket({ cites: "root, alpha", blocked: "", stories: "1" }) });
  const r = await check(p);
  const ls = r.out.split("\n").filter(Boolean);
  const own = ls.filter((l) => l.startsWith("01-x.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain("title");
  expect(ls.find((l) => l.startsWith("ticket set") && l.includes("alpha"))).toBeDefined();
  expect(ls.find((l) => l.startsWith("ticket set") && l.includes("story 1"))).toBeDefined();
  expect(r.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const p = project(twoCards, 2);
  put(p, validTwo());
  const missing = await check(p, "root", "nope.md");
  expect(`${missing.out}${missing.err}`).toMatch(/spec/i);
  expect(`${missing.out}${missing.err}`).toContain("nope.md");
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad.md"), "# Spec\n\n1. one\n");
  expect((await check(p, "root", "bad.md")).code).toBe(2);
  expect((await check(p, "nowhere")).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--spec", "spec.md"])).code).toBe(2);
});

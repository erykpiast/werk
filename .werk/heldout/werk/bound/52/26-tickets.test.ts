import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, decided, project, seed, type Project } from "./helpers.ts";

const spec = (n: number) =>
  `# Spec: things\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nThe command line.\n`;

const ticket = (o: { title?: string; cites: string; blocked: string; stories: string; build?: string; checks?: string }) =>
  `${o.title === undefined ? "" : `title: ${o.title}\n`}cites: ${o.cites}
blocked_by: ${o.blocked}
stories: ${o.stories}
touches: map view, decision log

## What to build

${o.build ?? "A person opens a card and sees the thing."}

## Acceptance criteria

- [ ] The thing shows in the map.

## Checks
${o.checks ?? ""}`;

function setup(p: Project, stories: number, files: Record<string, string>): void {
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", name), text);
}

const check = (p: Project, root = "rt", specFile = "spec.md") =>
  p.werk(["ticket-check", "tickets", "--root", root, "--spec", specFile]);

function twoDecided(p: Project): void {
  seed(p, [card("rt", "Root"), card("c-one", "One", { parent: "rt" }), card("c-two", "Two", { parent: "rt" }), decided("c-one"), decided("c-two")]);
}

const validFiles = {
  "01-first.md": ticket({ title: "First slice", cites: "rt, c-one", blocked: "", stories: "1", checks: "\n- `make test`\n" }),
  "02-second.md": ticket({ title: "Second slice", cites: "#c-two", blocked: "1", stories: "2", checks: "\n" }),
};

test("26.1 a folder of valid hand-written tickets gets a clean pass", async () => {
  const p = project();
  twoDecided(p);
  setup(p, 2, validFiles);
  const run = await check(p);
  const ls = run.out.split("\n").filter((l) => l !== "");
  expect(ls.length).toBe(1);
  expect(ls.at(-1)).toMatch(/\b0 failures\b/);
  expect(run.code).toBe(0);
});

test("26.2 a file path and an oversized ticket are each named with their ticket and place", async () => {
  const p = project();
  twoDecided(p);
  setup(p, 2, validFiles);
  expect((await check(p)).code).toBe(0);
  const first = validFiles["01-first.md"].split("\n");
  expect(first[8]).toBe("A person opens a card and sees the thing.");
  first[8] = "Change src/loop.ts so the thing shows, and the Makefile target.";
  const second = validFiles["02-second.md"].replace("sees the thing.", `sees the thing. ${"pad ".repeat(1100)}`);
  setup(p, 2, { "01-first.md": first.join("\n"), "02-second.md": second });
  const run = await check(p);
  const ls = run.out.split("\n").filter((l) => l !== "");
  const failures = ls.slice(0, -1);
  const path = failures.find((l) => l.startsWith("01-first.md") && l.includes("no-file-paths"));
  expect(path).toBeDefined();
  expect(path).toContain("src/loop.ts");
  expect(path).toContain("line 9");
  expect(failures.filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(failures.find((l) => l.startsWith("02-second.md") && l.includes("size"))).toBeDefined();
  expect(ls.at(-1)).toMatch(new RegExp(`\\b${failures.length} failures\\b`));
  expect(run.code).toBe(1);
});

test("26.3 the set checks report an uncited card, a missing story and a blocker cycle, but not a ghost", async () => {
  const p = project();
  twoDecided(p);
  seed(p, [{ type: "node.proposed", payload: { id: "c-ghost", kind: "card", title: "Ghost", parent: "rt" } }]);
  setup(p, 3, {
    "01-a.md": ticket({ title: "A", cites: "c-one", blocked: "", stories: "1" }),
    "02-b.md": ticket({ title: "B", cites: "c-one", blocked: "3", stories: "2" }),
    "03-c.md": ticket({ title: "C", cites: "c-one", blocked: "2", stories: "1" }),
  });
  const run = await check(p);
  const ls = run.out.split("\n");
  const cited = ls.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toContain("c-two");
  const stories = ls.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories.length).toBe(1);
  expect(stories[0]).toMatch(/story 3/);
  const cycle = ls.find((l) => l.includes("blocked_by") && l.includes("cycle"));
  expect(cycle).toBeDefined();
  expect(cycle).toContain("02-b.md");
  expect(cycle).toContain("03-c.md");
  expect(run.out).not.toContain("c-ghost");
  expect(run.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, and its cites do not count for the set", async () => {
  const p = project();
  seed(p, [card("rt", "Root"), card("c-one", "One", { parent: "rt" }), decided("c-one")]);
  setup(p, 1, { "01-untitled.md": ticket({ cites: "c-one", blocked: "", stories: "1" }) });
  const run = await check(p);
  const ls = run.out.split("\n").filter((l) => l !== "");
  const own = ls.filter((l) => l.startsWith("01-untitled.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain("title");
  expect(own[0]).not.toMatch(/: (shape|size|what-to-build|acceptance|no-file-paths|make-targets|touches):/);
  expect(ls.find((l) => l.startsWith("ticket set") && l.includes("c-one"))).toBeDefined();
  expect(ls.find((l) => l.startsWith("ticket set") && /story 1\b/.test(l))).toBeDefined();
  expect(run.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const p = project();
  seed(p, [card("rt", "Root"), card("c-one", "One", { parent: "rt" }), decided("c-one")]);
  setup(p, 1, { "01-a.md": ticket({ title: "A", cites: "c-one", blocked: "", stories: "1" }) });
  const missing = await check(p, "rt", "nope.md");
  expect(`${missing.out}${missing.err}`).toMatch(/spec/i);
  expect(`${missing.out}${missing.err}`).toMatch(/no spec file|missing|not exist|nope\.md/i);
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bare.md"), "# Spec\n\n1. A line.\n");
  expect((await check(p, "rt", "bare.md")).code).toBe(2);
  expect((await check(p, "not-a-card")).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--spec", "spec.md"])).code).toBe(2);
});

// Held-out steps 26.1-26.5: `werk ticket-check` at the command line.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../../src/test/project.ts";

const spec = (stories: number[]) =>
  `# Spec\n\n## User stories\n\n${stories.map((n) => `${n}. As a person, I want thing ${n}.`).join("\n")}\n\n## Seams\n\nCLI.\n`;

const ticket = (o: {
  title?: string;
  cites: string;
  blocked: string;
  stories: string;
  extra?: string;
  checks?: string;
}) =>
  `${o.title === undefined ? "" : `title: ${o.title}\n`}cites: ${o.cites}
blocked_by: ${o.blocked}
stories: ${o.stories}
touches: map view

## What to build

A person opens the card and acts on it.${o.extra ?? ""}

## Acceptance criteria

- [ ] The card shows the result.

## Checks
${o.checks ?? ""}`;

function setup(
  cards: { id: string; parent?: string; ghost?: boolean; decided?: boolean }[],
  stories: number[],
): Project {
  const p = freshProject();
  const events: object[] = [];
  for (const c of cards)
    events.push({
      type: c.ghost ? "node.proposed" : "node.added",
      payload: { id: c.id, kind: "card", title: c.id, ...(c.parent ? { parent: c.parent } : {}) },
    });
  for (const c of cards) if (c.decided !== false) events.push({ type: "node.decided", payload: { id: c.id } });
  const log = events.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e }));
  appendFileSync(join(p.dir, ".werk", "log.jsonl"), `${log.join("\n")}\n`);
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}
const put = (p: Project, files: Record<string, string>) => {
  for (const [n, t] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", n), t);
};
const run = (p: Project, ...args: string[]) => p.werk(["ticket-check", "tickets", ...args]);

test("26.1 valid hand-written tickets pass clean", async () => {
  const p = setup([{ id: "root" }, { id: "card-a", parent: "root" }, { id: "card-b", parent: "root" }], [1, 2]);
  put(p, {
    "01-a.md": ticket({
      title: "First slice",
      cites: "root, card-a",
      blocked: "",
      stories: "1",
      checks: "\n- `make test`\n",
    }),
    "02-b.md": ticket({ title: "Second slice", cites: "#card-b", blocked: "1", stories: "2", checks: "" }),
  });
  const r = await run(p, "--root", "root", "--spec", "spec.md");
  console.log(JSON.stringify(r));
  const lines = r.out.trim().split("\n");
  expect(lines.length).toBe(1);
  expect(lines.at(-1)).toMatch(/ 0 failures/);
  expect(r.code).toBe(0);
});

const base = () => ({
  "01-a.md": ticket({
    title: "First slice",
    cites: "root, card-a",
    blocked: "",
    stories: "1",
    checks: "\n- `make test`\n",
  }),
  "02-b.md": ticket({
    title: "Second slice",
    cites: "card-b",
    blocked: "1",
    stories: "2",
    checks: "\n- `make test`\n",
  }),
});

test("26.2 a file path and an oversized ticket", async () => {
  const p = setup([{ id: "root" }, { id: "card-a", parent: "root" }, { id: "card-b", parent: "root" }], [1, 2]);
  const files = base();
  put(p, files);
  expect((await run(p, "--root", "root", "--spec", "spec.md")).code).toBe(0);
  const first = files["01-a.md"].split("\n");
  // Lines 8.. of the What to build section: heading at line 6, blank at 7, text at 8.
  first.splice(8, 0, "Change src/loop.ts so the loop runs, and the Makefile target.");
  expect(first[8]).toContain("src/loop.ts");
  const second = files["02-b.md"].replace("acts on it.", `acts on it. ${"pad ".repeat(1100)}`);
  expect(second.length).toBeGreaterThan(4000);
  put(p, { "01-a.md": first.join("\n"), "02-b.md": second });
  const r = await run(p, "--root", "root", "--spec", "spec.md");
  console.log(r.out);
  const lines = r.out.trim().split("\n");
  const failures = lines.slice(0, -1);
  expect(
    failures.some(
      (l) => l.startsWith("01-a.md") && l.includes("no-file-paths") && l.includes("src/loop.ts") && /line 9\b/.test(l),
    ),
  ).toBe(true);
  expect(failures.filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(failures.some((l) => l.startsWith("02-b.md") && l.includes("size"))).toBe(true);
  expect(lines.at(-1)).toMatch(new RegExp(` ${failures.length} failures?`));
  expect(r.code).toBe(1);
});

test("26.3 set checks: uncited card, missing story, blocker cycle, no ghost", async () => {
  const p = setup(
    [
      { id: "root" },
      { id: "card-a", parent: "root" },
      { id: "card-b", parent: "root" },
      { id: "card-ghost", parent: "root", ghost: true },
    ],
    [1, 2, 3],
  );
  put(p, {
    "01-a.md": ticket({ title: "One", cites: "root, card-a", blocked: "", stories: "1", checks: "\n- `make test`\n" }),
    "02-b.md": ticket({ title: "Two", cites: "card-a", blocked: "3", stories: "2", checks: "\n- `make test`\n" }),
    "03-c.md": ticket({ title: "Three", cites: "root", blocked: "2", stories: "1", checks: "\n- `make test`\n" }),
  });
  const r = await run(p, "--root", "root", "--spec", "spec.md");
  console.log(r.out);
  const lines = r.out.trim().split("\n");
  const cited = lines.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toContain("card-b");
  const stories = lines.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories.length).toBe(1);
  expect(stories[0]).toContain("3");
  const cycle = lines.find(
    (l) => l.includes("blocked_by") && l.includes("2") && l.includes("3") && !l.includes("cards-cited"),
  );
  expect(cycle).toBeDefined();
  expect(lines.filter((l) => l.includes("card-ghost"))).toEqual([]);
  expect(r.code).toBe(1);
});

test("26.4 a ticket with no title fails alone and its cites do not count", async () => {
  const p = setup([{ id: "root" }, { id: "card-a", parent: "root" }], [1]);
  put(p, { "01-a.md": ticket({ cites: "root, card-a", blocked: "", stories: "1", checks: "\n- `make test`\n" }) });
  const r = await run(p, "--root", "root", "--spec", "spec.md");
  console.log(r.out);
  const lines = r.out.trim().split("\n");
  const own = lines.filter((l) => l.startsWith("01-a.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain("title");
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("card-a"))).toBe(true);
  expect(lines.some((l) => l.startsWith("ticket set") && /story 1|stories/.test(l) && l.includes("1"))).toBe(true);
  expect(r.code).toBe(1);
});

test("26.5 a malformed call exits 2", async () => {
  const p = setup([{ id: "root" }, { id: "card-a", parent: "root" }], [1]);
  put(p, { "01-a.md": ticket({ title: "One", cites: "root, card-a", blocked: "", stories: "1" }) });
  const missing = await run(p, "--root", "root", "--spec", "nope.md");
  console.log(JSON.stringify(missing));
  expect(`${missing.out}${missing.err}`).toMatch(/spec/i);
  expect(`${missing.out}${missing.err}`).toContain("nope.md");
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad.md"), "# Spec\n\nNo stories here.\n");
  expect((await run(p, "--root", "root", "--spec", "bad.md")).code).toBe(2);
  expect((await run(p, "--root", "no-such-root", "--spec", "spec.md")).code).toBe(2);
  expect((await run(p, "--spec", "spec.md")).code).toBe(2);
});

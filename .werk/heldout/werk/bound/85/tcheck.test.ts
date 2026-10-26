import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";
import { card, decided, proposed, root, seed } from "./h.ts";

const spec = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nNone.\n`;
const ticket = (title: string | null, cites: string, blocked: string, stories: string, extra = "") =>
  `${title === null ? "" : `title: ${title}\n`}cites: ${cites}\nblocked_by: ${blocked}\nstories: ${stories}\ntouches: map view\n\n## What to build\n\nA person does a thing.${extra}\n\n## Acceptance criteria\n\n- [ ] It works.\n\n## Checks\n\n- \`make test\`\n`;

function setup(nStories: number, extraEvents: any[] = []): Project {
  const p = freshProject();
  seed(p, [
    { type: "node.added", payload: { id: "feat", kind: "card", title: "Feat", status: "decided", who: "me", no_basis: "x" } },
    decided("one", { parent: "feat", title: "One" }),
    ...extraEvents,
  ]);
  writeFileSync(join(p.dir, "spec.md"), spec(nStories));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}
const put = (p: Project, files: Record<string, string>) => {
  for (const [n, t] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", n), t);
};
const check = (p: Project, ...extra: string[]) => p.werk(["ticket-check", "tickets", "--root", "feat", "--spec", "spec.md", ...extra]);

test("26.1", async () => {
  const p = setup(2, [decided("two", { parent: "feat", title: "Two" })]);
  put(p, {
    "01-a.md": ticket("First ticket", "feat, one", "", "1"),
    "02-b.md": ticket("Second ticket", "#two", "1", "2").replace("## Checks\n\n- `make test`\n", "## Checks\n"),
  });
  const r = await check(p);
  console.log("26.1:", JSON.stringify(r));
  expect(r.code).toBe(0);
  const outLines = r.out.trim().split("\n");
  expect(outLines.length).toBe(1);
  expect(outLines[0]).toMatch(/0 failures/);
});

test("26.2", async () => {
  const p = setup(2, [decided("two", { parent: "feat", title: "Two" })]);
  put(p, {
    "01-a.md": ticket("First ticket", "feat, one", "", "1", " Edit src/loop.ts and the Makefile."),
    "02-b.md": ticket("Second ticket", "two", "1", "2", ` ${"pad ".repeat(1100)}`),
  });
  const r = await check(p);
  console.log("26.2:", JSON.stringify(r));
  expect(r.code).toBe(1);
  const l1 = r.out.split("\n").find((l) => l.startsWith("01-a.md"))!;
  expect(l1).toBeDefined();
  expect(l1).toMatch(/file/i);
  expect(l1).toContain("src/loop.ts");
  expect(l1).toMatch(/\b9\b/);
  expect(r.out).not.toContain("Makefile");
  const l2 = r.out.split("\n").find((l) => l.startsWith("02-b.md"))!;
  expect(l2).toBeDefined();
  expect(l2).toMatch(/size|chars|long/i);
  expect(r.out).toMatch(/[1-9]\d* (own-check )?failures?|failures/);
});

test("26.3", async () => {
  const p = setup(3, [decided("two", { parent: "feat", title: "Two card" }), proposed("ghost", { parent: "feat", title: "Ghost card", status: "decided" })]);
  put(p, {
    "01-a.md": ticket("T one", "feat, one", "", "1"),
    "02-b.md": ticket("T two", "feat, one", "3", "2"),
    "03-c.md": ticket("T three", "feat, one", "2", "2"),
  });
  const r = await check(p);
  console.log("26.3:", r.out);
  expect(r.code).toBe(1);
  const set = r.out.split("\n").filter((l) => l.startsWith("ticket set"));
  expect(set.filter((l) => l.includes("two")).length).toBe(1);
  expect(set.filter((l) => /\b3\b/.test(l) && /stor/i.test(l)).length).toBeGreaterThanOrEqual(1);
  expect(r.out).toMatch(/blocked_by/);
  expect(r.out).not.toMatch(/ghost/);
  const cyc = r.out.split("\n").find((l) => /blocked_by/.test(l))!;
  expect(cyc).toMatch(/2/);
  expect(cyc).toMatch(/3/);
});

test("26.4", async () => {
  const p = setup(1);
  put(p, { "01-x.md": ticket(null, "one", "", "1") });
  const r = await check(p);
  console.log("26.4:", r.out);
  expect(r.code).toBe(1);
  const own = r.out.split("\n").filter((l) => l.startsWith("01-x.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toMatch(/title/);
  const set = r.out.split("\n").filter((l) => l.startsWith("ticket set"));
  expect(set.some((l) => l.includes("one"))).toBe(true);
  expect(set.some((l) => /stor/i.test(l) && /\b1\b/.test(l))).toBe(true);
});

test("26.5", async () => {
  const p = setup(1);
  put(p, { "01-a.md": ticket("T", "feat, one", "", "1") });
  let r = await p.werk(["ticket-check", "tickets", "--root", "feat", "--spec", "nope.md"]);
  expect(r.code).toBe(2);
  expect(r.err + r.out).toMatch(/spec/i);
  expect(r.err + r.out).toMatch(/missing|no spec file|not exist|no such|cannot|can't|not found/i);
  writeFileSync(join(p.dir, "nostories.md"), "# Spec\n\nnothing\n");
  r = await p.werk(["ticket-check", "tickets", "--root", "feat", "--spec", "nostories.md"]);
  expect(r.code).toBe(2);
  r = await p.werk(["ticket-check", "tickets", "--root", "nosuch", "--spec", "spec.md"]);
  expect(r.code).toBe(2);
  r = await p.werk(["ticket-check", "tickets", "--spec", "spec.md"]);
  expect(r.code).toBe(2);
});

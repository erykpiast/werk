// Held-out steps 26.1-26.5: werk ticket-check on a folder of hand-written tickets.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { make, type P } from "./lib.ts";

const spec = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nThe command line.\n`;

type T = { title?: string; cites: string; blocked: string; stories: string; extra?: string; checks?: string };
const ticket = (t: T) =>
  `${t.title === undefined ? "" : `title: ${t.title}\n`}cites: ${t.cites}
blocked_by: ${t.blocked}
stories: ${t.stories}
touches: map view

## What to build

A person opens a decided card and presses reopen.${t.extra ?? ""}

## Acceptance criteria

- [ ] A reopened card shows as open in the map.

## Checks

${t.checks ?? ""}
`;

function setup(p: P, cards: { decided: string[]; ghost?: string[] }, stories: number): void {
  p.card("root", { title: "Root", status: "decided", who: "me" });
  for (const id of cards.decided) p.card(id, { title: `Card ${id}`, parent: "root", status: "decided", who: "me" });
  for (const id of cards.ghost ?? [])
    p.seed("node.proposed", { id, kind: "card", title: `Ghost ${id}`, parent: "root" });
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"), { recursive: true });
}

const put = (p: P, files: Record<string, string>) => {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", name), text);
};
const check = (p: P, ...args: string[]) => p.w("ticket-check", "tickets", ...args);

const VALID = {
  "01-one.md": ticket({ title: "First slice", cites: "root, one", blocked: "", stories: "1", checks: "- `make test`" }),
  "02-two.md": ticket({ title: "Second slice", cites: "#two", blocked: "1", stories: "2" }),
};

test("26.1 a folder of valid hand-written tickets gets a clean pass", async () => {
  const p = make();
  setup(p, { decided: ["one", "two"] }, 2);
  put(p, VALID);
  const r = await check(p, "--root", "root", "--spec", "spec.md");
  const lines = r.out.trimEnd().split("\n");
  expect(lines).toHaveLength(1);
  expect(lines.at(-1)).toMatch(/\b0 failures\b/);
  expect(r.code).toBe(0);
});

test("26.2 a file path and an oversized ticket are each named with ticket and place", async () => {
  const p = make();
  setup(p, { decided: ["one", "two"] }, 2);
  put(p, VALID);
  expect((await check(p, "--root", "root", "--spec", "spec.md")).code).toBe(0);
  const first = VALID["01-one.md"].split("\n");
  first[8] = "Edit src/loop.ts so the reopen runs, then the Makefile target.";
  const second = VALID["02-two.md"].replace("presses reopen.", `presses reopen. ${"pad ".repeat(1100)}`);
  expect(second.length).toBeGreaterThan(4000);
  put(p, { "01-one.md": first.join("\n"), "02-two.md": second });
  const r = await check(p, "--root", "root", "--spec", "spec.md");
  const lines = r.out.trimEnd().split("\n");
  const failures = lines.slice(0, -1);
  expect(
    failures.some(
      (l) =>
        l.startsWith("01-one.md") && l.includes("no-file-paths") && l.includes("src/loop.ts") && /line 9\b/.test(l),
    ),
  ).toBe(true);
  expect(failures.filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(failures.some((l) => l.startsWith("02-two.md") && l.includes("size"))).toBe(true);
  expect(lines.at(-1)).toMatch(new RegExp(`\\b${failures.length} failures?\\b`));
  expect(r.code).toBe(1);
});

test("26.3 the set checks report an uncited card, a missing story and a blocker cycle, not a ghost", async () => {
  const p = make();
  setup(p, { decided: ["one", "two"], ghost: ["ghosty"] }, 3);
  put(p, {
    "01-a.md": ticket({ title: "A", cites: "root", blocked: "", stories: "1" }),
    "02-b.md": ticket({ title: "B", cites: "one", blocked: "3", stories: "2" }),
    "03-c.md": ticket({ title: "C", cites: "one", blocked: "2", stories: "1" }),
  });
  const r = await check(p, "--root", "root", "--spec", "spec.md");
  const lines = r.out.split("\n");
  const cited = lines.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited).toHaveLength(1);
  expect(cited[0]).toContain("#two");
  const stories = lines.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories).toHaveLength(1);
  expect(stories[0]).toMatch(/\b3\b/);
  const cycle = lines.find((l) => l.includes("blocked_by") && l.includes("02-b.md") && l.includes("03-c.md"));
  expect(cycle).toBeDefined();
  expect(lines.filter((l) => l.includes("ghosty"))).toEqual([]);
  expect(r.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, and its cites do not count for the set", async () => {
  const p = make();
  setup(p, { decided: ["one"] }, 1);
  put(p, { "01-a.md": ticket({ cites: "root, one", blocked: "", stories: "1" }) });
  const r = await check(p, "--root", "root", "--spec", "spec.md");
  const lines = r.out.split("\n").filter(Boolean);
  const own = lines.filter((l) => l.startsWith("01-a.md"));
  expect(own).toHaveLength(1);
  expect(own[0]).toContain("title");
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("#one"))).toBe(true);
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("stories") && /\b1\b/.test(l))).toBe(true);
  expect(r.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const p = make();
  setup(p, { decided: ["one", "two"] }, 2);
  put(p, VALID);
  const missing = await check(p, "--root", "root", "--spec", "nope.md");
  expect(`${missing.out}${missing.err}`).toMatch(/spec/i);
  expect(`${missing.out}${missing.err}`).toMatch(/missing|not found|no such|no spec file|does not exist|cannot read/i);
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad.md"), "# Spec\n\n## Seams\n\nNone.\n");
  expect((await check(p, "--root", "root", "--spec", "bad.md")).code).toBe(2);
  expect((await check(p, "--root", "no-such-card", "--spec", "spec.md")).code).toBe(2);
  expect((await check(p, "--spec", "spec.md")).code).toBe(2);
});

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decided, ghost } from "../../src/map/mark-fixtures.ts";
import { ticket } from "../../src/tickets/fixtures.ts";
import { Ws } from "./helpers.ts";

let w: Ws;
beforeEach(() => {
  w = new Ws();
});
afterEach(() => w.dispose());

const put = (path: string, text: string) => {
  const full = join(w.project.dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const SPEC2 = "## User stories\n\n1. As a person, I want a.\n2. As a person, I want b.\n";
const under = (id: string) => ({ type: "edge.added", from: id, to: "root", link: "refines" });
const check = () => w.werk("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const lines = (s: string) => s.trim().split("\n");

test("30.1 a folder of correct tickets passes", async () => {
  w.seed([...decided("root"), ...decided("a"), under("a"), ...decided("b"), under("b")]);
  put("spec.md", SPEC2);
  put("tickets/01-a.md", ticket({ cites: "root, a", stories: "1", touches: "alpha" }));
  put("tickets/02-b.md", ticket({ cites: "b", stories: "2", blockedBy: "1", touches: "beta" }));
  const r = await check();
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(1);
  expect(out.at(-1)).toBe("2 tickets, 0 own-check failures, 0 failures, 3 decided cards, 2 stories");
});

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  w.seed(decided("root"));
  put("spec.md", "## User stories\n\n1. a\n2. b\n3. c\n");
  put("tickets/01-a.md", ticket({ cites: "root", stories: "1,2,3" }));
  // the path sits on line 12 of the file
  const second = ticket({ cites: "root", stories: "1", what: "Line a.\nLine b.\nLine c.\nSee src/loop.ts here." });
  put("tickets/02-b.md", second);
  put("tickets/03-c.md", ticket({ cites: "root", stories: "1", touches: null }));
  const lineOf = second.split("\n").findIndex((l) => l.includes("src/loop.ts")) + 1;
  const r = await check();
  expect(r.code).toBe(1);
  const out = lines(r.stdout);
  expect(out.find((l) => l.startsWith("02-b.md")) ?? "").toMatch(/no-file-paths/);
  expect(out.find((l) => l.startsWith("02-b.md")) ?? "").toContain(`src/loop.ts (line ${lineOf})`);
  expect(out.find((l) => l.startsWith("03-c.md")) ?? "").toMatch(/shape: touches/);
  expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(out.at(-1)).toMatch(/^3 tickets, 2 own-check failures/);
  expect(lineOf).toBe(12);
});

test("30.3 an uncited decided card fails the set, and a ghost does not count", async () => {
  w.seed([
    ...decided("root"),
    ...decided("one"), under("one"),
    ...decided("two"), under("two"),
    // a ghost: proposed and decided, never accepted
    ghost("phantom"), { type: "node.edited", id: "phantom", who: "me", noBasis: "t" },
    { type: "criterion.added", id: "phantom", form: "revisit" },
    { type: "node.decided", id: "phantom" }, under("phantom"),
  ]);
  put("spec.md", "## User stories\n\n1. a\n");
  put("tickets/01-a.md", ticket({ cites: "root, one", stories: "1" }));
  const r = await check();
  const out = lines(r.stdout);
  const set = out.filter((l) => l.startsWith("ticket set"));
  expect(set).toHaveLength(1);
  expect(set[0]).toContain("two");
  expect(r.stdout).not.toContain("phantom");
  expect(out.at(-1)).toContain("3 decided cards");
  expect(r.code).toBe(1);
});

test("30.4 a blocked_by cycle names only the tickets on it", async () => {
  w.seed(decided("root"));
  put("spec.md", "## User stories\n\n1. a\n");
  put("tickets/01-a.md", ticket({ cites: "root", stories: "1", blockedBy: "" }));
  put("tickets/02-b.md", ticket({ cites: "root", stories: "1", blockedBy: "3" }));
  put("tickets/03-c.md", ticket({ cites: "root", stories: "1", blockedBy: "2" }));
  put("tickets/04-d.md", ticket({ cites: "root", stories: "1", blockedBy: "3" }));
  const r = await check();
  const out = lines(r.stdout);
  expect(out.some((l) => l.startsWith("02-b.md: blocked_by"))).toBe(true);
  expect(out.some((l) => l.startsWith("03-c.md: blocked_by"))).toBe(true);
  expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(out.some((l) => l.startsWith("04-d.md"))).toBe(false);
  expect(r.code).toBe(1);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  w.seed(decided("root"));
  put("spec.md", "# Spec\n\nNo stories here.\n");
  put("tickets/01-a.md", ticket({ cites: "root", stories: "1" }));
  const r = await check();
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("User stories");
  expect(r.stdout).toBe("");
});

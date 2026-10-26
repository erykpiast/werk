import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";
import { ticket } from "../src/tickets/fixtures.ts";
import { decide, must, realCard, werk } from "./helpers.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const write = (path: string, text: string) => {
  mkdirSync(join(p.dir, path, ".."), { recursive: true });
  writeFileSync(join(p.dir, path), text);
};
const SPEC2 = "# Spec\n\n## User stories\n\n1. As a person, I want a.\n2. As a person, I want b.\n";
const check = () =>
  werk(p, "ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const lines = (text: string) => text.split("\n").filter((l) => l !== "");

/** A real, decided card that refines the root: decided first, then linked under it, so the open root is no basis problem. */
async function decidedUnderRoot(id: string, ghost = false) {
  if (ghost) {
    await must(p, "add", id, "--title", id, "--why", "w");
  } else await realCard(p, id);
  await decide(p, id);
  await must(p, "link", id, "root", "--type", "refines", "--why", "w");
}

test("30.1 a folder of correct tickets passes", async () => {
  await realCard(p, "root");
  await decidedUnderRoot("card-a");
  await decidedUnderRoot("card-b");
  write("spec.md", SPEC2);
  write("tickets/01-a.md", ticket({ cites: "card-a", stories: "1" }));
  write("tickets/02-b.md", ticket({ cites: "card-b", stories: "2", blockedBy: "1" }));
  const r = await check();
  const out = lines(r.stdout);
  expect(out).toHaveLength(1);
  expect(out[0]).toBe("2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories");
  expect(r.code).toBe(0);
});

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  await realCard(p, "root");
  write("spec.md", "## User stories\n\n1. a\n");
  write("tickets/01-a.md", ticket({ cites: "root" }));
  // The path sits on line 12 of the file: headers 1-5, blank 6, heading 7, blank 8, text from 9.
  write("tickets/02-b.md", ticket({ cites: "root", what: "one\ntwo\nthree\nEdit src/loop.ts now." }));
  write("tickets/03-c.md", ticket({ cites: "root", touches: null }));
  expect(readFileLine("tickets/02-b.md", 12)).toContain("src/loop.ts");
  const r = await check();
  const out = lines(r.stdout);
  const second = out.find((l) => l.startsWith("02-b.md"));
  expect(second).toContain("no-file-paths");
  expect(second).toContain("src/loop.ts");
  expect(second).toContain("line 12");
  const third = out.find((l) => l.startsWith("03-c.md"));
  expect(third).toContain("shape");
  expect(third).toContain("touches");
  expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(out[out.length - 1]).toMatch(/^3 tickets, 2 own-check failures/);
  expect(r.code).toBe(1);
});

function readFileLine(path: string, n: number): string {
  return require("node:fs").readFileSync(join(p.dir, path), "utf8").split("\n")[n - 1] ?? "";
}

test("30.3 an uncited decided card fails the set, a ghost does not count", async () => {
  await realCard(p, "root");
  await decidedUnderRoot("card-a");
  await decidedUnderRoot("card-b");
  await decidedUnderRoot("card-ghost", true);
  write("spec.md", SPEC2);
  write("tickets/01-a.md", ticket({ cites: "root, card-a", stories: "1" }));
  write("tickets/02-b.md", ticket({ cites: "root", stories: "2" }));
  const r = await check();
  const out = lines(r.stdout);
  const setLines = out.filter((l) => l.startsWith("ticket set"));
  expect(setLines).toHaveLength(1);
  expect(setLines[0]).toContain("card-b");
  expect(out.some((l) => l.includes("card-ghost"))).toBe(false);
  expect(out[out.length - 1]).toContain("2 decided cards");
  expect(r.code).toBe(1);
});

test("30.4 a blocked_by cycle names only the tickets on it", async () => {
  await realCard(p, "root");
  await decidedUnderRoot("card-a");
  write("spec.md", "## User stories\n\n1. a\n");
  write("tickets/01-a.md", ticket({ cites: "card-a, root", stories: "1" }));
  write("tickets/02-b.md", ticket({ cites: "card-a", stories: "1", blockedBy: "3" }));
  write("tickets/03-c.md", ticket({ cites: "card-a", stories: "1", blockedBy: "2" }));
  write("tickets/04-d.md", ticket({ cites: "card-a", stories: "1", blockedBy: "3" }));
  const r = await check();
  const out = lines(r.stdout);
  expect(out.some((l) => l.startsWith("02-b.md") && l.includes("blocked_by"))).toBe(true);
  expect(out.some((l) => l.startsWith("03-c.md") && l.includes("blocked_by"))).toBe(true);
  expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(out.some((l) => l.startsWith("04-d.md"))).toBe(false);
  expect(r.code).toBe(1);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  await realCard(p, "root");
  write("spec.md", "# Spec\n\nNothing here.\n");
  write("tickets/01-a.md", ticket({ cites: "root" }));
  const r = await check();
  expect(r.stderr).toContain("User stories");
  expect(r.stdout.trim()).toBe("");
  expect(r.code).toBe(2);
});

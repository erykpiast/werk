import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";
import { ticket } from "../src/tickets/fixtures.ts";
import { decided, link, problems, real, seed, werk } from "./lib.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const write = (path: string, text: string) => {
  mkdirSync(join(project.dir, path, ".."), { recursive: true });
  writeFileSync(join(project.dir, path), text);
};
const SPEC2 = "# Spec\n\n## User stories\n\n1. As a person, I want a.\n2. As a person, I want b.\n";
const check = () => werk(project, "ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const lines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");

/** An open root with two decided cards under it. A decided card cannot start under an open parent, so it is linked after. */
function rootWithTwo() {
  seed(project, [
    ...real("root", "Root card"),
    ...decided("c1", "Card one"),
    ...decided("c2", "Card two"),
    link("c1", "root", "refines"),
    link("c2", "root", "refines"),
  ]);
  expect(problems(project)).toEqual([]);
}

test("30.1 a folder of correct tickets passes", async () => {
  rootWithTwo();
  write("spec.md", SPEC2);
  write("tickets/01-a.md", ticket({ cites: "c1", stories: "1", blockedBy: "" }));
  write("tickets/02-b.md", ticket({ cites: "c2", stories: "2", blockedBy: "1" }));
  const r = await check();
  expect(lines(r.stdout)).toEqual([
    "2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories",
  ]);
  expect(r.code).toBe(0);
});

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  rootWithTwo();
  write("spec.md", "## User stories\n\n1. a\n2. b\n3. c\n");
  write("tickets/01-a.md", ticket({ cites: "c1", stories: "1" }));
  // the path sits on line 12 of the file
  write(
    "tickets/02-b.md",
    ticket({ cites: "c2", stories: "2", what: "First line.\nSecond line.\nThird line.\nEdit src/loop.ts now." }),
  );
  write("tickets/03-c.md", ticket({ stories: "3", touches: null }));
  const r = await check();
  const out = lines(r.stdout);
  const second = out.find((l) => l.startsWith("02-b.md"));
  expect(second).toBeDefined();
  expect(second).toContain("no-file-paths");
  expect(second).toContain("src/loop.ts");
  expect(second).toContain("line 12");
  const third = out.find((l) => l.startsWith("03-c.md"));
  expect(third).toBeDefined();
  expect(third).toContain("shape");
  expect(third).toContain("touches");
  expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(out.at(-1)).toContain("3 tickets, 2 own-check failures");
  expect(r.code).toBe(1);
});

test("30.3 an uncited decided card fails the set, and a ghost does not count", async () => {
  seed(project, [
    ...real("root", "Root card"),
    ...decided("c1", "Card one"),
    ...decided("c2", "Card two"),
    ...decided("ghost1", "Ghost card", { accept: false }),
    link("c1", "root", "refines"),
    link("c2", "root", "refines"),
    link("ghost1", "root", "refines"),
  ]);
  expect(problems(project)).toEqual([]);
  write("spec.md", SPEC2);
  write("tickets/01-a.md", ticket({ cites: "root", stories: "1" }));
  write("tickets/02-b.md", ticket({ cites: "c1", stories: "2" }));
  const r = await check();
  const out = lines(r.stdout);
  const setLine = out.filter((l) => l.startsWith("ticket set"));
  expect(setLine).toHaveLength(1);
  expect(setLine[0]).toContain("c2");
  expect(out.slice(0, -1).some((l) => l.includes("ghost1"))).toBe(false);
  expect(out.at(-1)).toContain("2 decided cards");
  expect(r.code).toBe(1);
});

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  seed(project, [...decided("root", "Root card")]);
  write("spec.md", "## User stories\n\n1. a\n2. b\n3. c\n4. d\n");
  write("tickets/01-a.md", ticket({ cites: "root", stories: "1", blockedBy: "" }));
  write("tickets/02-b.md", ticket({ cites: "root", stories: "2", blockedBy: "3" }));
  write("tickets/03-c.md", ticket({ cites: "root", stories: "3", blockedBy: "2" }));
  write("tickets/04-d.md", ticket({ cites: "root", stories: "4", blockedBy: "3" }));
  const r = await check();
  const out = lines(r.stdout).slice(0, -1);
  expect(out.some((l) => l.startsWith("02-b.md") && l.includes("blocked_by"))).toBe(true);
  expect(out.some((l) => l.startsWith("03-c.md") && l.includes("blocked_by"))).toBe(true);
  expect(out.some((l) => l.includes("01-a.md") || l.includes("04-d.md"))).toBe(false);
  expect(r.code).toBe(1);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  seed(project, [...real("root", "Root card")]);
  write("spec.md", "# Spec\n\nJust prose.\n");
  write("tickets/01-a.md", ticket({ cites: "", stories: "1" }));
  const r = await check();
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("User stories");
  expect(r.stdout.trim()).toBe("");
});

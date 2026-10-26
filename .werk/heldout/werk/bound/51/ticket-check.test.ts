import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";
import { ticket } from "../src/tickets/fixtures.ts";
import { decided, ghost, put, real, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());
const write = (path: string, text: string) => {
  mkdirSync(join(p.dir, path, ".."), { recursive: true });
  writeFileSync(join(p.dir, path), text);
};
const check = () => werk(p, "ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const AT = "2026-10-10T09:00:00.000Z";
const lines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");

/** root decided, then two decided children, then root reopened: children stay decided under an open root. */
function twoDecided() {
  put(
    p,
    decided("root", "Root"),
    decided("card-a", "Card A", { parent: "root" }),
    decided("card-b", "Card B", { parent: "root" }),
    { type: "node.reopened", id: "root", reason: "invalidated", at: AT },
  );
}

test("30.1 a folder of correct tickets passes", async () => {
  twoDecided();
  write("spec.md", "# Spec\n\n## User stories\n\n1. As a person, I want a.\n2. As a person, I want b.\n");
  write("tickets/01-a.md", ticket({ cites: "card-a", stories: "1", blockedBy: "" }));
  write("tickets/02-b.md", ticket({ cites: "card-b", stories: "2", blockedBy: "1" }));
  const r = await check();
  const out = lines(r.stdout);
  expect(out).toHaveLength(1);
  expect(out[0]).toBe("2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories");
  expect(r.code).toBe(0);
});

test("30.2 own-check failures name ticket, check and field", async () => {
  put(p, real("root", "Root"));
  write("spec.md", "## User stories\n\n1. a\n2. b\n3. c\n");
  write("tickets/01-a.md", ticket({ stories: "1" }));
  const filler = "A person presses it.\nIt works.\nIt keeps working.\nSee src/loop/run.ts for it.";
  write("tickets/02-b.md", ticket({ stories: "2", what: filler }));
  write("tickets/03-c.md", ticket({ stories: "3", touches: null }));
  const r = await check();
  const out = lines(r.stdout);
  const second = out.find((l) => l.startsWith("02-b.md"))!;
  expect(second).toContain("no-file-paths");
  expect(second).toContain("src/loop/run.ts");
  expect(second).toContain("12");
  const third = out.find((l) => l.startsWith("03-c.md"))!;
  expect(third).toContain("shape");
  expect(third).toContain("touches");
  expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(out.at(-1)).toMatch(/^3 tickets, 2 own-check failures/);
  expect(r.code).toBe(1);
});

test("30.3 an uncited decided card fails the set, a ghost does not count", async () => {
  put(
    p,
    decided("root", "Root"),
    decided("card-a", "Card A", { parent: "root" }),
    decided("card-b", "Card B", { parent: "root" }),
    ghost("card-g", "Ghost", { parent: "root", status: "decided" }),
    { type: "node.reopened", id: "root", reason: "invalidated", at: AT },
  );
  write("spec.md", "## User stories\n\n1. a\n2. b\n");
  write("tickets/01-a.md", ticket({ cites: "root", stories: "1" }));
  write("tickets/02-b.md", ticket({ cites: "card-a", stories: "2" }));
  const r = await check();
  const out = lines(r.stdout);
  const setLines = out.filter((l) => l.startsWith("ticket set"));
  expect(setLines).toHaveLength(1);
  expect(setLines[0]).toContain("card-b");
  expect(out.some((l) => l.includes("card-g"))).toBe(false);
  expect(out.at(-1)).toContain("2 decided cards");
  expect(r.code).toBe(1);
});

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  put(p, real("root", "Root"));
  write("spec.md", "## User stories\n\n1. a\n2. b\n3. c\n4. d\n");
  write("tickets/01-a.md", ticket({ stories: "1" }));
  write("tickets/02-b.md", ticket({ stories: "2", blockedBy: "3" }));
  write("tickets/03-c.md", ticket({ stories: "3", blockedBy: "2" }));
  write("tickets/04-d.md", ticket({ stories: "4", blockedBy: "3" }));
  const r = await check();
  const out = lines(r.stdout).filter((l) => l.includes("blocked_by"));
  expect(out.some((l) => l.startsWith("02-b.md"))).toBe(true);
  expect(out.some((l) => l.startsWith("03-c.md"))).toBe(true);
  const all = r.stdout;
  expect(all).not.toMatch(/^01-a\.md/m);
  expect(all).not.toMatch(/^04-d\.md/m);
  expect(r.code).toBe(1);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  put(p, real("root", "Root"));
  write("spec.md", "# Spec\n\nNo stories here.\n");
  write("tickets/01-a.md", ticket({}));
  const r = await check();
  expect(r.stderr).toContain("User stories");
  expect(r.stdout.trim()).toBe("");
  expect(r.code).toBe(2);
});

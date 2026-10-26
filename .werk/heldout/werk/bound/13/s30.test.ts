// 30.1 - 30.5: ticket-check on a folder of tickets.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decided, ghost, reopen } from "../src/map/mark-fixtures.ts";
import { ticket } from "../src/tickets/fixtures.ts";
import { useTools } from "./support.ts";

const t = useTools();
const write = (path: string, text: string) => {
  const full = join(t().project.dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const SPEC2 = "# Spec\n\n## User stories\n\n1. As a person, I want a.\n2. As a person, I want b.\n";
const check = () => t().werk("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const stdoutLines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");

function rootWithDecided(...ids: string[]) {
  // A decided card needs a decided parent, so the root is decided first and reopened after.
  t().seed(decided("root", { title: "Root" }), ...ids.map((id) => decided(id, { title: id, parent: "root" })), reopen("root", { reason: "invalidated" }));
}

test("30.1 a folder of correct tickets passes", async () => {
  rootWithDecided("c1", "c2");
  write("spec.md", SPEC2);
  write("tickets/01-first.md", ticket({ title: "First thing", cites: "c1", stories: "1" }));
  write("tickets/02-second.md", ticket({ title: "Second thing", cites: "c2", stories: "2", blockedBy: "1" }));
  const r = await check();
  const out = stdoutLines(r.stdout);
  expect(out, r.stderr).toHaveLength(1);
  expect(out[0]).toBe("2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories");
  expect(r.code).toBe(0);
});

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  rootWithDecided("c1");
  write("spec.md", "## User stories\n\n1. a\n");
  write("tickets/01-good.md", ticket({ title: "Good", cites: "c1", stories: "1" }));
  // The path sits on line 12 of the file.
  write("tickets/02-path.md", ticket({ title: "Path", cites: "c1", what: "one\ntwo\nthree\nEdit src/loop.ts now." }));
  write("tickets/03-none.md", ticket({ title: "No touches", cites: "c1", touches: null }));
  const r = await check();
  const lines = stdoutLines(r.stdout);
  expect(lines.some((l) => l.startsWith("02-path.md") && l.includes("no-file-paths") && l.includes("src/loop.ts") && l.includes("line 12"))).toBe(true);
  expect(lines.some((l) => l.startsWith("03-none.md") && l.includes("shape") && l.includes("touches"))).toBe(true);
  expect(lines.some((l) => l.startsWith("01-good.md"))).toBe(false);
  expect(lines.at(-1)).toMatch(/^3 tickets, 2 own-check failures/);
  expect(r.code).toBe(1);
});

test("30.3 an uncited decided card fails the set; a ghost does not count", async () => {
  t().seed(
    decided("root", { title: "Root" }),
    decided("c1", { title: "Cited", parent: "root" }),
    decided("c2", { title: "Uncited real", parent: "root" }),
    // A ghost with status decided.
    [
      ghost("g1", { title: "Ghost", parent: "root" }),
      { type: "node.edited", id: "g1", who: "me", noBasis: "test" },
      { type: "criterion.added", id: "g1", form: "revisit" },
      { type: "node.decided", id: "g1" },
    ],
    reopen("root", { reason: "invalidated" }),
  );
  write("spec.md", "## User stories\n\n1. a\n");
  write("tickets/01-a.md", ticket({ title: "A", cites: "root, c1", stories: "1" }));
  const r = await check();
  const lines = stdoutLines(r.stdout);
  const setLines = lines.filter((l) => l.startsWith("ticket set"));
  expect(setLines).toHaveLength(1);
  expect(setLines[0]).toContain("c2");
  expect(lines.filter((l) => l.includes("g1"))).toHaveLength(0);
  expect(lines.at(-1)).toContain("2 decided cards");
  expect(r.code).toBe(1);
});

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  rootWithDecided("c1");
  write("spec.md", "## User stories\n\n1. a\n");
  write("tickets/01-a.md", ticket({ title: "A", cites: "c1", stories: "1", blockedBy: "" }));
  write("tickets/02-b.md", ticket({ title: "B", cites: "c1", stories: "1", blockedBy: "3" }));
  write("tickets/03-c.md", ticket({ title: "C", cites: "c1", stories: "1", blockedBy: "2" }));
  write("tickets/04-d.md", ticket({ title: "D", cites: "c1", stories: "1", blockedBy: "3" }));
  const r = await check();
  const lines = stdoutLines(r.stdout);
  expect(lines.some((l) => l.startsWith("02-b.md") && l.includes("blocked_by"))).toBe(true);
  expect(lines.some((l) => l.startsWith("03-c.md") && l.includes("blocked_by"))).toBe(true);
  expect(lines.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(lines.some((l) => l.startsWith("04-d.md"))).toBe(false);
  expect(r.code).toBe(1);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  rootWithDecided("c1");
  write("spec.md", "# Spec\n\nSome text.\n");
  write("tickets/01-a.md", ticket({ title: "A", cites: "c1", stories: "1" }));
  const r = await check();
  expect(r.stderr).toContain("User stories");
  expect(r.stdout.trim()).toBe("");
  expect(r.code).toBe(2);
});

import { expect, test } from "bun:test";
import { ticket } from "../src/tickets/fixtures.ts";
import { decided, ghost, useWerk } from "./query-support.ts";

const { werk, seed, write } = useWerk();
const check = () =>
  werk("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const t = (o: Parameters<typeof ticket>[0]) => ticket({ blockedBy: "", ...o });

// A decided card under an open root: decide all, then reopen the root.
const reroot = { type: "node.reopened", id: "root", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" };
const base = () => [
  ...decided("root", { title: "Root" }),
  ...decided("a", { title: "A", parent: "root" }),
  ...decided("b", { title: "B", parent: "root" }),
  reroot,
];

test("30.1 correct folder passes", async () => {
  seed(base());
  write("spec.md", "## User stories\n\n1. one\n2. two\n");
  write("tickets/01-a.md", t({ cites: "a", stories: "1" }));
  write("tickets/02-b.md", t({ cites: "b", stories: "2", blockedBy: "1" }));
  const r = await check();
  expect(r.stdout.trim().split("\n")).toEqual([
    "2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories",
  ]);
  expect(r.code).toBe(0);
});

test("30.2 own-check failures name ticket, check, field", async () => {
  seed(base());
  write("spec.md", "## User stories\n\n1. one\n");
  write("tickets/01-a.md", t({ cites: "a,b", stories: "1" }));
  write("tickets/02-b.md", t({ cites: "a", what: "x\n\n\nEdit src/loop.ts now." }));
  write("tickets/03-c.md", t({ cites: "b", touches: null }));
  const r = await check();
  const out = r.stdout;
  const lines = out.trim().split("\n");
  const second = lines.find((l) => l.startsWith("02-b.md"));
  expect(second).toContain("no-file-paths");
  expect(second).toContain("src/loop.ts");
  expect(second).toMatch(/line 12\b/);
  const third = lines.find((l) => l.startsWith("03-c.md"));
  expect(third).toContain("shape");
  expect(third).toContain("touches");
  expect(lines.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(lines.at(-1)).toContain("3 tickets, 2 own-check failures");
  expect(r.code).toBe(1);
});

test("30.3 uncited real card fails the set, ghost does not count", async () => {
  seed([
    ...decided("root", { title: "Root" }),
    ...decided("a", { parent: "root" }),
    ...decided("b", { parent: "root" }),
    reroot,
    ghost("gh", { parent: "root", status: "decided" }),
  ]);
  write("spec.md", "## User stories\n\n1. one\n");
  write("tickets/01-a.md", t({ cites: "root, a", stories: "1" }));
  const r = await check();
  const lines = r.stdout.trim().split("\n");
  const set = lines.filter((l) => l.startsWith("ticket set"));
  expect(set).toHaveLength(1);
  expect(set[0]).toContain("b");
  expect(r.stdout).not.toContain("gh");
  expect(lines.at(-1)).toContain("2 decided cards");
  expect(r.code).toBe(1);
});

test("30.4 cycle names only tickets on the cycle", async () => {
  seed([
    ...decided("root", { title: "Root" }),
    ...decided("a", { parent: "root" }),
    ...decided("b", { parent: "root" }),
    ...decided("c", { parent: "root" }),
    ...decided("d", { parent: "root" }),
    reroot,
  ]);
  write("spec.md", "## User stories\n\n1. a\n2. b\n3. c\n4. d\n");
  write("tickets/01-a.md", t({ cites: "a", stories: "1" }));
  write("tickets/02-b.md", t({ cites: "b", stories: "2", blockedBy: "3" }));
  write("tickets/03-c.md", t({ cites: "c", stories: "3", blockedBy: "2" }));
  write("tickets/04-d.md", t({ cites: "d", stories: "4", blockedBy: "3" }));
  const r = await check();
  const lines = r.stdout.trim().split("\n");
  expect(lines.some((l) => l.startsWith("02-b.md") && l.includes("blocked_by"))).toBe(true);
  expect(lines.some((l) => l.startsWith("03-c.md") && l.includes("blocked_by"))).toBe(true);
  expect(lines.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(lines.some((l) => l.startsWith("04-d.md"))).toBe(false);
  expect(r.code).toBe(1);
});

test("30.5 spec without User stories heading is a malformed call", async () => {
  seed(base());
  write("spec.md", "# Spec\n\nno stories here\n");
  write("tickets/01-a.md", t({ cites: "a", stories: "1" }));
  const r = await check();
  expect(r.stderr).toContain("User stories");
  expect(r.stdout.trim()).toBe("");
  expect(r.code).toBe(2);
});

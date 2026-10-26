import { afterEach, beforeEach, expect, test } from "bun:test";
import { decided, ghost, open } from "../../src/map/mark-fixtures.ts";
import { ticket } from "../../src/tickets/fixtures.ts";
import { harness } from "./util.ts";

const h = harness();
beforeEach(() => h.create());
afterEach(() => h.dispose());

const SPEC2 = "## Problem\n\nP.\n\n## User stories\n\n1. As a, I want a.\n2. As b, I want b.\n";
const SPEC1 = "## User stories\n\n1. As a, I want a.\n";
const check = () =>
  h.werk("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const lastLine = (out: string) => out.trim().split("\n").at(-1);

test("30.1 a folder of correct tickets passes", async () => {
  h.seedMap(
    ...decided("root"),
    ...decided("a", { parent: "root" }),
  );
  h.write("spec.md", SPEC2);
  h.write("tickets/01-a.md", ticket({ cites: "root", stories: "1" }));
  h.write("tickets/02-b.md", ticket({ cites: "a", stories: "2", blockedBy: "1" }));
  const r = await check();
  const lines = r.stdout.trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toBe("2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories");
  expect(r.code).toBe(0);
}, 30000);

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  h.seedMap(...decided("root"));
  h.write("spec.md", SPEC1);
  h.write("tickets/01-a.md", ticket({ cites: "root", stories: "1" }));
  const what = `${"Line.\n".repeat(3)}Edit src/loop.ts here.`;
  h.write("tickets/02-b.md", ticket({ cites: "root", stories: "1", what }));
  h.write("tickets/03-c.md", ticket({ cites: "root", stories: "1", touches: null }));
  const r = await check();
  const out = r.stdout.split("\n");
  const second = out.find((l) => l.startsWith("02-b.md"));
  expect(second).toContain("no-file-paths");
  expect(second).toContain("src/loop.ts");
  expect(second).toContain("line 12");
  const third = out.find((l) => l.startsWith("03-c.md"));
  expect(third).toContain("shape");
  expect(third).toContain("touches");
  expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(lastLine(r.stdout)).toContain("3 tickets, 2 own-check failures");
  expect(r.code).toBe(1);
}, 30000);

test("30.3 an uncited decided card fails the set, and a ghost does not count", async () => {
  h.seedMap(
    ...decided("root"),
    ...decided("cited", { parent: "root" }),
    ...decided("lone", { parent: "root" }),
    ghost("phantom", { parent: "root", status: "decided" }),
  );
  h.write("spec.md", SPEC1);
  h.write("tickets/01-a.md", ticket({ cites: "root", stories: "1" }));
  h.write("tickets/02-b.md", ticket({ cites: "cited", stories: "1" }));
  const r = await check();
  const setLines = r.stdout.split("\n").filter((l) => l.startsWith("ticket set"));
  expect(setLines).toHaveLength(1);
  expect(setLines[0]).toContain("lone");
  expect(r.stdout).not.toContain("phantom");
  expect(lastLine(r.stdout)).toContain("3 decided cards");
  expect(r.code).toBe(1);
}, 30000);

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  h.seedMap(...decided("root"));
  h.write("spec.md", SPEC1);
  const t = (blockedBy: string) => ticket({ cites: "root", stories: "1", blockedBy });
  h.write("tickets/01-a.md", t(""));
  h.write("tickets/02-b.md", t("3"));
  h.write("tickets/03-c.md", t("2"));
  h.write("tickets/04-d.md", t("3"));
  const r = await check();
  const bl = r.stdout.split("\n").filter((l) => l.includes("blocked_by"));
  expect(bl.some((l) => l.startsWith("02-b.md"))).toBe(true);
  expect(bl.some((l) => l.startsWith("03-c.md"))).toBe(true);
  expect(r.stdout.split("\n").some((l) => l.startsWith("01-a.md") || l.startsWith("04-d.md"))).toBe(false);
  expect(r.code).toBe(1);
}, 30000);

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  h.seedMap(...decided("root"));
  h.write("spec.md", "# Spec\n\nNo stories here.\n");
  h.write("tickets/01-a.md", ticket({ cites: "root", stories: "1" }));
  const r = await check();
  expect(r.stderr).toContain("User stories");
  expect(r.stdout).not.toContain("failures");
  expect(r.stdout.trim()).toBe("");
  expect(r.code).toBe(2);
}, 30000);

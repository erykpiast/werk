import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ticket } from "../src/tickets/fixtures.ts";
import { useProject } from "../src/test-env/project.ts";
import { boardLines, card, DONE_TICKET, ghost, mapLog, ok, seedBoard, werk } from "./lib.ts";

const project = useProject();
const write = (p: { dir: string }, path: string, text: string) => {
  mkdirSync(join(p.dir, path, ".."), { recursive: true });
  writeFileSync(join(p.dir, path), text);
};
const check = (p: ReturnType<typeof project>) =>
  werk(p, "ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const lines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");

describe("30 ticket-check", () => {
  test("30.1 a folder of correct tickets passes", async () => {
    const p = project();
    card(p, "root", "Root");
    card(p, "c1", "Card one", { parent: "root", status: "decided" });
    card(p, "c2", "Card two", { parent: "root", status: "decided" });
    write(p, "spec.md", "## User stories\n\n1. As a person, I want one.\n2. As a person, I want two.\n");
    write(p, "tickets/01-a.md", ticket({ cites: "c1", stories: "1", blockedBy: "" }));
    write(p, "tickets/02-b.md", ticket({ title: "A second thing", cites: "c2", stories: "2", blockedBy: "1" }));
    const r = await check(p);
    const out = lines(r.stdout);
    expect(out).toHaveLength(1);
    expect(out.at(-1)).toBe("2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories");
    expect(r.code).toBe(0);
  });

  test("30.2 own-check failures name the ticket, the check and the field", async () => {
    const p = project();
    card(p, "root", "Root");
    card(p, "c1", "Card one", { parent: "root", status: "decided" });
    write(p, "spec.md", "## User stories\n\n1. a\n2. b\n3. c\n");
    write(p, "tickets/01-a.md", ticket({ cites: "c1", stories: "1" }));
    write(p, "tickets/02-b.md", ticket({ title: "Second", cites: "", stories: "2", what: "l1\nl2\nl3\nEdit src/loop.ts here." }));
    write(p, "tickets/03-c.md", ticket({ title: "Third", cites: "", stories: "3", touches: null }));
    const r = await check(p);
    const out = lines(r.stdout);
    const second = out.filter((l) => l.startsWith("02-b.md"));
    expect(second.some((l) => /file-path|no-file-paths/i.test(l) && l.includes("src/loop.ts") && /line 12/.test(l))).toBe(true);
    expect(out.some((l) => l.startsWith("03-c.md") && /shape/.test(l) && /touches/.test(l))).toBe(true);
    expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
    expect(out.at(-1)).toMatch(/^3 tickets, 2 own-check failures/);
    expect(r.code).toBe(1);
  });

  test("30.3 an uncited decided card fails the set, and a ghost does not count", async () => {
    const p = project();
    card(p, "root", "Root");
    ghost(p, "gh", "Ghost decided", { parent: "root", status: "decided" });
    card(p, "c2", "Card two", { parent: "root", status: "decided" });
    card(p, "c3", "Card three", { parent: "root", status: "decided" });
    write(p, "spec.md", "## User stories\n\n1. a\n2. b\n");
    write(p, "tickets/01-a.md", ticket({ cites: "root", stories: "1" }));
    write(p, "tickets/02-b.md", ticket({ title: "Second", cites: "c2", stories: "2" }));
    const r = await check(p);
    const out = lines(r.stdout);
    const setLines = out.filter((l) => l.startsWith("ticket set"));
    expect(setLines).toHaveLength(1);
    expect(setLines[0]).toContain("c3");
    expect(out.some((l) => l.includes("gh"))).toBe(false);
    expect(out.at(-1)).toContain("2 decided cards");
    expect(r.code).toBe(1);
  });

  test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
    const p = project();
    card(p, "root", "Root");
    card(p, "c1", "Card one", { parent: "root", status: "decided" });
    card(p, "c2", "Card two", { parent: "root", status: "decided" });
    card(p, "c3", "Card three", { parent: "root", status: "decided" });
    card(p, "c4", "Card four", { parent: "root", status: "decided" });
    write(p, "spec.md", "## User stories\n\n1. a\n2. b\n3. c\n4. d\n");
    write(p, "tickets/01-a.md", ticket({ title: "One", cites: "c1", stories: "1" }));
    write(p, "tickets/02-b.md", ticket({ title: "Two", cites: "c2", stories: "2", blockedBy: "3" }));
    write(p, "tickets/03-c.md", ticket({ title: "Three", cites: "c3", stories: "3", blockedBy: "2" }));
    write(p, "tickets/04-d.md", ticket({ title: "Four", cites: "c4", stories: "4", blockedBy: "3" }));
    const r = await check(p);
    const out = lines(r.stdout);
    expect(out.some((l) => l.startsWith("02-b.md") && l.includes("blocked_by"))).toBe(true);
    expect(out.some((l) => l.startsWith("03-c.md") && l.includes("blocked_by"))).toBe(true);
    expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
    expect(out.some((l) => l.startsWith("04-d.md"))).toBe(false);
    expect(r.code).toBe(1);
  });

  test("30.5 a spec with no User stories heading is a malformed call", async () => {
    const p = project();
    card(p, "root", "Root");
    card(p, "c1", "Card one", { parent: "root", status: "decided" });
    write(p, "spec.md", "# Spec\n\nNothing here.\n");
    write(p, "tickets/01-a.md", ticket({ cites: "c1", stories: "1" }));
    const r = await check(p);
    expect(r.stderr).toMatch(/no "?User stories"? heading/);
    expect(r.stdout).toBe("");
    expect(r.code).toBe(2);
  });
});

const R = ["--class", "plan", "--found", "review"];
describe("43 followup", () => {
  test("43.1 a build miss on a done ticket is recorded and listed", async () => {
    const p = project();
    seedBoard(p, ...DONE_TICKET("app/01"));
    const r = await werk(p, "followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/recorded/);
    const l = await ok(p, "followup", "app/01", "--list");
    expect(l.stdout).toMatch(/^1\./);
    expect(l.stdout).toContain("build");
    expect(l.stdout).toMatch(/after.merge/);
    expect(l.stdout).toContain("the link expires after 1 minute, the card says 15");
    expect(l.stdout).toMatch(/catch\w*: yes/);
  });

  test("43.2 a plan miss is recorded without a catchable answer", async () => {
    const p = project();
    seedBoard(p, ...DONE_TICKET("app/01"));
    const r = await werk(p, "followup", "app/01", ...R, "--why", "no card said how long the link lasts");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/recorded/);
    const l = await ok(p, "followup", "app/01", "--list");
    expect(l.stdout).toMatch(/^1\./);
    expect(l.stdout).toContain("plan");
    expect(l.stdout).toMatch(/review/);
    expect(l.stdout).toContain("no card said how long the link lasts");
    expect(l.stdout).not.toMatch(/catch/);
  });

  test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
    const p = project();
    seedBoard(p, ...DONE_TICKET("app/01"));
    const a = await werk(p, "followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
    expect(a.code).not.toBe(0);
    expect(a.stderr).toMatch(/build miss needs/);
    expect(a.stderr).toMatch(/catchable/);
    const b = await werk(p, "followup", "app/01", ...R, "--why", "the card was silent", "--catchable", "no");
    expect(b.code).not.toBe(0);
    expect(b.stderr).toMatch(/plan miss/);
    expect(b.stderr).toMatch(/catchable/);
    const l = await ok(p, "followup", "app/01", "--list");
    expect(l.stdout.trim()).toBe("");
  });

  test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
    const p = project();
    seedBoard(p, { type: "ticket.planned", id: "app/02" }, { type: "ticket.moved", id: "app/02", to: "building" });
    const a = await werk(p, "followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
    expect(a.code).not.toBe(0);
    expect(a.stderr).toMatch(/not done/);
    const b = await werk(p, "followup", "app/99", ...R, "--why", "missing rule");
    expect(b.code).not.toBe(0);
    expect(b.stderr).toMatch(/no ticket|does not exist|not exist/);
    const l = await ok(p, "followup", "app/02", "--list");
    expect(l.stdout.trim()).toBe("");
  });

  test("43.5 the last correction of a record is the class in force", async () => {
    const p = project();
    seedBoard(p, ...DONE_TICKET("app/01"));
    await ok(p, "followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute", "--catchable", "yes");
    await ok(p, "followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
    let l = (await ok(p, "followup", "app/01", "--list")).stdout;
    expect(l).toMatch(/1\. corrected by 2, in force: plan/);
    expect(l).toMatch(/2\. correction of 1/);
    await ok(p, "followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
    l = (await ok(p, "followup", "app/01", "--list")).stdout;
    expect(l).toMatch(/1\. corrected by 3, in force: build/);
  });
});
void boardLines; void mapLog;

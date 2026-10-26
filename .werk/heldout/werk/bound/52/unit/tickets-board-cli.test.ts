import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ticket } from "../../src/tickets/fixtures.ts";
import {
  board, boardText, createProject, ghost, open, seed, seedBoard, werk, type Project,
} from "../support.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const w = (...args: string[]) => werk(project, ...args);
const write = (path: string, text: string) => {
  mkdirSync(join(project.dir, path, ".."), { recursive: true });
  writeFileSync(join(project.dir, path), text);
};
const planned = (id: string, extra: Record<string, unknown> = {}) => ({ type: "ticket.planned", id, title: `T ${id}`, ...extra });
const toDone = (id: string) => [
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging" },
  { type: "ticket.merge", id },
];

describe("27 ticket board commands", () => {
  test("27.1 archive a blocked ticket and restore it", async () => {
    seedBoard(project, planned("auth/01"));
    const m = await w("ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API");
    expect(m.code).toBe(0);
    const a = await w("ticket", "archive", "auth/01");
    expect(a.code).toBe(0);
    const list = (await w("ticket", "list")).stdout;
    expect(list).toContain("auth/01");
    expect(list).toContain("archived");
    expect(list).toContain("blocked");
    expect(list).toContain("waits for the token API");
    const before = boardText(project).split("\n").filter(Boolean).length;
    expect((await w("ticket", "restore", "01", "--actor", "you")).code).toBe(0);
    const after = boardText(project).split("\n").filter(Boolean);
    expect(after.length).toBe(before + 1);
    expect(JSON.parse(after.at(-1) as string)).toMatchObject({ type: "ticket.restored", actor: "you" });
    const t = board(project).tickets.get("auth/01");
    expect(t?.column).toBe("blocked");
    expect(t?.reason).toBe("waits for the token API");
    expect(t?.archived).toBe(false);
    expect((await w("ticket", "list")).stdout).toContain("waits for the token API");
  });

  test("27.2 a move without a reason is refused", async () => {
    seedBoard(project, planned("auth/01"));
    const before = boardText(project);
    const r = await w("ticket", "move", "auth/01", "blocked");
    expect(r.code).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain("reason");
    expect(board(project).tickets.get("auth/01")?.column).toBe("ready");
    expect(boardText(project)).toBe(before);
    expect((await w("ticket", "list")).stdout).toContain("ready");
  });

  test("27.3 restoring a ticket that is not archived changes nothing", async () => {
    seedBoard(project, planned("auth/02"));
    const before = boardText(project);
    const r = await w("ticket", "restore", "02");
    expect(r.code).toBe(1);
    expect(boardText(project)).toBe(before);
    const r2 = await w("ticket", "restore", "99");
    expect(r2.code).toBe(1);
    expect(boardText(project)).toBe(before);
  });

  test("27.4 a done ticket cannot be archived", async () => {
    seedBoard(project, planned("auth/03"), ...toDone("auth/03"));
    const before = boardText(project);
    const r = await w("ticket", "archive", "auth/03");
    expect(r.code).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain("done");
    expect(boardText(project)).toBe(before);
    const list = (await w("ticket", "list")).stdout;
    expect(list).toContain("auth/03");
    expect(list).toContain("done");
    expect(list).not.toContain("archived");
  });

  test("27.5 the listing shows every ticket in the column its events lead to", async () => {
    seedBoard(project, planned("auth/01"), planned("auth/02"), planned("auth/03"));
    expect((await w("ticket", "move", "auth/02", "blocked", "--reason", "waits")).code).toBe(0);
    expect((await w("ticket", "archive", "auth/03")).code).toBe(0);
    const out = (await w("ticket", "list")).stdout.split("\n");
    expect(out.find((l) => l.includes("auth/01"))).toContain("ready");
    const two = out.find((l) => l.includes("auth/02"));
    expect(two).toContain("blocked");
    expect(two).toContain("waits");
    expect(out.find((l) => l.includes("auth/03"))).toContain("archived");
    const events = boardText(project).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    for (const e of events.slice(3)) expect(typeof e.actor).toBe("string");
  });
});

describe("30 ticket-check", () => {
  const check = (...extra: string[]) => w("ticket-check", "tickets", "--root", "root", "--spec", "spec.md", ...extra);
  const spec2 = "## User stories\n\n1. As a person, I want a.\n2. As a person, I want b.\n";

  test("30.1 a folder of correct tickets passes", async () => {
    seed(project, open("root", { title: "Root" }),
      open("a", { title: "A", parent: "root", status: "decided" }),
      open("b", { title: "B", parent: "root", status: "decided" }));
    write("spec.md", spec2);
    write("tickets/01-a.md", ticket({ cites: "a", stories: "1", touches: "map view" }));
    write("tickets/02-b.md", ticket({ cites: "b", stories: "2", blockedBy: "1", touches: "board view" }));
    const r = await check();
    expect(r.stdout.trim().split("\n")).toEqual([
      "2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories",
    ]);
    expect(r.code).toBe(0);
  });

  test("30.2 own-check failures name the ticket, check and field", async () => {
    seed(project, open("root", { title: "Root" }));
    write("spec.md", "## User stories\n\n1. a\n");
    write("tickets/01-a.md", ticket({ cites: "root" }));
    write("tickets/02-b.md", ticket({ what: "first\n\nsecond\nEdit src/loop.ts here." }));
    write("tickets/03-c.md", ticket({ touches: null }));
    const r = await check();
    const lines = r.stdout.trim().split("\n");
    const second = lines.find((l) => l.startsWith("02-b.md"));
    expect(second).toContain("no-file-paths");
    expect(second).toContain("src/loop.ts");
    expect(second).toContain("line 12");
    const third = lines.find((l) => l.startsWith("03-c.md"));
    expect(third).toContain("shape");
    expect(third).toContain("touches");
    expect(lines.some((l) => l.startsWith("01-a.md"))).toBe(false);
    expect(lines.at(-1)).toContain("3 tickets, 2 own-check failures");
    expect(r.code).toBe(1);
  });

  test("30.3 an uncited decided card fails the set and a ghost does not count", async () => {
    seed(project, open("root", { title: "Root" }),
      open("cited", { title: "Cited", parent: "root", status: "decided" }),
      open("lonely", { title: "Lonely", parent: "root", status: "decided" }),
      ghost("phantom", { title: "Phantom", parent: "root", status: "decided" }));
    write("spec.md", spec2);
    write("tickets/01-a.md", ticket({ cites: "root", stories: "1" }));
    write("tickets/02-b.md", ticket({ cites: "cited", stories: "2" }));
    const r = await check();
    const lines = r.stdout.trim().split("\n");
    const set = lines.filter((l) => l.startsWith("ticket set"));
    expect(set).toHaveLength(1);
    expect(set[0]).toContain("lonely");
    expect(r.stdout).not.toContain("phantom");
    expect(lines.at(-1)).toContain("2 decided cards");
    expect(r.code).toBe(1);
  });

  test("30.4 a blocked_by cycle names only the tickets on it", async () => {
    seed(project, open("root", { title: "Root" }),
      open("a", { title: "A", parent: "root", status: "decided" }),
      open("b", { title: "B", parent: "root", status: "decided" }));
    write("spec.md", "## User stories\n\n1. a\n2. b\n3. c\n4. d\n");
    write("tickets/01-a.md", ticket({ cites: "a", stories: "1" }));
    write("tickets/02-b.md", ticket({ cites: "b", stories: "2", blockedBy: "3" }));
    write("tickets/03-c.md", ticket({ cites: "a", stories: "3", blockedBy: "2" }));
    write("tickets/04-d.md", ticket({ cites: "b", stories: "4", blockedBy: "3" }));
    const r = await check();
    const lines = r.stdout.trim().split("\n");
    expect(lines.some((l) => l.startsWith("02-b.md") && l.includes("blocked_by"))).toBe(true);
    expect(lines.some((l) => l.startsWith("03-c.md") && l.includes("blocked_by"))).toBe(true);
    expect(lines.some((l) => l.startsWith("01-a.md"))).toBe(false);
    expect(lines.some((l) => l.startsWith("04-d.md"))).toBe(false);
    expect(r.code).toBe(1);
  });

  test("30.5 a spec with no User stories heading is a malformed call", async () => {
    seed(project, open("root", { title: "Root" }));
    write("spec.md", "# Spec\n\nNothing here.\n");
    write("tickets/01-a.md", ticket({ cites: "root" }));
    const r = await check();
    expect(r.stderr).toContain("User stories");
    expect(r.stdout.trim()).toBe("");
    expect(r.code).toBe(2);
  });
});

describe("43 followup", () => {
  const done = (id: string) => [planned(id), ...toDone(id)];
  const list = async (id: string) => (await w("followup", id, "--list")).stdout;

  test("43.1 a build miss on a done ticket is recorded and listed", async () => {
    seedBoard(project, done("app/01"));
    const r = await w("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
    expect(r.code).toBe(0);
    expect(r.stdout.toLowerCase()).toContain("recorded");
    const l = await list("app/01");
    expect(l).toContain("1.");
    expect(l).toContain("build");
    expect(l).toContain("after-merge");
    expect(l).toContain("the link expires after 1 minute, the card says 15");
    expect(l).toContain("yes");
  });

  test("43.2 a plan miss is recorded without a catchable answer", async () => {
    seedBoard(project, done("app/01"));
    const r = await w("followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
    expect(r.code).toBe(0);
    expect(r.stdout.toLowerCase()).toContain("recorded");
    const l = await list("app/01");
    expect(l).toContain("1.");
    expect(l).toContain("plan");
    expect(l).toContain("review");
    expect(l).toContain("no card said how long the link lasts");
    expect(l).not.toContain("catch");
  });

  test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
    seedBoard(project, done("app/01"));
    const a = await w("followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
    expect(a.code).not.toBe(0);
    expect(a.stderr).toContain("a build miss needs the catchable answer");
    const b = await w("followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
    expect(b.code).not.toBe(0);
    expect(b.stderr).toContain("a plan miss has no catchable answer");
    expect((await list("app/01")).trim()).toBe("");
  });

  test("43.4 a ticket that is not done or does not exist is refused", async () => {
    seedBoard(project, planned("app/02"), { type: "ticket.moved", id: "app/02", to: "building" });
    const a = await w("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
    expect(a.code).not.toBe(0);
    expect(a.stderr).toContain("not done");
    const b = await w("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
    expect(b.code).not.toBe(0);
    expect(b.stderr).toContain("no ticket app/99");
    expect((await list("app/02")).trim()).toBe("");
  });

  test("43.5 the last correction is the class in force", async () => {
    seedBoard(project, done("app/01"),
      { type: "ticket.followup_recorded", id: "app/01", class: "build", found: "after-merge", why: "the link expires", catchable: true });
    const c1 = await w("followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
    expect(c1.code).toBe(0);
    let l = (await list("app/01")).split("\n").filter(Boolean);
    expect(l[0]).toContain("corrected by 2, in force: plan miss");
    expect(l[1]).toContain("correction of 1");
    const c2 = await w("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
    expect(c2.code).toBe(0);
    l = (await list("app/01")).split("\n").filter(Boolean);
    expect(l[0]).toContain("corrected by 3, in force: build miss");
  });
});

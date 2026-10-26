import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";
import { werk, type Ev } from "./lib.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const boardPath = () => join(project.dir, ".werk", "board.jsonl");
const seedBoard = (...events: Ev[]) => {
  mkdirSync(join(project.dir, ".werk"), { recursive: true });
  writeFileSync(boardPath(), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const boardText = () => readFileSync(boardPath(), "utf8");
const boardEvents = () =>
  boardText()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Ev);
const mapLogText = () => (existsSync(project.logPath) ? readFileSync(project.logPath, "utf8") : null);
const planned = (id: string, extra: Ev = {}): Ev => ({
  type: "ticket.planned",
  id,
  title: `Title ${id}`,
  ...extra,
});

test("27.1 archive a blocked ticket and restore it to the same column and reason", async () => {
  seedBoard(planned("auth/01"));
  const mapBefore = mapLogText();
  const mv = await werk(project, "ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API");
  expect(mv.code, mv.stderr).toBe(0);
  const ar = await werk(project, "ticket", "archive", "auth/01");
  expect(ar.code, ar.stderr).toBe(0);
  const list = await werk(project, "ticket", "list");
  expect(list.code, list.stderr).toBe(0);
  expect(list.stdout).toMatch(/auth\/01[^\n]*archived/);
  expect(list.stdout).toContain("blocked");
  expect(list.stdout).toContain("waits for the token API");
  const countBefore = boardEvents().length;
  const rs = await werk(project, "ticket", "restore", "01", "--actor", "you");
  expect(rs.code, rs.stderr).toBe(0);
  const after = await werk(project, "ticket", "list");
  expect(after.stdout).toMatch(/auth\/01[^\n]*blocked/);
  expect(after.stdout).not.toMatch(/auth\/01[^\n]*archived/);
  expect(after.stdout).toContain("waits for the token API");
  const events = boardEvents();
  expect(events.length).toBe(countBefore + 1);
  expect(events.at(-1)).toMatchObject({ type: "ticket.restored", actor: "you" });
  expect(mapLogText()).toBe(mapBefore);
});

test("27.2 a move without a reason is refused", async () => {
  seedBoard(planned("auth/01"));
  const before = boardText();
  const r = await werk(project, "ticket", "move", "auth/01", "blocked");
  expect(r.code).not.toBe(0);
  expect(r.stderr.toLowerCase()).toContain("reason");
  const list = await werk(project, "ticket", "list");
  expect(list.code, list.stderr).toBe(0);
  expect(list.stdout).toMatch(/auth\/01[^\n]*ready/);
  expect(boardText()).toBe(before);
});

test("27.3 restoring a ticket that is not archived changes nothing", async () => {
  seedBoard(planned("auth/02"));
  const before = boardText();
  const r = await werk(project, "ticket", "restore", "02");
  expect(r.code).toBe(1);
  expect(boardText()).toBe(before);
  const r99 = await werk(project, "ticket", "restore", "99");
  expect(r99.code).toBe(1);
  expect(boardText()).toBe(before);
});

test("27.4 a done ticket cannot be archived", async () => {
  seedBoard(
    planned("auth/03"),
    { type: "ticket.moved", id: "auth/03", to: "building" },
    { type: "ticket.moved", id: "auth/03", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "auth/03" },
  );
  const before = boardText();
  const r = await werk(project, "ticket", "archive", "auth/03");
  expect(r.code).not.toBe(0);
  expect(r.stderr.toLowerCase()).toMatch(/done/);
  const list = await werk(project, "ticket", "list");
  expect(list.code, list.stderr).toBe(0);
  expect(list.stdout).toMatch(/auth\/03[^\n]*done/);
  expect(list.stdout).not.toMatch(/auth\/03[^\n]*archived/);
  expect(boardText()).toBe(before);
});

test("27.5 the board listing shows every ticket in the column its events lead to", async () => {
  seedBoard(planned("auth/01"), planned("auth/02"), planned("auth/03"));
  const mv = await werk(project, "ticket", "move", "auth/02", "blocked", "--reason", "needs the API");
  expect(mv.code, mv.stderr).toBe(0);
  const ar = await werk(project, "ticket", "archive", "auth/03");
  expect(ar.code, ar.stderr).toBe(0);
  const list = await werk(project, "ticket", "list");
  expect(list.code, list.stderr).toBe(0);
  expect(list.stdout).toMatch(/auth\/01[^\n]*ready/);
  expect(list.stdout).toMatch(/auth\/02[^\n]*blocked[^\n]*needs the API/);
  expect(list.stdout).toMatch(/auth\/03[^\n]*archived/);
  for (const e of boardEvents().slice(3)) {
    expect(["you", "agent", "loop"]).toContain(e.actor as string);
  }
});

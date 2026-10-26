import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { boardPath, createProject, type Project, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const board = (...events: unknown[]) => {
  mkdirSync(dirname(boardPath(p)), { recursive: true });
  appendFileSync(boardPath(p), `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
};
const planned = (id: string, extra: Record<string, unknown> = {}) => ({ type: "ticket.planned", id, title: `Ticket ${id}`, ...extra });
const boardText = () => (existsSync(boardPath(p)) ? readFileSync(boardPath(p), "utf8") : "");
const events = () => boardText().split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("27.1 archive a blocked ticket and restore it to the same column and reason", async () => {
  board(planned("auth/01"));
  const mv = await werk(p, "ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API");
  expect(mv.code, mv.stderr).toBe(0);
  const ar = await werk(p, "ticket", "archive", "auth/01");
  expect(ar.code, ar.stderr).toBe(0);
  const list = await werk(p, "ticket", "list");
  expect(list.stdout).toMatch(/auth\/01[^\n]*archived/);
  expect(list.stdout).toContain("blocked");
  expect(list.stdout).toContain("waits for the token API");
  const before = events().length;
  const rs = await werk(p, "ticket", "restore", "01", "--actor", "you");
  expect(rs.code, rs.stderr).toBe(0);
  const after = await werk(p, "ticket", "list");
  expect(after.stdout).toMatch(/auth\/01[^\n]*blocked/);
  expect(after.stdout).toContain("waits for the token API");
  expect(after.stdout).not.toMatch(/auth\/01[^\n]*archived/);
  const ev = events();
  expect(ev.length).toBe(before + 1);
  expect(ev.at(-1).type).toBe("ticket.restored");
  expect(ev.at(-1).actor).toBe("you");
});

test("27.2 a move without a reason is refused", async () => {
  board(planned("auth/01"));
  const n = events().length;
  const r = await werk(p, "ticket", "move", "auth/01", "blocked");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/reason/);
  const list = await werk(p, "ticket", "list");
  expect(list.stdout).toMatch(/auth\/01[^\n]*ready/);
  expect(events().length).toBe(n);
});

test("27.3 restoring a ticket that is not archived changes nothing", async () => {
  board(planned("auth/02"));
  const before = boardText();
  expect((await werk(p, "ticket", "restore", "02")).code).toBe(1);
  expect(boardText()).toBe(before);
  expect((await werk(p, "ticket", "restore", "99")).code).toBe(1);
  expect(boardText()).toBe(before);
});

test("27.4 a done ticket cannot be archived", async () => {
  board(planned("auth/03"), { type: "ticket.moved", id: "auth/03", to: "building" }, { type: "ticket.moved", id: "auth/03", to: "merging" }, { type: "ticket.merge", id: "auth/03" });
  const before = boardText();
  const r = await werk(p, "ticket", "archive", "auth/03");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/done/);
  const list = await werk(p, "ticket", "list");
  expect(list.stdout).toMatch(/auth\/03[^\n]*done/);
  expect(list.stdout).not.toMatch(/auth\/03[^\n]*archived/);
  expect(boardText()).toBe(before);
});

test("27.5 the board listing shows every ticket in the column its events lead to", async () => {
  board(planned("auth/01"), planned("auth/02"), planned("auth/03"));
  expect((await werk(p, "ticket", "move", "auth/02", "blocked", "--reason", "waits")).code).toBe(0);
  expect((await werk(p, "ticket", "archive", "auth/03")).code).toBe(0);
  const list = await werk(p, "ticket", "list");
  expect(list.stdout).toMatch(/auth\/01[^\n]*ready/);
  expect(list.stdout).toMatch(/auth\/02[^\n]*blocked[^\n]*waits/);
  expect(list.stdout).toMatch(/auth\/03[^\n]*archived/);
  for (const e of events()) expect(typeof e.actor).toBe("string");
});

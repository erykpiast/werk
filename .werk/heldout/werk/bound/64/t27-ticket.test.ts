import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  boardEvents,
  boardText,
  createProject,
  doneTicket,
  type Project,
  planned,
  seed,
  seedBoard,
  werk,
} from "./h.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());
const list = async () => (await werk(p, "ticket", "list")).stdout;

test("27.1 archive a blocked ticket and restore it to the same column and reason", async () => {
  seedBoard(p, planned("auth/01"));
  seed(p, { type: "node.proposed", id: "x", kind: "card", title: "X", status: "open" });
  const decisionBefore = await Bun.file(p.logPath).text();
  const a = await werk(p, "ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API");
  expect(a.code).toBe(0);
  const b = await werk(p, "ticket", "archive", "auth/01");
  expect(b.code).toBe(0);
  const l1 = await list();
  expect(l1).toMatch(/auth\/01.*archived/);
  expect(l1).toContain("blocked");
  expect(l1).toContain("waits for the token API");
  const n = boardEvents(p).length;
  const c = await werk(p, "ticket", "restore", "01", "--actor", "you");
  expect(c.code).toBe(0);
  const l2 = await list();
  expect(l2).toMatch(/auth\/01.*blocked/);
  expect(l2).toContain("waits for the token API");
  const ev = boardEvents(p);
  expect(ev.length).toBe(n + 1);
  expect(ev.at(-1)).toMatchObject({ type: "ticket.restored", actor: "you" });
  expect(await Bun.file(p.logPath).text()).toBe(decisionBefore);
});

test("27.2 a move without a reason is refused", async () => {
  seedBoard(p, planned("auth/01"));
  const before = boardText(p);
  const r = await werk(p, "ticket", "move", "auth/01", "blocked");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/reason/);
  expect(await list()).toMatch(/auth\/01.*ready/);
  expect(boardText(p)).toBe(before);
});

test("27.3 restoring a ticket that is not archived changes nothing", async () => {
  seedBoard(p, planned("auth/02"));
  const before = boardText(p);
  const r = await werk(p, "ticket", "restore", "02");
  expect(r.code).toBe(1);
  expect(boardText(p)).toBe(before);
  const r2 = await werk(p, "ticket", "restore", "99");
  expect(r2.code).toBe(1);
  expect(boardText(p)).toBe(before);
});

test("27.4 a done ticket cannot be archived", async () => {
  seedBoard(p, doneTicket("auth/03"));
  const before = boardText(p);
  const r = await werk(p, "ticket", "archive", "auth/03");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/done/);
  const l = await list();
  expect(l).toMatch(/auth\/03.*done/);
  expect(l).not.toMatch(/auth\/03.*archived/);
  expect(boardText(p)).toBe(before);
});

test("27.5 the listing shows every ticket in the column its events lead to", async () => {
  seedBoard(p, planned("auth/01"), planned("auth/02"), planned("auth/03"));
  await werk(p, "ticket", "move", "auth/02", "blocked", "--reason", "needs x");
  await werk(p, "ticket", "archive", "auth/03");
  const l = await list();
  expect(l).toMatch(/auth\/01.*ready/);
  expect(l).toMatch(/auth\/02.*blocked.*needs x/);
  expect(l).toMatch(/auth\/03.*archived/);
  for (const e of boardEvents(p)) expect(typeof e.actor).toBe("string");
});

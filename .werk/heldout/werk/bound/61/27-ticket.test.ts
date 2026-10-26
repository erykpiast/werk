import { afterEach, beforeEach, expect, test } from "bun:test";
import { type Board, board } from "./board.ts";

let b: Board;
beforeEach(() => {
  b = board();
});
afterEach(() => b.project.dispose());

test("27.1 archive a blocked ticket and restore it to the same column and reason", async () => {
  b.seed({ type: "ticket.planned", id: "auth/01", title: "T" });
  const mv = await b.werk("ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API");
  expect(mv.code).toBe(0);
  expect((await b.werk("ticket", "archive", "auth/01")).code).toBe(0);
  const list = (await b.werk("ticket", "list")).stdout;
  expect(list).toMatch(/auth\/01.*archived/);
  expect(list).toContain("blocked");
  expect(list).toContain("waits for the token API");
  const n = b.lines().length;
  expect((await b.werk("ticket", "restore", "01", "--actor", "you")).code).toBe(0);
  const after = (await b.werk("ticket", "list")).stdout;
  expect(after).toMatch(/auth\/01.*blocked.*waits for the token API/s);
  expect(b.lines().length).toBe(n + 1);
  expect(JSON.parse(b.lines().at(-1) as string)).toMatchObject({ type: "ticket.restored", actor: "you" });
});

test("27.2 a move to blocked without a reason is refused", async () => {
  b.seed({ type: "ticket.planned", id: "auth/01", title: "T" });
  const n = b.lines().length;
  const r = await b.werk("ticket", "move", "auth/01", "blocked");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/reason/);
  expect(r.stderr).not.toMatch(/usage: ticket restore|needs the subverb restore/);
  expect((await b.werk("ticket", "list")).stdout).toMatch(/auth\/01.*ready/);
  expect(b.lines().length).toBe(n);
});

test("27.3 restoring a ticket that is not archived, or unknown, changes nothing", async () => {
  b.seed({ type: "ticket.planned", id: "auth/02", title: "T" });
  const before = b.raw();
  const a = await b.werk("ticket", "restore", "02");
  expect(a.code).toBe(1);
  expect(b.raw()).toBe(before);
  const z = await b.werk("ticket", "restore", "99");
  expect(z.code).toBe(1);
  expect(b.raw()).toBe(before);
});

test("27.4 a done ticket cannot be archived", async () => {
  b.seed(
    { type: "ticket.planned", id: "auth/03", title: "T" },
    { type: "ticket.moved", id: "auth/03", to: "building" },
    { type: "ticket.moved", id: "auth/03", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "auth/03" },
  );
  const n = b.lines().length;
  const r = await b.werk("ticket", "archive", "auth/03");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/done/);
  expect(r.stderr).not.toMatch(/needs the subverb restore/);
  expect(b.lines().length).toBe(n);
  expect((await b.werk("ticket", "list")).stdout).toMatch(/auth\/03.*done/);
});

test("27.5 the board listing shows every ticket in the column its events lead to", async () => {
  b.seed(
    { type: "ticket.planned", id: "auth/01", title: "One" },
    { type: "ticket.planned", id: "auth/02", title: "Two" },
    { type: "ticket.planned", id: "auth/03", title: "Three" },
  );
  expect((await b.werk("ticket", "move", "auth/02", "blocked", "--reason", "waits")).code).toBe(0);
  expect((await b.werk("ticket", "archive", "auth/03")).code).toBe(0);
  const list = (await b.werk("ticket", "list")).stdout;
  expect(list).toMatch(/auth\/01.*ready/);
  expect(list).toMatch(/auth\/02.*blocked.*waits/);
  expect(list).toMatch(/auth\/03.*archived/);
  for (const line of b.lines()) expect(JSON.parse(line).actor ?? "agent").toBeTruthy();
});

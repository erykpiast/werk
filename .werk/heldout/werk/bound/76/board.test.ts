import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendBoardEvent } from "../src/board/log.ts";
import { freshProject, lines, ok, w, withRoot, type Project } from "./h.ts";

const boardFile = (p: Project) => join(p.dir, ".werk", "board.jsonl");
const board = (p: Project) => {
  try {
    return readFileSync(boardFile(p), "utf8");
  } catch {
    return "";
  }
};
const plan = (p: Project, id: string) => appendBoardEvent(boardFile(p), "ticket.planned", { id, title: `Ticket ${id}`, blocked_by: [] });
const mk = () => {
  const p = freshProject();
  return p;
};
const list = (p: Project) => w(p, "ticket", "list");

test("27.1 archive a blocked ticket and restore it", async () => {
  const p = mk();
  plan(p, "auth/01");
  await ok(p, "ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API");
  await ok(p, "ticket", "archive", "auth/01");
  const l1 = await list(p);
  expect(l1.code).toBe(0);
  expect(l1.out).toContain("auth/01");
  expect(l1.out).toContain("archived");
  expect(l1.out).toContain("blocked");
  expect(l1.out).toContain("waits for the token API");
  const decisionBefore = lines(p);
  const nb = board(p).split("\n").filter(Boolean).length;
  const r = await w(p, "ticket", "restore", "01", "--actor", "you");
  expect(r.code).toBe(0);
  const l2 = await list(p);
  expect(l2.out).toMatch(/auth\/01.*blocked.*waits for the token API/);
  const bl = board(p).split("\n").filter(Boolean);
  expect(bl.length).toBe(nb + 1);
  expect(JSON.parse(bl.at(-1) as string)).toMatchObject({ type: "ticket.restored", actor: "you" });
  expect(lines(p)).toEqual(decisionBefore);
});

test("27.2 a move without a reason is refused", async () => {
  const p = mk();
  plan(p, "auth/01");
  const before = board(p);
  const r = await w(p, "ticket", "move", "auth/01", "blocked");
  expect(r.code).not.toBe(0);
  expect(r.err.toLowerCase()).toContain("reason");
  const l = await list(p);
  expect(l.code).toBe(0);
  expect(l.out).toMatch(/auth\/01.*ready/);
  expect(board(p)).toBe(before);
});

test("27.3 restoring a ticket that is not archived changes nothing", async () => {
  const p = mk();
  plan(p, "auth/02");
  const before = board(p);
  const a = await w(p, "ticket", "restore", "02");
  expect(a.code).toBe(1);
  expect(board(p)).toBe(before);
  const b = await w(p, "ticket", "restore", "99");
  expect(b.code).toBe(1);
  expect(board(p)).toBe(before);
});

test("27.4 a done ticket cannot be archived", async () => {
  const p = mk();
  plan(p, "auth/03");
  for (const to of ["building", "merging", "done"] as const) {
    const wr = appendBoardEvent(boardFile(p), "ticket.moved", { id: "auth/03", to }, "you");
    expect(wr.ok).toBe(true);
  }
  const before = board(p);
  const r = await w(p, "ticket", "archive", "auth/03");
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/done/);
  expect(r.err).toMatch(/cannot be archived|archive/);
  const l = await list(p);
  expect(l.code).toBe(0);
  expect(l.out).toMatch(/auth\/03.*done/);
  expect(l.out).not.toMatch(/auth\/03.*archived/);
  expect(board(p)).toBe(before);
});

test("27.5 the listing shows every ticket in the column its events lead to", async () => {
  const p = mk();
  for (const n of ["01", "02", "03"]) plan(p, `auth/${n}`);
  await ok(p, "ticket", "move", "auth/02", "blocked", "--reason", "needs the API");
  await ok(p, "ticket", "archive", "auth/03");
  const l = await list(p);
  expect(l.code).toBe(0);
  expect(l.out).toMatch(/auth\/01.*ready/);
  expect(l.out).toMatch(/auth\/02.*blocked.*needs the API/);
  expect(l.out).toMatch(/auth\/03.*archived/);
  for (const line of board(p).split("\n").filter(Boolean)) expect(["agent", "you"]).toContain(JSON.parse(line).actor);
  void withRoot;
});

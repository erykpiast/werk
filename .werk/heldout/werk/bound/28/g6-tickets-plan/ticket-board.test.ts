import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendBoardEvent } from "../../src/board/log.ts";
import { freshProject } from "../../src/test/project.ts";

function board(...ids: string[]) {
  const project = freshProject();
  const path = join(project.dir, ".werk", "board.jsonl");
  for (const id of ids) appendBoardEvent(path, "ticket.planned", { id, title: `Ticket ${id}`, blocked_by: [] });
  const log = () => readFileSync(path, "utf8");
  const events = () => log().trim().split("\n").map((l) => JSON.parse(l));
  const decisions = () => readFileSync(join(project.dir, ".werk", "log.jsonl"), "utf8");
  return { project, path, log, events, decisions };
}

test("27.1 archive a blocked ticket and restore it", async () => {
  const { project, events, decisions } = board("auth/01");
  const dec = decisions();
  const mv = await project.werk(["ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API"]);
  console.log("27.1 move", JSON.stringify(mv));
  expect(mv.code).toBe(0);
  const ar = await project.werk(["ticket", "archive", "auth/01"]);
  console.log("27.1 archive", JSON.stringify(ar));
  expect(ar.code).toBe(0);
  const list = await project.werk(["ticket", "list"]);
  console.log("27.1 list", JSON.stringify(list));
  const before = events().length;
  const rs = await project.werk(["ticket", "restore", "01", "--actor", "you"]);
  console.log("27.1 restore 01", JSON.stringify(rs));
  const after = events();
  console.log("27.1 new events", JSON.stringify(after.slice(before)));
  expect(decisions()).toBe(dec);
  expect(list.code).toBe(0);
  expect(list.out).toMatch(/auth\/01.*archived/);
  expect(rs.code).toBe(0);
  expect(after.slice(before)).toMatchObject([{ type: "ticket.restored", actor: "you" }]);
});

test("27.2 a move without a reason is refused", async () => {
  const { project, log } = board("auth/01");
  const before = log();
  const mv = await project.werk(["ticket", "move", "auth/01", "blocked"]);
  console.log("27.2 move", JSON.stringify(mv));
  expect(mv.code).not.toBe(0);
  expect(mv.err).toMatch(/reason/);
  expect(log()).toBe(before);
  const list = await project.werk(["ticket", "list"]);
  console.log("27.2 list", JSON.stringify(list));
  expect(list.code).toBe(0);
  expect(list.out).toMatch(/auth\/01.*ready/);
});

test("27.3 restoring a ticket that is not archived changes nothing", async () => {
  const { project, log } = board("auth/02");
  const before = log();
  const a = await project.werk(["ticket", "restore", "02"]);
  console.log("27.3 a", JSON.stringify(a));
  expect(a.code).toBe(1);
  expect(log()).toBe(before);
  const b = await project.werk(["ticket", "restore", "99"]);
  console.log("27.3 b", JSON.stringify(b));
  expect(b.code).toBe(1);
  expect(log()).toBe(before);
});

test("27.4 a done ticket cannot be archived", async () => {
  const { project, path, log } = board("auth/03");
  for (const to of ["building", "merging", "done"] as const) appendBoardEvent(path, "ticket.moved", { id: "auth/03", to });
  const before = log();
  const ar = await project.werk(["ticket", "archive", "auth/03"]);
  console.log("27.4 archive", JSON.stringify(ar));
  expect(ar.code).not.toBe(0);
  expect(ar.err).toMatch(/done/);
  expect(log()).toBe(before);
  const list = await project.werk(["ticket", "list"]);
  console.log("27.4 list", JSON.stringify(list));
  expect(list.code).toBe(0);
  expect(list.out).toMatch(/auth\/03.*done/);
});

test("27.5 the board listing shows every ticket", async () => {
  const { project, events } = board("auth/01", "auth/02", "auth/03");
  expect((await project.werk(["ticket", "move", "auth/02", "blocked", "--reason", "needs a key"])).code).toBe(0);
  expect((await project.werk(["ticket", "archive", "auth/03"])).code).toBe(0);
  const list = await project.werk(["ticket", "list"]);
  console.log("27.5 list", JSON.stringify(list));
  console.log("27.5 events", JSON.stringify(events()));
  expect(events().every((e) => typeof e.actor === "string" && e.actor !== "")).toBe(true);
  expect(list.code).toBe(0);
});

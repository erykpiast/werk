import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendBoardEvent, readBoard } from "../src/board/log.ts";
import { freshProject } from "../src/test/project.ts";

function projectWith(...ids: string[]) {
  const project = freshProject();
  const path = join(project.dir, ".werk", "board.jsonl");
  for (const id of ids) appendBoardEvent(path, "ticket.planned", { id, title: `Ticket ${id}`, blocked_by: [] });
  return { project, path, log: () => readFileSync(path, "utf8"), decisions: () => readFileSync(join(project.dir, ".werk", "log.jsonl"), "utf8") };
}

test("27.1 archive blocked ticket, restore", async () => {
  const { project, path, log, decisions } = projectWith("auth/01");
  const d0 = decisions();
  await project.werk(["ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API"]);
  await project.werk(["ticket", "archive", "auth/01"]);
  const list = await project.werk(["ticket", "list"]);
  console.log("list:", list);
  const t = readBoard(path).tickets.get("auth/01");
  expect(t).toMatchObject({ archived: true, column: "blocked", reason: "waits for the token API" });
  const before = log().trim().split("\n").length;
  const r = await project.werk(["ticket", "restore", "01", "--actor", "you"]);
  console.log("restore:", r);
  expect(r.code).toBe(0);
  const after = log().trim().split("\n");
  expect(after.length).toBe(before + 1);
  expect(JSON.parse(after.at(-1) as string)).toMatchObject({ type: "ticket.restored", actor: "you" });
  expect(decisions()).toBe(d0);
  expect(readBoard(path).tickets.get("auth/01")).toMatchObject({ archived: false, column: "blocked", reason: "waits for the token API" });
  const list2 = await project.werk(["ticket", "list"]);
  expect(list.code).toBe(0);
  expect(list.out).toMatch(/auth\/01/);
  expect(list.out).toMatch(/archived/);
  expect(list2.out).toMatch(/blocked/);
  expect(list2.out).toContain("waits for the token API");
});

test("27.2 move without reason refused", async () => {
  const { project, log } = projectWith("auth/01");
  const b = log();
  const r = await project.werk(["ticket", "move", "auth/01", "blocked"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/reason/);
  expect(log()).toBe(b);
  const list = await project.werk(["ticket", "list"]);
  console.log("list:", list);
  expect(list.code).toBe(0);
  expect(list.out).toMatch(/auth\/01.*ready|ready.*auth\/01/s);
});

test("27.3 restore of non-archived / unknown", async () => {
  const { project, log } = projectWith("auth/02");
  const b = log();
  expect((await project.werk(["ticket", "restore", "02"])).code).toBe(1);
  expect(log()).toBe(b);
  expect((await project.werk(["ticket", "restore", "99"])).code).toBe(1);
  expect(log()).toBe(b);
});

test("27.4 done ticket cannot be archived", async () => {
  const { project, path, log } = projectWith("auth/03");
  for (const to of ["building", "merging", "done"] as const) appendBoardEvent(path, "ticket.moved", { id: "auth/03", to });
  const b = log();
  const r = await project.werk(["ticket", "archive", "auth/03"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/done/);
  expect(log()).toBe(b);
  const list = await project.werk(["ticket", "list"]);
  console.log("list:", list);
  expect(list.code).toBe(0);
  expect(list.out).toMatch(/done/);
  expect(list.out).not.toMatch(/archived/);
});

test("27.5 listing shows columns; events name actors", async () => {
  const { project, path, log } = projectWith("auth/01", "auth/02", "auth/03");
  await project.werk(["ticket", "move", "auth/02", "blocked", "--reason", "needs token"]);
  await project.werk(["ticket", "archive", "auth/03"]);
  const t = readBoard(path).tickets;
  expect(t.get("auth/01")?.column).toBe("ready");
  expect(t.get("auth/02")).toMatchObject({ column: "blocked", reason: "needs token" });
  expect(t.get("auth/03")?.archived).toBe(true);
  for (const l of log().trim().split("\n")) expect(["agent", "you"]).toContain(JSON.parse(l).actor);
  const list = await project.werk(["ticket", "list"]);
  console.log("list:", list);
  expect(list.code).toBe(0);
  expect(list.out).toContain("needs token");
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendBoardEvent } from "../src/board/log.ts";
import { freshProject } from "../src/test/project.ts";

function projectWith(...ids: string[]) {
  const project = freshProject();
  const path = join(project.dir, ".werk", "board.jsonl");
  for (const id of ids) appendBoardEvent(path, "ticket.planned", { id, title: `Ticket ${id}`, blocked_by: [] });
  const log = () => (Bun.file(path).size === 0 ? "" : readFileSync(path, "utf8"));
  return { project, path, log };
}

test("27.1", async () => {
  const { project, log } = projectWith("auth/01");
  const m = await project.werk(["ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API"]);
  expect(m.code).toBe(0);
  const a = await project.werk(["ticket", "archive", "auth/01"]);
  expect(a.code).toBe(0);
  const list = await project.werk(["ticket", "list"]);
  expect(list.code).toBe(0);
  expect(list.out).toContain("auth/01");
  expect(list.out).toContain("archived");
  expect(list.out).toContain("waits for the token API");
  const before = log();
  const r = await project.werk(["ticket", "restore", "01", "--actor", "you"]);
  expect(r.code).toBe(0);
  expect(log().length).toBeGreaterThan(before.length);
});

test("27.2", async () => {
  const { project, log } = projectWith("auth/01");
  const before = log();
  const run = await project.werk(["ticket", "move", "auth/01", "blocked"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("reason");
  const list = await project.werk(["ticket", "list"]);
  expect(list.code).toBe(0);
  expect(list.out).toMatch(/auth\/01.*ready/);
  expect(log()).toBe(before);
});

test("27.3", async () => {
  const { project, log } = projectWith("auth/02");
  const before = log();
  const a = await project.werk(["ticket", "restore", "02"]);
  expect(a.code).toBe(1);
  expect(log()).toBe(before);
  const b = await project.werk(["ticket", "restore", "99"]);
  expect(b.code).toBe(1);
  expect(log()).toBe(before);
});

test("27.4", async () => {
  const { project, path, log } = projectWith("auth/03");
  for (const to of ["building", "merging", "done"] as const) appendBoardEvent(path, "ticket.moved", { id: "auth/03", to });
  const before = log();
  const run = await project.werk(["ticket", "archive", "auth/03"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("done");
  const list = await project.werk(["ticket", "list"]);
  expect(list.code).toBe(0);
  expect(list.out).toMatch(/auth\/03.*done/);
  expect(log()).toBe(before);
});

test("27.5", async () => {
  const { project, path } = projectWith("auth/01", "auth/02", "auth/03");
  expect((await project.werk(["ticket", "move", "auth/02", "blocked", "--reason", "why"])).code).toBe(0);
  expect((await project.werk(["ticket", "archive", "auth/03"])).code).toBe(0);
  const list = await project.werk(["ticket", "list"]);
  expect(list.code).toBe(0);
  expect(list.out).toMatch(/auth\/01.*ready/);
  expect(list.out).toMatch(/auth\/02.*blocked.*why/);
  expect(list.out).toMatch(/auth\/03.*archived/);
  for (const line of readFileSync(path, "utf8").trim().split("\n")) expect(JSON.parse(line).actor).toBeTruthy();
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendBoardEvent } from "../src/board/log.ts";
import { freshProject } from "../src/test/project.ts";

function proj(...ids: string[]) {
  const project = freshProject();
  const board = join(project.dir, ".werk", "board.jsonl");
  const decision = join(project.dir, ".werk", "log.jsonl");
  for (const id of ids) appendBoardEvent(board, "ticket.planned", { id, title: `T ${id}`, blocked_by: [] });
  const ev = () => readFileSync(board, "utf8").split("\n").filter((l) => l).map((l) => JSON.parse(l));
  return { project, board, decision, ev, raw: () => readFileSync(board, "utf8"), dec: () => readFileSync(decision, "utf8") };
}

test("27.1", async () => {
  const { project, ev, dec } = proj("auth/01");
  const decBefore = dec();
  expect((await project.werk(["ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API"])).code).toBe(0);
  expect((await project.werk(["ticket", "archive", "auth/01"])).code).toBe(0);
  const list = await project.werk(["ticket", "list"]);
  expect(list.out).toContain("auth/01");
  expect(list.out).toContain("archived");
  expect(list.out).toContain("blocked");
  expect(list.out).toContain("waits for the token API");
  const n = ev().length;
  const r = await project.werk(["ticket", "restore", "01", "--actor", "you"]);
  expect(r.code).toBe(0);
  const l2 = await project.werk(["ticket", "list"]);
  expect(l2.out).toBe("auth/01 blocked - waits for the token API\n");
  const added = ev().slice(n);
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({ type: "ticket.restored", actor: "you" });
  expect(dec()).toBe(decBefore);
});

test("27.2", async () => {
  const { project, raw } = proj("auth/01");
  const before = raw();
  const r = await project.werk(["ticket", "move", "auth/01", "blocked"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("reason");
  expect((await project.werk(["ticket", "list"])).out).toBe("auth/01 ready\n");
  expect(raw()).toBe(before);
});

test("27.3", async () => {
  const { project, raw } = proj("auth/02");
  const before = raw();
  expect((await project.werk(["ticket", "restore", "02"])).code).toBe(1);
  expect(raw()).toBe(before);
  expect((await project.werk(["ticket", "restore", "99"])).code).toBe(1);
  expect(raw()).toBe(before);
});

test("27.4", async () => {
  const { project, board, raw } = proj("auth/03");
  for (const to of ["building", "merging", "done"] as const) appendBoardEvent(board, "ticket.moved", { id: "auth/03", to });
  const before = raw();
  const r = await project.werk(["ticket", "archive", "auth/03"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("a done ticket cannot be archived");
  expect((await project.werk(["ticket", "list"])).out).toBe("auth/03 done\n");
  expect(raw()).toBe(before);
});

test("27.5", async () => {
  const { project, ev } = proj("auth/01", "auth/02", "auth/03");
  await project.werk(["ticket", "move", "auth/02", "blocked", "--reason", "needs input"]);
  await project.werk(["ticket", "archive", "auth/03"]);
  const r = await project.werk(["ticket", "list"]);
  expect(r.out).toBe("auth/01 ready\nauth/02 blocked - needs input\nauth/03 ready archived\n");
  for (const e of ev()) expect(typeof e.actor === "string" && e.actor !== "").toBe(true);
});

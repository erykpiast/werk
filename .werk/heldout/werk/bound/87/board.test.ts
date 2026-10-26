import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendBoardEvent, readBoard } from "../src/board/log.ts";
import { freshProject } from "./lib.ts";

function projectWith(...ids: string[]) {
  const project = freshProject();
  const path = join(project.dir, ".werk", "board.jsonl");
  for (const id of ids) appendBoardEvent(path, "ticket.planned", { id, title: `Ticket ${id}`, blocked_by: [] });
  const log = () => readFileSync(path, "utf8");
  return { project, path, log, events: () => log().trim().split("\n").map((l) => JSON.parse(l)) };
}

test("27.1 archive a blocked ticket, restore by number to the same column and reason", async () => {
  const { project, path, log, events } = projectWith("auth/01");
  const decisionLog = readFileSync(join(project.dir, ".werk", "log.jsonl"), "utf8");
  await project.werk(["ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API"]);
  await project.werk(["ticket", "archive", "auth/01"]);
  const list1 = await project.werk(["ticket", "list"]);
  expect(list1.code, list1.err).toBe(0);
  expect(list1.out).toContain("archived");
  expect(list1.out).toContain("blocked");
  expect(list1.out).toContain("waits for the token API");
  const before = events().length;
  const r = await project.werk(["ticket", "restore", "01", "--actor", "you"]);
  expect(r.code, r.err).toBe(0);
  const board = readBoard(path).tickets.get("auth/01")!;
  expect(board.column).toBe("blocked");
  expect(board.reason).toBe("waits for the token API");
  expect(events().length).toBe(before + 1);
  expect(events().at(-1).type).toBe("ticket.restored");
  expect(events().at(-1).actor).toBe("you");
  const list2 = await project.werk(["ticket", "list"]);
  expect(list2.out).toContain("blocked");
  expect(readFileSync(join(project.dir, ".werk", "log.jsonl"), "utf8")).toBe(decisionLog);
  void log;
});

test("27.2 a move without a reason is refused", async () => {
  const { project, log } = projectWith("auth/01");
  const before = log();
  const r = await project.werk(["ticket", "move", "auth/01", "blocked"]);
  expect(r.code).not.toBe(0);
  expect(r.err.toLowerCase()).toContain("reason");
  expect(log()).toBe(before);
  const list = await project.werk(["ticket", "list"]);
  expect(list.out).toContain("ready");
});

test("27.3 restore of a non-archived or unknown ticket exits 1", async () => {
  const { project, log } = projectWith("auth/02");
  const before = log();
  expect((await project.werk(["ticket", "restore", "02"])).code).toBe(1);
  expect(log()).toBe(before);
  expect((await project.werk(["ticket", "restore", "99"])).code).toBe(1);
  expect(log()).toBe(before);
});

test("27.4 a done ticket cannot be archived", async () => {
  const { project, path, log } = projectWith("auth/03");
  for (const to of ["building", "merging", "done"] as const) appendBoardEvent(path, "ticket.moved", { id: "auth/03", to });
  const before = log();
  const r = await project.werk(["ticket", "archive", "auth/03"]);
  expect(r.code).not.toBe(0);
  expect(r.err.toLowerCase()).toContain("done");
  expect(log()).toBe(before);
  const list = await project.werk(["ticket", "list"]);
  expect(list.out).toContain("done");
  expect(list.out).not.toContain("archived");
});

test("27.5 the listing shows each ticket in its column; every event names its actor", async () => {
  const { project, events } = projectWith("auth/01", "auth/02", "auth/03");
  await project.werk(["ticket", "move", "auth/02", "blocked", "--reason", "waits"]);
  await project.werk(["ticket", "archive", "auth/03"]);
  const list = await project.werk(["ticket", "list"]);
  expect(list.code, list.err).toBe(0);
  const by = (id: string) => list.out.split("\n").find((l) => l.includes(id)) ?? "";
  expect(by("auth/01")).toContain("ready");
  expect(by("auth/02")).toContain("blocked");
  expect(by("auth/02")).toContain("waits");
  expect(by("auth/03")).toContain("archived");
  expect(events().every((e) => e.actor === "agent" || e.actor === "you")).toBe(true);
});

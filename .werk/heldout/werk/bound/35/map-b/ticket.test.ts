import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../../src/test-env/project.ts";
import { boardPath, boardText, seedBoard, werk } from "./helpers.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const run = (...a: string[]) => werk(project, ...a);
const boardLines = () =>
  boardText(project).split("\n").filter((l) => l !== "");
const decisionLog = () =>
  existsSync(project.logPath) ? readFileSync(project.logPath, "utf8") : "";

const planned = (n: string) => ({ type: "ticket.planned", id: `auth/${n}` });
const doneEvents = (n: string) => [
  planned(n),
  { type: "ticket.moved", id: `auth/${n}`, to: "building" },
  { type: "ticket.moved", id: `auth/${n}`, to: "merging", actor: "loop" },
  { type: "ticket.merge", id: `auth/${n}` },
];
const listing = async () => (await run("ticket", "list")).stdout;
const row = (text: string, id: string) =>
  text.split("\n").find((l) => l.includes(id)) ?? "";

test("27.1 archive a blocked ticket and restore it to the same column and reason", async () => {
  seedBoard(project, planned("01"));
  const logBefore = decisionLog();
  const mv = await run(
    "ticket",
    "move",
    "auth/01",
    "blocked",
    "--reason",
    "waits for the token API",
  );
  expect(mv.code).toBe(0);
  const ar = await run("ticket", "archive", "auth/01");
  expect(ar.code).toBe(0);
  const l1 = await listing();
  expect(row(l1, "auth/01")).toContain("archived");
  expect(row(l1, "auth/01")).toContain("blocked");
  expect(row(l1, "auth/01")).toContain("waits for the token API");
  const before = boardLines().length;
  const rs = await run("ticket", "restore", "01", "--actor", "you");
  expect(rs.code).toBe(0);
  const l2 = await listing();
  expect(row(l2, "auth/01")).not.toContain("archived");
  expect(row(l2, "auth/01")).toContain("blocked");
  expect(row(l2, "auth/01")).toContain("waits for the token API");
  const after = boardLines();
  expect(after.length).toBe(before + 1);
  const ev = JSON.parse(after[after.length - 1] as string);
  expect(ev.type).toBe("ticket.restored");
  expect(ev.actor).toBe("you");
  expect(decisionLog()).toBe(logBefore);
});

test("27.2 a move to blocked without a reason is refused", async () => {
  seedBoard(project, planned("01"));
  const before = boardText(project);
  const r = await run("ticket", "move", "auth/01", "blocked");
  expect(r.code).not.toBe(0);
  expect(r.stderr.toLowerCase()).toContain("reason");
  expect(row(await listing(), "auth/01")).toContain("ready");
  expect(boardText(project)).toBe(before);
});

test("27.3 restoring a ticket that is not archived, or not on the board, changes nothing", async () => {
  seedBoard(project, planned("02"));
  const before = boardText(project);
  const a = await run("ticket", "restore", "02");
  expect(a.code).toBe(1);
  expect(boardText(project)).toBe(before);
  const b = await run("ticket", "restore", "99");
  expect(b.code).toBe(1);
  expect(boardText(project)).toBe(before);
});

test("27.4 a done ticket cannot be archived", async () => {
  seedBoard(project, ...doneEvents("03"));
  const before = boardText(project);
  const r = await run("ticket", "archive", "auth/03");
  expect(r.code).not.toBe(0);
  expect(r.stderr.toLowerCase()).toContain("done");
  const l = row(await listing(), "auth/03");
  expect(l).toContain("done");
  expect(l).not.toContain("archived");
  expect(boardText(project)).toBe(before);
});

test("27.5 the listing shows every ticket in the column its events lead to", async () => {
  seedBoard(project, planned("01"), planned("02"), planned("03"));
  expect((await run("ticket", "move", "auth/02", "blocked", "--reason", "needs api")).code).toBe(0);
  expect((await run("ticket", "archive", "auth/03")).code).toBe(0);
  const l = await listing();
  expect(row(l, "auth/01")).toContain("ready");
  expect(row(l, "auth/02")).toContain("blocked");
  expect(row(l, "auth/02")).toContain("needs api");
  expect(row(l, "auth/03")).toContain("archived");
  for (const line of boardLines()) {
    const ev = JSON.parse(line);
    if (ev.type !== "ticket.planned") expect(typeof ev.actor).toBe("string");
  }
  expect(existsSync(boardPath(project))).toBe(true);
});

import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project, tools } from "./h.ts";

let project: Project;
let t: ReturnType<typeof tools>;
beforeEach(() => {
  project = createProject();
  t = tools(project);
});
afterEach(() => project.dispose());

const planned = (n: string) => ({ type: "ticket.planned", id: `auth/${n}` });

test("27.1 archive blocked ticket and restore it", async () => {
  t.seedBoard(planned("01"));
  const mv = await t.werk("ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API");
  const ar = await t.werk("ticket", "archive", "auth/01");
  const ls = await t.werk("ticket", "list");
  console.log("27.1", JSON.stringify({ mv, ar, ls }));
  expect(mv.code).toBe(0);
  expect(ar.code).toBe(0);
  expect(ls.stdout).toContain("archived");
  const before = t.board().trim().split("\n").length;
  const rs = await t.werk("ticket", "restore", "01", "--actor", "you");
  expect(rs.code).toBe(0);
  expect(t.board().trim().split("\n").length).toBe(before + 1);
  const ls2 = await t.werk("ticket", "list");
  expect(ls2.stdout).toContain("blocked");
  expect(ls2.stdout).toContain("waits for the token API");
});

test("27.2 move without reason refused", async () => {
  t.seedBoard(planned("01"));
  const before = t.board();
  const r = await t.werk("ticket", "move", "auth/01", "blocked");
  console.log("27.2", JSON.stringify(r));
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/reason/);
  expect(t.board()).toBe(before);
  const ls = await t.werk("ticket", "list");
  expect(ls.code).toBe(0);
  expect(ls.stdout).toContain("ready");
});

test("27.3 restore of non-archived / unknown changes nothing", async () => {
  t.seedBoard(planned("02"));
  const before = t.board();
  const a = await t.werk("ticket", "restore", "02");
  expect(a.code).toBe(1);
  expect(t.board()).toBe(before);
  const b = await t.werk("ticket", "restore", "99");
  expect(b.code).toBe(1);
  expect(t.board()).toBe(before);
});

test("27.4 done ticket cannot be archived", async () => {
  t.seedBoard(
    planned("03"),
    { type: "ticket.moved", id: "auth/03", to: "building" },
    { type: "ticket.moved", id: "auth/03", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "auth/03" },
  );
  const before = t.board();
  const r = await t.werk("ticket", "archive", "auth/03");
  const ls = await t.werk("ticket", "list");
  console.log("27.4", JSON.stringify({ r, ls }));
  expect(r.code).not.toBe(0);
  expect(r.stderr.toLowerCase()).toContain("done");
  expect(t.board()).toBe(before);
  expect(ls.stdout).toContain("done");
});

test("27.5 listing shows each ticket in its column", async () => {
  t.seedBoard(planned("01"), planned("02"), planned("03"));
  const m = await t.werk("ticket", "move", "auth/02", "blocked", "--reason", "needs api");
  const a = await t.werk("ticket", "archive", "auth/03");
  const ls = await t.werk("ticket", "list");
  console.log("27.5", JSON.stringify({ m, a, ls }));
  expect(m.code).toBe(0);
  expect(a.code).toBe(0);
  expect(ls.stdout).toContain("needs api");
  expect(ls.stdout).toContain("archived");
  for (const line of t.board().trim().split("\n")) {
    const e = JSON.parse(line);
    if (e.type === "ticket.planned") continue;
    expect(e.actor).toBeDefined();
  }
});

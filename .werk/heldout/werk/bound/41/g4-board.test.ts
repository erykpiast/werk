import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendBoardEvent, readBoard } from "../src/board/log.ts";
import { freshProject } from "../src/test/project.ts";

function setup(ids: string[]) {
  const project = freshProject();
  const path = join(project.dir, ".werk", "board.jsonl");
  for (const id of ids) appendBoardEvent(path, "ticket.planned", { id, title: `T ${id}`, blocked_by: [] });
  const log = () => readFileSync(path, "utf8");
  const events = () => log().trim().split("\n").map((l) => JSON.parse(l));
  const decision = () => readFileSync(join(project.dir, ".werk", "log.jsonl"), "utf8");
  const t = (id: string) => readBoard(path).tickets.get(id);
  return { project, path, log, events, decision, t };
}

test("27.0 is there a `werk ticket list` verb", async () => {
  const s = setup(["auth/01"]);
  const r = await s.project.werk(["ticket", "list"]);
  console.log("LIST:", JSON.stringify(r));
});

test("27.1 archive and restore", async () => {
  const s = setup(["auth/01"]);
  expect((await s.project.werk(["ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API"])).code).toBe(0);
  expect((await s.project.werk(["ticket", "archive", "auth/01"])).code).toBe(0);
  expect(s.t("auth/01")).toMatchObject({ archived: true, column: "blocked", reason: "waits for the token API" });
  const dec = s.decision();
  const n = s.events().length;
  const r = await s.project.werk(["ticket", "restore", "01", "--actor", "you"]);
  console.log("RESTORE 01:", JSON.stringify(r));
  expect(r.code).toBe(0);
  expect(s.t("auth/01")).toMatchObject({ archived: false, column: "blocked", reason: "waits for the token API" });
  expect(s.events().length).toBe(n + 1);
  expect(s.events().at(-1)).toMatchObject({ type: "ticket.restored", actor: "you" });
  expect(s.decision()).toBe(dec);
});

test("27.1b same with the full id (reading check)", async () => {
  const s = setup(["auth/01"]);
  await s.project.werk(["ticket", "move", "auth/01", "blocked", "--reason", "w"]);
  await s.project.werk(["ticket", "archive", "auth/01"]);
  const r = await s.project.werk(["ticket", "restore", "auth/01", "--actor", "you"]);
  expect(r.code).toBe(0);
  expect(s.t("auth/01")).toMatchObject({ archived: false, column: "blocked", reason: "w" });
});

test("27.2 move without reason", async () => {
  const s = setup(["auth/01"]);
  const before = s.log();
  const r = await s.project.werk(["ticket", "move", "auth/01", "blocked"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("--reason");
  expect(s.t("auth/01")?.column).toBe("ready");
  expect(s.log()).toBe(before);
});

test("27.3 restore not archived / unknown", async () => {
  const s = setup(["auth/01", "auth/02"]);
  const before = s.log();
  const a = await s.project.werk(["ticket", "restore", "02"]);
  console.log("R02", JSON.stringify(a));
  expect(a.code).toBe(1);
  expect(s.log()).toBe(before);
  const b = await s.project.werk(["ticket", "restore", "99"]);
  expect(b.code).toBe(1);
  expect(s.log()).toBe(before);
  const c = await s.project.werk(["ticket", "restore", "auth/02"]);
  expect(c.code).toBe(1);
  expect(s.log()).toBe(before);
});

test("27.4 done cannot be archived", async () => {
  const s = setup(["auth/03"]);
  for (const to of ["building", "merging", "done"] as const) appendBoardEvent(s.path, "ticket.moved", { id: "auth/03", to });
  const before = s.log();
  const r = await s.project.werk(["ticket", "archive", "auth/03"]);
  expect(r.code).toBe(1);
  expect(r.err).toMatch(/done/);
  expect(s.t("auth/03")).toMatchObject({ column: "done", archived: false });
  expect(s.log()).toBe(before);
});

test("27.5 columns and actors", async () => {
  const s = setup(["auth/01", "auth/02", "auth/03"]);
  expect((await s.project.werk(["ticket", "move", "auth/02", "blocked", "--reason", "why"])).code).toBe(0);
  expect((await s.project.werk(["ticket", "archive", "auth/03"])).code).toBe(0);
  expect(s.t("auth/01")).toMatchObject({ column: "ready", archived: false });
  expect(s.t("auth/02")).toMatchObject({ column: "blocked", reason: "why" });
  expect(s.t("auth/03")?.archived).toBe(true);
  for (const e of s.events()) expect(["you", "agent"]).toContain(e.actor);
});

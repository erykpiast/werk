import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendBoardEvent } from "../src/board/log.ts";
import { freshProject, type Project } from "../src/test/project.ts";
import "./h.ts";

const boardPath = (p: Project) => join(p.dir, ".werk", "board.jsonl");
const blog = (p: Project) => { try { return readFileSync(boardPath(p), "utf8"); } catch { return ""; } };
const bev = (p: Project) => blog(p).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const dlog = (p: Project) => readFileSync(join(p.dir, ".werk", "log.jsonl"), "utf8");
const plan = (p: Project, id: string) => appendBoardEvent(boardPath(p), "ticket.planned", { id, title: `T ${id}`, blocked_by: [] });
const list = async (p: Project) => (await p.werk(["ticket", "list"]));

test("27.1", async () => {
  const p = freshProject();
  plan(p, "auth/01");
  console.log("list:", JSON.stringify(await list(p)));
  let r = await p.werk(["ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API"]);
  expect(r.code).toBe(0);
  r = await p.werk(["ticket", "archive", "auth/01"]);
  expect(r.code).toBe(0);
  const l = await list(p);
  expect(l.code).toBe(0);
  expect(l.out).toContain("auth/01");
  expect(l.out).toMatch(/archived/);
  expect(l.out).toContain("blocked");
  expect(l.out).toContain("waits for the token API");
  const d0 = dlog(p);
  const n = bev(p).length;
  r = await p.werk(["ticket", "restore", "01", "--actor", "you"]);
  expect(r.code).toBe(0);
  const l2 = (await list(p)).out;
  const line = l2.split("\n").find((x) => x.includes("auth/01"))!;
  expect(line).toContain("blocked");
  expect(line).toContain("waits for the token API");
  expect(line).not.toMatch(/archived/);
  const ev = bev(p);
  expect(ev.length).toBe(n + 1);
  expect(ev.at(-1).type).toBe("ticket.restored");
  expect(ev.at(-1).actor).toBe("you");
  expect(dlog(p)).toBe(d0);
});

test("27.2", async () => {
  const p = freshProject();
  plan(p, "auth/01");
  const n = blog(p);
  const r = await p.werk(["ticket", "move", "auth/01", "blocked"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/reason/);
  expect(blog(p)).toBe(n);
  const l = (await list(p)).out.split("\n").find((x) => x.includes("auth/01"))!;
  expect(l).toContain("ready");
});

test("27.3", async () => {
  const p = freshProject();
  plan(p, "auth/02");
  const before = blog(p);
  let r = await p.werk(["ticket", "restore", "02"]);
  expect(r.code).toBe(1);
  expect(blog(p)).toBe(before);
  r = await p.werk(["ticket", "restore", "99"]);
  expect(r.code).toBe(1);
  expect(blog(p)).toBe(before);
});

test("27.4", async () => {
  const p = freshProject();
  plan(p, "auth/03");
  for (const to of ["building", "merging", "done"]) appendBoardEvent(boardPath(p), "ticket.moved", { id: "auth/03", to } as any);
  const n = blog(p);
  const r = await p.werk(["ticket", "archive", "auth/03"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/done/);
  expect(r.err).toMatch(/archiv/);
  const l = (await list(p)).out.split("\n").find((x) => x.includes("auth/03"))!;
  expect(l).toContain("done");
  expect(l).not.toMatch(/archived/);
  expect(blog(p)).toBe(n);
});

test("27.5", async () => {
  const p = freshProject();
  for (const id of ["auth/01", "auth/02", "auth/03"]) plan(p, id);
  await p.werk(["ticket", "move", "auth/02", "blocked", "--reason", "needs X"]);
  await p.werk(["ticket", "archive", "auth/03"]);
  const l = (await list(p)).out.split("\n");
  const row = (id: string) => l.find((x) => x.includes(id))!;
  expect(row("auth/01")).toContain("ready");
  expect(row("auth/02")).toContain("blocked");
  expect(row("auth/02")).toContain("needs X");
  expect(row("auth/03")).toMatch(/archived/);
  for (const e of bev(p)) expect(["agent", "you"]).toContain(e.actor);
});

import { afterEach, expect, test } from "bun:test";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readBoard } from "../src/board/log.ts";
import { cleanupAll, type P, project } from "./cli.ts";
afterEach(cleanupAll);

const boardFile = (p: P) => join(p.dir, ".werk", "board.jsonl");
const boardRaw = (p: P) => (existsSync(boardFile(p)) ? readFileSync(boardFile(p), "utf8") : "");
const boardEvents = (p: P) => boardRaw(p).split("\n").filter(Boolean).map((l) => JSON.parse(l));
function seedBoard(p: P, type: string, payload: object, actor = "agent") {
  const seq = boardEvents(p).length + 1;
  appendFileSync(boardFile(p), `${JSON.stringify({ seq, at: new Date().toISOString(), actor, type, payload })}\n`);
}
function setup(ids: string[]): P {
  const p = project();
  p.card("root", "Root");
  p.card("auth", "Auth", { parent: "root" });
  for (const id of ids) seedBoard(p, "ticket.planned", { id, title: `Ticket ${id}`, blocked_by: [] });
  return p;
}
const ticketOf = (p: P, id: string) => readBoard(boardFile(p)).tickets.get(id);

test("27.1 archive a blocked ticket and restore it to the same column and reason", () => {
  const p = setup(["auth/01"]);
  const mv = p.werk("ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API");
  expect(mv.code).toBe(0);
  const ar = p.werk("ticket", "archive", "auth/01");
  expect(ar.code).toBe(0);
  const list = p.werk("ticket", "list");
  console.log("list:", list.code, list.all);
  const listOk = list.code === 0 && /auth\/01/.test(list.out) && /archived/.test(list.out) && list.out.includes("waits for the token API") && /blocked/.test(list.out);
  // record board state through the fold too
  expect(ticketOf(p, "auth/01")).toMatchObject({ archived: true, column: "blocked", reason: "waits for the token API" });
  const decisionBefore = p.raw();
  const beforeLen = boardEvents(p).length;
  const rs = p.werk("ticket", "restore", "01", "--actor", "you");
  console.log("restore 01:", rs.code, rs.all);
  const restoredBy01 = rs.code === 0;
  const after = boardEvents(p);
  console.log("new board events:", JSON.stringify(after.slice(beforeLen)));
  console.log("ticket after:", JSON.stringify(ticketOf(p, "auth/01")));
  expect(p.raw()).toBe(decisionBefore);
  expect(listOk).toBe(true);
  expect(restoredBy01).toBe(true);
  expect(after.length).toBe(beforeLen + 1);
  expect(after.at(-1)).toMatchObject({ type: "ticket.restored", actor: "you" });
  expect(ticketOf(p, "auth/01")).toMatchObject({ archived: false, column: "blocked", reason: "waits for the token API" });
});

test("27.2 a move without a reason is refused", () => {
  const p = setup(["auth/01"]);
  const before = boardRaw(p);
  const r = p.werk("ticket", "move", "auth/01", "blocked");
  console.log(r.code, r.all);
  expect(r.code).not.toBe(0);
  expect(r.all).toMatch(/reason/);
  expect(boardRaw(p)).toBe(before);
  expect(ticketOf(p, "auth/01")?.column).toBe("ready");
  const list = p.werk("ticket", "list");
  console.log("list:", list.code, list.all);
  expect(list.code).toBe(0);
  expect(list.out).toMatch(/auth\/01.*ready|ready[\s\S]*auth\/01/);
});

test("27.3 restoring a ticket that is not archived changes nothing", () => {
  const p = setup(["auth/02"]);
  const before = boardRaw(p);
  const a = p.werk("ticket", "restore", "02");
  console.log(a.code, a.all);
  expect(a.code).toBe(1);
  expect(boardRaw(p)).toBe(before);
  const b = p.werk("ticket", "restore", "99");
  console.log(b.code, b.all);
  expect(b.code).toBe(1);
  expect(boardRaw(p)).toBe(before);
});

test("27.4 a done ticket cannot be archived", () => {
  const p = setup(["auth/03"]);
  seedBoard(p, "ticket.moved", { id: "auth/03", to: "building" });
  seedBoard(p, "ticket.moved", { id: "auth/03", to: "merging" });
  seedBoard(p, "ticket.moved", { id: "auth/03", to: "done" });
  expect(ticketOf(p, "auth/03")?.column).toBe("done");
  const before = boardRaw(p);
  const r = p.werk("ticket", "archive", "auth/03");
  console.log(r.code, r.all);
  expect(r.code).not.toBe(0);
  expect(r.all).toMatch(/done/);
  expect(r.all).toMatch(/archiv/);
  expect(boardRaw(p)).toBe(before);
  expect(ticketOf(p, "auth/03")).toMatchObject({ column: "done", archived: false });
  const list = p.werk("ticket", "list");
  console.log("list:", list.code, list.all);
  expect(list.code).toBe(0);
  expect(list.out).toMatch(/auth\/03/);
});

test("27.5 the board listing shows every ticket in the column its events lead to", () => {
  const p = setup(["auth/01", "auth/02", "auth/03"]);
  expect(p.werk("ticket", "move", "auth/02", "blocked", "--reason", "needs the API").code).toBe(0);
  expect(p.werk("ticket", "archive", "auth/03").code).toBe(0);
  const list = p.werk("ticket", "list");
  console.log("list:", list.code, list.all);
  const b = readBoard(boardFile(p));
  expect(b.tickets.get("auth/01")).toMatchObject({ column: "ready", archived: false });
  expect(b.tickets.get("auth/02")).toMatchObject({ column: "blocked", reason: "needs the API" });
  expect(b.tickets.get("auth/03")?.archived).toBe(true);
  for (const e of boardEvents(p)) expect(["agent", "you"]).toContain(e.actor);
  expect(list.code).toBe(0);
  expect(list.out).toContain("auth/01");
  expect(list.out).toContain("needs the API");
});

import { expect, test } from "bun:test";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { all, freshProject, logText } from "./helpers.ts";

type P = ReturnType<typeof freshProject>;
const boardFile = (p: P) => join(p.dir, ".werk", "board.jsonl");
const boardText = (p: P) => (existsSync(boardFile(p)) ? readFileSync(boardFile(p), "utf8") : "");
const boardLines = (p: P) => boardText(p).split("\n").filter(Boolean).map((l) => JSON.parse(l));
function ev(p: P, type: string, payload: object, actor = "agent") {
  appendFileSync(boardFile(p), `${JSON.stringify({ seq: boardLines(p).length + 1, at: "t", actor, type, payload })}\n`);
}
const planned = (p: P, id: string, blocked: string[] = []) => ev(p, "ticket.planned", { id, title: `T ${id}`, blocked_by: blocked });

test("[27.1] archive a blocked ticket and restore it to the same column and reason", async () => {
  const p = freshProject();
  planned(p, "auth/01");
  const logBefore = logText(p);
  const m = await p.werk(["ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API"]);
  expect(m.code, all(m)).toBe(0);
  const a = await p.werk(["ticket", "archive", "auth/01"]);
  expect(a.code, all(a)).toBe(0);
  const l = await p.werk(["ticket", "list"]);
  expect(l.code, all(l)).toBe(0);
  expect(l.out).toMatch(/auth\/01.*archived/);
  expect(l.out).toContain("blocked");
  expect(l.out).toContain("waits for the token API");
  const n = boardLines(p).length;
  const r = await p.werk(["ticket", "restore", "01", "--actor", "you"]);
  expect(r.code, all(r)).toBe(0);
  const l2 = await p.werk(["ticket", "list"]);
  expect(l2.out).toMatch(/auth\/01.*blocked/);
  expect(l2.out).toContain("waits for the token API");
  expect(boardLines(p).length).toBe(n + 1);
  expect(boardLines(p).at(-1).type).toBe("ticket.restored");
  expect(boardLines(p).at(-1).actor).toBe("you");
  expect(logText(p)).toBe(logBefore);
});

test("[27.2] a move without a reason is refused", async () => {
  const p = freshProject();
  planned(p, "auth/01");
  const n = boardLines(p).length;
  const r = await p.werk(["ticket", "move", "auth/01", "blocked"]);
  expect(r.code).not.toBe(0);
  expect(all(r)).toMatch(/reason/);
  const l = await p.werk(["ticket", "list"]);
  expect(l.out).toMatch(/auth\/01.*ready/);
  expect(boardLines(p).length).toBe(n);
});

test("[27.3] restoring a ticket that is not archived changes nothing", async () => {
  const p = freshProject();
  planned(p, "auth/02");
  const before = boardText(p);
  const r = await p.werk(["ticket", "restore", "02"]);
  expect(r.code).toBe(1);
  expect(boardText(p)).toBe(before);
  const r2 = await p.werk(["ticket", "restore", "99"]);
  expect(r2.code).toBe(1);
  expect(boardText(p)).toBe(before);
});

test("[27.4] a done ticket cannot be archived", async () => {
  const p = freshProject();
  planned(p, "auth/03");
  ev(p, "ticket.moved", { id: "auth/03", to: "building" });
  ev(p, "ticket.moved", { id: "auth/03", to: "merging" });
  ev(p, "ticket.moved", { id: "auth/03", to: "done" });
  const n = boardLines(p).length;
  const r = await p.werk(["ticket", "archive", "auth/03"]);
  expect(r.code).not.toBe(0);
  expect(all(r)).toMatch(/done/);
  const l = await p.werk(["ticket", "list"]);
  expect(l.out).toMatch(/auth\/03.*done/);
  expect(l.out).not.toMatch(/auth\/03.*archived/);
  expect(boardLines(p).length).toBe(n);
});

test("[27.5] the board listing shows every ticket in the column its events lead to", async () => {
  const p = freshProject();
  for (const n of ["01", "02", "03"]) planned(p, `auth/${n}`);
  await p.werk(["ticket", "move", "auth/02", "blocked", "--reason", "needs input"]);
  await p.werk(["ticket", "archive", "auth/03"]);
  const l = await p.werk(["ticket", "list"]);
  expect(l.code, all(l)).toBe(0);
  expect(l.out).toMatch(/auth\/01.*ready/);
  expect(l.out).toMatch(/auth\/02.*blocked/);
  expect(l.out).toContain("needs input");
  expect(l.out).toMatch(/auth\/03.*archived/);
  for (const e of boardLines(p)) expect(["agent", "you"]).toContain(e.actor);
});

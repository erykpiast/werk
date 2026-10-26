import { expect, test } from "bun:test";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, mk } from "./h.ts";

const all = (r: { out: string; err: string }) => r.out + r.err;

function board(h: ReturnType<typeof mk>) {
  const file = join(h.p.dir, ".werk", "board.jsonl");
  const lines = () => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : []);
  const put = (type: string, payload: object, actor = "agent") =>
    appendFileSync(file, `${JSON.stringify({ seq: lines().length + 1, at: new Date().toISOString(), actor, type, payload })}\n`);
  const plan = (id: string) => put("ticket.planned", { id, title: `Ticket ${id}`, blocked_by: [] });
  return { file, lines, put, plan, raw: () => (existsSync(file) ? readFileSync(file, "utf8") : "") };
}

test("[27.1] archive a blocked ticket and restore it", async () => {
  const h = mk();
  const b = board(h);
  b.plan("auth/01");
  const decision = readFileSync(h.logFile, "utf8");
  const mv = await h.w("ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API");
  console.log("move:", all(mv));
  expect(mv.code).toBe(0);
  const ar = await h.w("ticket", "archive", "auth/01");
  console.log("archive:", all(ar));
  expect(ar.code).toBe(0);
  const l = await h.w("ticket", "list");
  console.log("list:", all(l));
  expect(l.code).toBe(0);
  expect(l.out).toMatch(/auth\/01.*archived/);
  expect(l.out).toContain("blocked");
  expect(l.out).toContain("waits for the token API");
  const n = b.lines().length;
  const rs = await h.w("ticket", "restore", "01", "--actor", "you");
  console.log("restore:", all(rs));
  expect(rs.code).toBe(0);
  const l2 = await h.out("ticket", "list");
  expect(l2).toMatch(/auth\/01.*blocked/);
  expect(l2).toContain("waits for the token API");
  expect(b.lines().length).toBe(n + 1);
  const last = JSON.parse(b.lines().at(-1) as string);
  expect(last.type).toBe("ticket.restored");
  expect(last.actor).toBe("you");
  expect(readFileSync(h.logFile, "utf8")).toBe(decision);
});

test("[27.2] a move without a reason is refused", async () => {
  const h = mk();
  const b = board(h);
  b.plan("auth/01");
  const n = b.lines().length;
  const r = await h.w("ticket", "move", "auth/01", "blocked");
  expect(r.code).not.toBe(0);
  expect(all(r)).toMatch(/reason/);
  expect(b.lines().length).toBe(n);
  const l = await h.w("ticket", "list");
  console.log(all(l));
  expect(l.out).toMatch(/auth\/01.*ready/);
});

test("[27.3] restoring a ticket that is not archived changes nothing", async () => {
  const h = mk();
  const b = board(h);
  b.plan("auth/02");
  const before = b.raw();
  const r = await h.w("ticket", "restore", "02");
  console.log(all(r));
  expect(r.code).toBe(1);
  expect(b.raw()).toBe(before);
  const r2 = await h.w("ticket", "restore", "99");
  console.log(all(r2));
  expect(r2.code).toBe(1);
  expect(b.raw()).toBe(before);
});

test("[27.4] a done ticket cannot be archived", async () => {
  const h = mk();
  const b = board(h);
  b.plan("auth/03");
  b.put("ticket.moved", { id: "auth/03", to: "building" });
  b.put("ticket.moved", { id: "auth/03", to: "merging" });
  b.put("ticket.moved", { id: "auth/03", to: "done" });
  const n = b.lines().length;
  const r = await h.w("ticket", "archive", "auth/03");
  console.log(all(r));
  expect(r.code).not.toBe(0);
  expect(all(r)).toMatch(/done/);
  expect(b.lines().length).toBe(n);
  const l = await h.w("ticket", "list");
  console.log(all(l));
  expect(l.out).toMatch(/auth\/03.*done/);
  expect(l.out).not.toMatch(/auth\/03.*archived/);
});

test("[27.5] the listing shows every ticket in its column", async () => {
  const h = mk();
  const b = board(h);
  for (const t of ["01", "02", "03"]) b.plan(`auth/${t}`);
  const m = await h.w("ticket", "move", "auth/02", "blocked", "--reason", "needs tokens");
  expect(m.code).toBe(0);
  const a = await h.w("ticket", "archive", "auth/03");
  expect(a.code).toBe(0);
  const l = await h.w("ticket", "list");
  console.log(all(l));
  expect(l.code).toBe(0);
  expect(l.out).toMatch(/auth\/01.*ready/);
  expect(l.out).toMatch(/auth\/02.*blocked.*needs tokens/);
  expect(l.out).toMatch(/auth\/03.*archived/);
  for (const line of b.lines()) expect(["agent", "you"]).toContain(JSON.parse(line).actor);
});

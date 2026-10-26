import { expect, test } from "bun:test";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mk } from "./lib.ts";

function board(h: ReturnType<typeof mk>) {
  const file = join(h.dir, ".werk", "board.jsonl");
  const read = () => (existsSync(file) ? readFileSync(file, "utf8") : "");
  const n = () => read().split("\n").filter(Boolean).length;
  const put = (type: string, payload: object, actor = "agent") =>
    appendFileSync(file, `${JSON.stringify({ seq: n() + 1, at: "t", actor, type, payload })}\n`);
  const planned = (id: string) => put("ticket.planned", { id, title: `T ${id}`, blocked_by: [] });
  return { read, n, put, planned, events: () => read().split("\n").filter(Boolean).map((l) => JSON.parse(l)) };
}

test("27.1 archive blocked ticket and restore", async () => {
  const h = mk();
  const b = board(h);
  b.planned("auth/01");
  const dec = h.logText();
  expect((await h.w("ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API")).code).toBe(0);
  expect((await h.w("ticket", "archive", "auth/01")).code).toBe(0);
  const list = await h.w("ticket", "list");
  console.log(list.out, list.err);
  expect(list.code).toBe(0);
  expect(list.out).toContain("auth/01");
  expect(list.out).toMatch(/archived/);
  expect(list.out).toMatch(/blocked/);
  expect(list.out).toContain("waits for the token API");
  const n = b.n();
  const r = await h.w("ticket", "restore", "01", "--actor", "you");
  console.log(r.out, r.err);
  expect(r.code).toBe(0);
  const list2 = (await h.w("ticket", "list")).out;
  expect(list2).toContain("blocked");
  expect(list2).toContain("waits for the token API");
  expect(b.n()).toBe(n + 1);
  const last = b.events().at(-1);
  expect(last.type).toBe("ticket.restored");
  expect(last.actor).toBe("you");
  expect(h.logText()).toBe(dec);
});

test("27.2 move without reason refused", async () => {
  const h = mk();
  const b = board(h);
  b.planned("auth/01");
  const n = b.n();
  const r = await h.w("ticket", "move", "auth/01", "blocked");
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/reason/);
  const list = await h.w("ticket", "list");
  expect(list.code).toBe(0);
  expect(list.out).toMatch(/auth\/01.*ready|ready[\s\S]*auth\/01/);
  expect(b.n()).toBe(n);
});

test("27.3 restoring a non-archived or unknown ticket changes nothing", async () => {
  const h = mk();
  const b = board(h);
  b.planned("auth/02");
  const before = b.read();
  const r = await h.w("ticket", "restore", "02");
  expect(r.code).toBe(1);
  expect(b.read()).toBe(before);
  const r2 = await h.w("ticket", "restore", "99");
  expect(r2.code).toBe(1);
  expect(b.read()).toBe(before);
});

test("27.4 done ticket cannot be archived", async () => {
  const h = mk();
  const b = board(h);
  b.planned("auth/03");
  for (const to of ["building", "merging", "done"]) b.put("ticket.moved", { id: "auth/03", to });
  const before = b.read();
  const r = await h.w("ticket", "archive", "auth/03");
  console.log(r.out, r.err);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/done/);
  const list = await h.w("ticket", "list");
  expect(list.code).toBe(0);
  expect(list.out).toContain("done");
  expect(list.out).not.toMatch(/archived/);
  expect(b.read()).toBe(before);
});

test("27.5 listing shows each ticket in its column", async () => {
  const h = mk();
  const b = board(h);
  for (const i of ["01", "02", "03"]) b.planned(`auth/${i}`);
  expect((await h.w("ticket", "move", "auth/02", "blocked", "--reason", "needs api")).code).toBe(0);
  expect((await h.w("ticket", "archive", "auth/03")).code).toBe(0);
  const list = await h.w("ticket", "list");
  console.log(list.out, list.err);
  expect(list.code).toBe(0);
  const line = (id: string) => list.out.split("\n").find((l) => l.includes(id)) ?? "";
  expect(line("auth/01")).toMatch(/ready/);
  expect(line("auth/02")).toMatch(/blocked/);
  expect(line("auth/02")).toContain("needs api");
  expect(line("auth/03")).toMatch(/archived/);
  for (const e of b.events()) expect(["agent", "you"]).toContain(e.actor);
});

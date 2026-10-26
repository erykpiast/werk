import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { useWerk } from "./support.ts";

const w = useWerk();
const planned = (id: string) => ({ type: "ticket.planned", id, title: `T ${id}` });
const lineCount = () => w.boardLines().length;

test("27.1 archive a blocked ticket and restore it to the same column and reason", async () => {
  w.seed(planned("auth/01"));
  const mv = await w.werk("ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API");
  expect(mv.code).toBe(0);
  const ar = await w.werk("ticket", "archive", "auth/01");
  expect(ar.code).toBe(0);
  const list = await w.werk("ticket", "list");
  expect(list.code).toBe(0);
  expect(list.stdout).toContain("auth/01");
  expect(list.stdout).toContain("archived");
  expect(list.stdout).toContain("blocked");
  expect(list.stdout).toContain("waits for the token API");
  const before = lineCount();
  const rs = await w.werk("ticket", "restore", "01", "--actor", "you");
  expect(rs.code).toBe(0);
  const after = await w.werk("ticket", "list");
  expect(after.stdout).toContain("blocked");
  expect(after.stdout).toContain("waits for the token API");
  expect(after.stdout).not.toContain("archived");
  expect(lineCount()).toBe(before + 1);
  const last = JSON.parse(w.boardLines().at(-1) as string);
  expect(last.type).toBe("ticket.restored");
  expect(last.actor).toBe("you");
});

test("27.2 a move without a reason is refused", async () => {
  w.seed(planned("auth/01"));
  const before = w.boardText();
  const r = await w.werk("ticket", "move", "auth/01", "blocked");
  expect(r.code).not.toBe(0);
  expect(r.stderr.toLowerCase()).toContain("reason");
  const list = await w.werk("ticket", "list");
  expect(list.stdout).toMatch(/auth\/01.*ready|ready[\s\S]*auth\/01/);
  expect(w.boardText()).toBe(before);
});

test("27.3 restoring a ticket that is not archived changes nothing", async () => {
  w.seed(planned("auth/02"));
  const before = w.boardText();
  const a = await w.werk("ticket", "restore", "02");
  expect(a.code).toBe(1);
  expect(w.boardText()).toBe(before);
  const b = await w.werk("ticket", "restore", "99");
  expect(b.code).toBe(1);
  expect(w.boardText()).toBe(before);
});

test("27.4 a done ticket cannot be archived", async () => {
  w.seed(
    planned("auth/03"),
    { type: "ticket.moved", id: "auth/03", to: "building" },
    { type: "ticket.moved", id: "auth/03", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "auth/03" },
  );
  const before = w.boardText();
  const r = await w.werk("ticket", "archive", "auth/03");
  expect(r.code).not.toBe(0);
  expect(r.stderr.toLowerCase()).toContain("done");
  expect(r.stderr.toLowerCase()).toContain("archiv");
  const list = await w.werk("ticket", "list");
  expect(list.stdout).toContain("done");
  expect(list.stdout).not.toContain("archived");
  expect(w.boardText()).toBe(before);
});

test("27.5 the listing shows every ticket in the column its events lead to", async () => {
  w.seed(planned("auth/01"), planned("auth/02"), planned("auth/03"));
  expect((await w.werk("ticket", "move", "auth/02", "blocked", "--reason", "needs keys")).code).toBe(0);
  expect((await w.werk("ticket", "archive", "auth/03")).code).toBe(0);
  const list = await w.werk("ticket", "list");
  expect(list.code).toBe(0);
  const line = (id: string) => list.stdout.split("\n").find((l) => l.includes(id)) ?? "";
  expect(line("auth/01")).toContain("ready");
  expect(line("auth/02")).toContain("blocked");
  expect(line("auth/02")).toContain("needs keys");
  expect(line("auth/03")).toContain("archived");
  for (const l of w.boardLines()) {
    const ev = JSON.parse(l);
    expect(typeof ev.actor).toBe("string");
  }
  void readFileSync;
});

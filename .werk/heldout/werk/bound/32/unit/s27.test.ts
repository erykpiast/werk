import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "bun:test";
import { werkHarness } from "./h.ts";

const { project, werk } = werkHarness();

const boardPath = () => join(dirname(project().logPath), "board.jsonl");
const seed = (...events: Record<string, unknown>[]) => {
  for (const e of events) appendFileSync(boardPath(), `${JSON.stringify(e)}\n`);
};
const boardText = () => (existsSync(boardPath()) ? readFileSync(boardPath(), "utf8") : "");
const planned = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "ticket.planned",
  id,
  title: `Ticket ${id}`,
  ...extra,
});

test("27.1 archive a blocked ticket and restore it to the same column and reason", async () => {
  seed(planned("auth/01"));
  const move = await werk("ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API");
  expect(move.code).toBe(0);
  const archive = await werk("ticket", "archive", "auth/01");
  expect(archive.code).toBe(0);
  const list = await werk("ticket", "list");
  expect(list.stdout).toMatch(/auth\/01.*archived/);
  expect(list.stdout).toContain("blocked");
  expect(list.stdout).toContain("waits for the token API");
  const before = boardText().split("\n").filter(Boolean).length;
  const decisionBefore = existsSync(project().logPath) ? readFileSync(project().logPath, "utf8") : "";
  const restore = await werk("ticket", "restore", "01", "--actor", "you");
  expect(restore.code).toBe(0);
  const after = await werk("ticket", "list");
  expect(after.stdout).toMatch(/auth\/01.*blocked/);
  expect(after.stdout).toContain("waits for the token API");
  const events = boardText().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  expect(events.length).toBe(before + 1);
  expect(events.at(-1)).toMatchObject({ type: "ticket.restored", actor: "you" });
  const decisionAfter = existsSync(project().logPath) ? readFileSync(project().logPath, "utf8") : "";
  expect(decisionAfter).toBe(decisionBefore);
});

test("27.2 a move without a reason is refused", async () => {
  seed(planned("auth/01"));
  const before = boardText();
  const r = await werk("ticket", "move", "auth/01", "blocked");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/reason/i);
  const list = await werk("ticket", "list");
  expect(list.stdout).toMatch(/auth\/01.*ready/);
  expect(boardText()).toBe(before);
});

test("27.3 restoring a ticket that is not archived changes nothing", async () => {
  seed(planned("auth/02"));
  const before = boardText();
  const r = await werk("ticket", "restore", "02");
  expect(r.code).toBe(1);
  expect(boardText()).toBe(before);
  const r2 = await werk("ticket", "restore", "99");
  expect(r2.code).toBe(1);
  expect(boardText()).toBe(before);
});

test("27.4 a done ticket cannot be archived", async () => {
  seed(
    planned("auth/03"),
    { type: "ticket.moved", id: "auth/03", to: "building", actor: "loop" },
    { type: "ticket.moved", id: "auth/03", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "auth/03" },
  );
  const before = boardText();
  const r = await werk("ticket", "archive", "auth/03");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/done/i);
  const list = await werk("ticket", "list");
  expect(list.stdout).toMatch(/auth\/03.*done/);
  expect(list.stdout).not.toMatch(/auth\/03.*archived/);
  expect(boardText()).toBe(before);
});

test("27.5 the board listing shows every ticket in the column its events lead to", async () => {
  seed(planned("auth/01"), planned("auth/02"), planned("auth/03"));
  expect((await werk("ticket", "move", "auth/02", "blocked", "--reason", "needs the api")).code).toBe(0);
  expect((await werk("ticket", "archive", "auth/03")).code).toBe(0);
  const list = await werk("ticket", "list");
  expect(list.stdout).toMatch(/auth\/01.*ready/);
  expect(list.stdout).toMatch(/auth\/02.*blocked.*needs the api/);
  expect(list.stdout).toMatch(/auth\/03.*archived/);
  const events = boardText().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  for (const e of events.slice(3)) expect(typeof e.actor).toBe("string");
});

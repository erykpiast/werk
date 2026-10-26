import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import { boardEvents, boardText, seedBoard, werk } from "./g5-helpers.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());
const planned = (id: string) => ({ type: "ticket.planned", id, actor: "agent" });
const ticketList = async () => (await werk(p, "ticket", "list")).stdout;
const lineOf = (text: string, id: string) => text.split("\n").find((l) => l.includes(id)) ?? "";

test("27.1 archive a blocked ticket and restore it to the same column and reason", async () => {
  seedBoard(p, planned("auth/01"));
  const m = await werk(p, "ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API");
  expect(m.code).toBe(0);
  const a = await werk(p, "ticket", "archive", "auth/01");
  expect(a.code).toBe(0);
  const listing = lineOf(await ticketList(), "auth/01");
  expect(listing).toContain("archived");
  expect(listing).toContain("blocked");
  expect(listing).toContain("waits for the token API");
  const before = boardEvents(p).length;
  const r = await werk(p, "ticket", "restore", "01", "--actor", "you");
  expect(r.code).toBe(0);
  const after = lineOf(await ticketList(), "auth/01");
  expect(after).toContain("blocked");
  expect(after).toContain("waits for the token API");
  expect(after).not.toContain("archived");
  const events = boardEvents(p);
  expect(events).toHaveLength(before + 1);
  expect(events.at(-1)).toMatchObject({ type: "ticket.restored", actor: "you" });
});

test("27.2 a move without a reason is refused", async () => {
  seedBoard(p, planned("auth/01"));
  const before = boardText(p);
  const m = await werk(p, "ticket", "move", "auth/01", "blocked");
  expect(m.code).not.toBe(0);
  expect(m.stderr).toMatch(/reason/);
  expect(lineOf(await ticketList(), "auth/01")).toContain("ready");
  expect(boardText(p)).toBe(before);
});

test("27.3 restoring a ticket that is not archived changes nothing", async () => {
  seedBoard(p, planned("auth/02"));
  const before = boardText(p);
  expect((await werk(p, "ticket", "restore", "02")).code).toBe(1);
  expect(boardText(p)).toBe(before);
  expect((await werk(p, "ticket", "restore", "99")).code).toBe(1);
  expect(boardText(p)).toBe(before);
});

test("27.4 a done ticket cannot be archived", async () => {
  seedBoard(
    p,
    planned("auth/03"),
    { type: "ticket.moved", id: "auth/03", to: "building" },
    { type: "ticket.moved", id: "auth/03", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "auth/03" },
  );
  const before = boardText(p);
  const a = await werk(p, "ticket", "archive", "auth/03");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/done/);
  const line = lineOf(await ticketList(), "auth/03");
  expect(line).toContain("done");
  expect(line).not.toContain("archived");
  expect(boardText(p)).toBe(before);
});

test("27.5 the listing shows every ticket in the column its events lead to", async () => {
  seedBoard(p, planned("auth/01"), planned("auth/02"), planned("auth/03"));
  expect((await werk(p, "ticket", "move", "auth/02", "blocked", "--reason", "waits")).code).toBe(0);
  expect((await werk(p, "ticket", "archive", "auth/03")).code).toBe(0);
  const out = await ticketList();
  expect(lineOf(out, "auth/01")).toContain("ready");
  expect(lineOf(out, "auth/02")).toContain("blocked");
  expect(lineOf(out, "auth/02")).toContain("waits");
  expect(lineOf(out, "auth/03")).toContain("archived");
  for (const e of boardEvents(p)) expect(typeof (e as { actor?: unknown }).actor).toBe("string");
});

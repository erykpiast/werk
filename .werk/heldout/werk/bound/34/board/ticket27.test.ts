import { afterEach, beforeEach, expect, test } from "bun:test";
import { harness } from "./util.ts";

const h = harness();
beforeEach(() => h.create());
afterEach(() => h.dispose());

const planned = (id: string) => ({ type: "ticket.planned", id });

test("27.1 archive a blocked ticket and restore it to the same column and reason", async () => {
  h.seedBoard(planned("auth/01"));
  const decisionLogBefore = await Bun.file(h.project.logPath).exists();
  const move = await h.werk(
    "ticket",
    "move",
    "auth/01",
    "blocked",
    "--reason",
    "waits for the token API",
  );
  expect(move.code).toBe(0);
  const archive = await h.werk("ticket", "archive", "auth/01");
  expect(archive.code).toBe(0);
  const list = await h.werk("ticket", "list");
  expect(list.stdout).toContain("auth/01");
  expect(list.stdout).toContain("archived");
  expect(list.stdout).toContain("blocked");
  expect(list.stdout).toContain("waits for the token API");
  const before = h.boardLines().length;
  const restore = await h.werk("ticket", "restore", "01", "--actor", "you");
  expect(restore.code).toBe(0);
  const after = await h.werk("ticket", "list");
  expect(after.stdout).toContain("blocked");
  expect(after.stdout).toContain("waits for the token API");
  expect(after.stdout).not.toContain("archived");
  const lines = h.boardLines();
  expect(lines).toHaveLength(before + 1);
  expect(lines.at(-1)).toMatchObject({ type: "ticket.restored", actor: "you" });
  expect(await Bun.file(h.project.logPath).exists()).toBe(decisionLogBefore);
}, 30000);

test("27.2 a move without a reason is refused", async () => {
  h.seedBoard(planned("auth/01"));
  const before = h.boardText();
  const result = await h.werk("ticket", "move", "auth/01", "blocked");
  expect(result.code).not.toBe(0);
  expect(result.stderr.toLowerCase()).toContain("reason");
  const list = await h.werk("ticket", "list");
  expect(list.stdout).toContain("ready");
  expect(h.boardText()).toBe(before);
}, 30000);

test("27.3 restoring a ticket that is not archived changes nothing", async () => {
  h.seedBoard(planned("auth/02"));
  const before = h.boardText();
  const first = await h.werk("ticket", "restore", "02");
  expect(first.code).toBe(1);
  expect(h.boardText()).toBe(before);
  const second = await h.werk("ticket", "restore", "99");
  expect(second.code).toBe(1);
  expect(h.boardText()).toBe(before);
}, 30000);

test("27.4 a done ticket cannot be archived", async () => {
  h.seedBoard(
    planned("auth/03"),
    { type: "ticket.moved", id: "auth/03", to: "building" },
    { type: "ticket.moved", id: "auth/03", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "auth/03" },
  );
  const before = h.boardText();
  const result = await h.werk("ticket", "archive", "auth/03");
  expect(result.code).not.toBe(0);
  expect(result.stderr.toLowerCase()).toContain("done");
  const list = await h.werk("ticket", "list");
  expect(list.stdout).toContain("done");
  expect(list.stdout).not.toContain("archived");
  expect(h.boardText()).toBe(before);
}, 30000);

test("27.5 the board listing shows every ticket in the column its events lead to", async () => {
  h.seedBoard(planned("auth/01"), planned("auth/02"), planned("auth/03"));
  expect(
    (await h.werk("ticket", "move", "auth/02", "blocked", "--reason", "why"))
      .code,
  ).toBe(0);
  expect((await h.werk("ticket", "archive", "auth/03")).code).toBe(0);
  const list = await h.werk("ticket", "list");
  expect(list.code).toBe(0);
  const row = (id: string) =>
    list.stdout.split("\n").find((l) => l.includes(id)) ?? "";
  expect(row("auth/01")).toContain("ready");
  expect(row("auth/02")).toContain("blocked");
  expect(row("auth/02")).toContain("why");
  expect(row("auth/03")).toContain("archived");
  // every event must name its actor
  for (const event of h.boardLines().filter((e) => e.type !== "ticket.planned"))
    expect(event.actor).toBeDefined();
}, 30000);

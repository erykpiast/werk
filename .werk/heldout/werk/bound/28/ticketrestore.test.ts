import { expect } from "bun:test";
import { t } from "./helpers.ts";

const planned = (id: string) => ({ type: "ticket.planned", id, title: `Ticket ${id}` });

t("27.1 archive a blocked ticket and restore it to the same column and reason", async (ctx) => {
  ctx.seedBoard(planned("auth/01"));
  const mapBefore = ctx.mapLog();
  const move = await ctx.werk("ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API");
  expect(move.code).toBe(0);
  const arch = await ctx.werk("ticket", "archive", "auth/01");
  expect(arch.code).toBe(0);
  const listed = (await ctx.werk("ticket", "list")).stdout;
  expect(listed).toMatch(/auth\/01.*archived/);
  expect(listed).toContain("blocked");
  expect(listed).toContain("waits for the token API");
  const before = ctx.boardLog().trim().split("\n").length;
  expect((await ctx.werk("ticket", "restore", "01", "--actor", "you")).code).toBe(0);
  const lines = ctx.boardLog().trim().split("\n");
  expect(lines.length).toBe(before + 1);
  expect(JSON.parse(lines[lines.length - 1] as string).actor).toBe("you");
  const after = (await ctx.werk("ticket", "list")).stdout;
  expect(after).toMatch(/auth\/01.*blocked/);
  expect(after).toContain("waits for the token API");
  expect(ctx.mapLog()).toBe(mapBefore);
});

t("27.2 a move without a reason is refused", async (ctx) => {
  ctx.seedBoard(planned("auth/01"));
  const before = ctx.boardLog();
  const r = await ctx.werk("ticket", "move", "auth/01", "blocked");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/reason/);
  expect((await ctx.werk("ticket", "list")).stdout).toMatch(/auth\/01.*ready/);
  expect(ctx.boardLog()).toBe(before);
});

t("27.3 restoring a ticket that is not archived changes nothing", async (ctx) => {
  ctx.seedBoard(planned("auth/02"));
  const before = ctx.boardLog();
  const a = await ctx.werk("ticket", "restore", "02");
  expect(a.code).toBe(1);
  expect(ctx.boardLog()).toBe(before);
  const b = await ctx.werk("ticket", "restore", "99");
  expect(b.code).toBe(1);
  expect(ctx.boardLog()).toBe(before);
});

t("27.4 a done ticket cannot be archived", async (ctx) => {
  ctx.seedBoard(
    planned("auth/03"),
    { type: "ticket.moved", id: "auth/03", to: "building" },
    { type: "ticket.moved", id: "auth/03", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "auth/03" },
  );
  const before = ctx.boardLog();
  const r = await ctx.werk("ticket", "archive", "auth/03");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/done/);
  expect((await ctx.werk("ticket", "list")).stdout).toMatch(/auth\/03.*done/);
  expect(ctx.boardLog()).toBe(before);
});

t("27.5 the board listing shows every ticket in the column its events lead to", async (ctx) => {
  ctx.seedBoard(planned("auth/01"), planned("auth/02"), planned("auth/03"));
  expect((await ctx.werk("ticket", "move", "auth/02", "blocked", "--reason", "needs token")).code).toBe(0);
  expect((await ctx.werk("ticket", "archive", "auth/03")).code).toBe(0);
  const out = (await ctx.werk("ticket", "list")).stdout;
  expect(out).toMatch(/auth\/01.*ready/);
  expect(out).toMatch(/auth\/02.*blocked.*needs token/);
  expect(out).toMatch(/auth\/03.*archived/);
  for (const line of ctx.boardLog().trim().split("\n")) {
    expect(typeof JSON.parse(line).actor).toBe("string");
  }
});

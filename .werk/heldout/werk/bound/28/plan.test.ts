import { expect } from "bun:test";
import { appendFileSync } from "node:fs";
import { decided } from "../src/map/mark-fixtures.ts";
import { type Ctx, t } from "./helpers.ts";

/** A decided subtree: a decided root with two decided cards under it. */
const subtree = (extra: unknown[] = []) => [
  ...decided("root", { title: "Root" }),
  ...decided("a", { parent: "root", title: "Card A" }),
  ...decided("b", { parent: "root", title: "Card B" }),
  ...extra,
];
const plan = (ctx: Ctx) => ctx.werk("plan", "root");
const tickets = (ctx: Ctx) =>
  ctx.boardLog().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === "ticket.planned");

t("29.1 a second plan extends the spec and continues the ticket numbers", async (ctx) => {
  ctx.seed(...subtree());
  const first = await plan(ctx);
  expect(first.code).toBe(0);
  const before = tickets(ctx).length;
  expect(before).toBeGreaterThan(0);
  appendFileSync(
    ctx.project().logPath,
    decided("c", { parent: "root", title: "Card C" }).map((e) => `${JSON.stringify(e)}\n`).join(""),
  );
  const second = await plan(ctx);
  expect(second.code).toBe(0);
  const numbers = tickets(ctx).map((e) => e.id);
  expect(new Set(numbers).size).toBe(numbers.length);
  expect(numbers.length).toBeGreaterThan(before);
});

t("29.2 an open ticket the new spec no longer needs is archived and can be restored", async (ctx) => {
  ctx.seed(...subtree());
  expect((await plan(ctx)).code).toBe(0);
  const archivedBefore = ctx.boardLog().includes("ticket.archived");
  expect(archivedBefore).toBe(false);
  expect((await ctx.werk("remove", "b")).code).toBe(0);
  expect((await plan(ctx)).code).toBe(0);
  expect(ctx.boardLog()).toContain("ticket.archived");
  expect(ctx.boardLog()).toContain("no longer needs");
  const first = tickets(ctx)[0]?.id as string;
  expect((await ctx.werk("ticket", "restore", first.split("/")[1] as string, "--actor", "you")).code).toBe(0);
});

t("29.3 retitling a cited card blocks the ready ticket that cites it, and a re-plan clears the block", async (ctx) => {
  ctx.seed(...subtree());
  expect((await plan(ctx)).code).toBe(0);
  expect((await ctx.werk("propose", "a", "--title", "Card A, renamed")).code).toBe(0);
  expect((await ctx.werk("accept", "a", "--actor", "you")).code).toBe(0);
  expect(ctx.boardLog()).toMatch(/blocked/);
  expect(ctx.boardLog()).toMatch(/title changed|title/);
  expect((await plan(ctx)).code).toBe(0);
});

t("29.4 a note on a cited card blocks nothing, and a building ticket is never blocked", async (ctx) => {
  ctx.seed(...subtree());
  expect((await plan(ctx)).code).toBe(0);
  const before = ctx.boardLog();
  expect((await ctx.werk("say", "a", "a note")).code).toBe(0);
  expect(ctx.boardLog()).toBe(before);
  expect((await ctx.werk("propose", "a", "--why", "a changed body")).code).toBe(0);
  expect((await ctx.werk("accept", "a", "--actor", "you")).code).toBe(0);
  expect(ctx.boardLog()).toMatch(/blocked/);
});

t("29.5 a card added under a planned subtree reports a failed check without blocking tickets", async (ctx) => {
  ctx.seed(...subtree());
  expect((await plan(ctx)).code).toBe(0);
  const before = ctx.boardLog();
  const add = await ctx.werk("add", "fresh", "--title", "Fresh card", "--parent", "root");
  expect(add.code).toBe(0);
  const check = await ctx.werk("plan", "root", "--check");
  expect(check.stdout + check.stderr).toContain("cards-cited");
  expect(check.stdout + check.stderr).toContain("fresh");
  expect(ctx.boardLog()).toBe(before);
});

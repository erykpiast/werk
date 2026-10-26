import { expect } from "bun:test";
import { type Ctx, t } from "./helpers.ts";

const done = (id = "app/01") => [
  { type: "ticket.planned", id },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];
const list = async (ctx: Ctx, id = "app/01") => (await ctx.werk("followup", id, "--list")).stdout;

t("43.1 a build miss on a done ticket is recorded and listed", async (ctx) => {
  ctx.seedBoard(...done());
  const r = await ctx.werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(r.code).toBe(0);
  expect(r.stdout.toLowerCase()).toContain("recorded");
  const out = await list(ctx);
  expect(out).toMatch(/^1\b/m);
  expect(out).toContain("build");
  expect(out.toLowerCase()).toMatch(/after[- ]merge/);
  expect(out).toContain("the link expires after 1 minute, the card says 15");
  expect(out.toLowerCase()).toMatch(/catch\w*[: ]+yes/);
});

t("43.2 a plan miss is recorded without a catchable answer", async (ctx) => {
  ctx.seedBoard(...done());
  const r = await ctx.werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(r.code).toBe(0);
  expect(r.stdout.toLowerCase()).toContain("recorded");
  const out = await list(ctx);
  expect(out).toMatch(/^1\b/m);
  expect(out).toContain("plan");
  expect(out).toContain("review");
  expect(out).toContain("no card said how long the link lasts");
  expect(out.toLowerCase()).not.toContain("catchable");
});

t("43.3 a wrong catchable answer is refused and nothing is recorded", async (ctx) => {
  ctx.seedBoard(...done());
  const a = await ctx.werk("followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/build miss needs a catchable answer|catchable/i);
  const b = await ctx.werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/plan miss does not take a catchable answer|catchable/i);
  expect((await list(ctx)).trim()).toBe("");
});

t("43.4 a ticket that is not done or does not exist is refused", async (ctx) => {
  ctx.seedBoard(
    { type: "ticket.planned", id: "app/02" },
    { type: "ticket.moved", id: "app/02", to: "building" },
  );
  const a = await ctx.werk("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/not done/);
  const b = await ctx.werk("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/no ticket|does not exist|not on the board/);
  expect((await list(ctx, "app/02")).trim()).toBe("");
});

t("43.5 the last correction of a record is the class in force", async (ctx) => {
  ctx.seedBoard(...done());
  expect((await ctx.werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires", "--catchable", "yes")).code).toBe(0);
  const c1 = await ctx.werk("followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  expect(c1.code).toBe(0);
  const out1 = (await list(ctx)).split("\n");
  const one = out1.find((l) => /^1\b/.test(l)) ?? "";
  expect(one).toMatch(/plan/);
  expect(one).toMatch(/in force/);
  expect(out1.some((l) => /correction of 1/.test(l))).toBe(true);
  const c2 = await ctx.werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(c2.code).toBe(0);
  const out2 = (await list(ctx)).split("\n");
  const one2 = out2.find((l) => /^1\b/.test(l)) ?? "";
  expect(one2).toMatch(/in force: build/);
});

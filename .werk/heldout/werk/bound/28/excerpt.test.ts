import { expect } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decided } from "../src/map/mark-fixtures.ts";
import { type Ctx, t } from "./helpers.ts";


async function withExcerpt(ctx: Ctx) {
  ctx.seed(...decided("card", { title: "A card", body: "Words." }));
  const dir = join(ctx.project().dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "talk.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "10:02", session: "6ae61be7", kind: "spoken", text: "we say the exact words here" })}\n`,
  );
  return await ctx.werk("quote", "card", "talk", "the exact words");
}

t("06.1 a new excerpt stages as a ghost with a pending link", async (ctx) => {
  const quote = await withExcerpt(ctx);
  expect(quote.code).toBe(0);
  expect(quote.stdout).toContain("proposed");
  expect(quote.stdout).not.toContain("added");
  const ex = (await ctx.werk("show", "card:ex0")).stdout;
  expect(ex).toContain("proposed");
  const card = (await ctx.werk("show", "card")).stdout;
  expect(card).toContain("card:ex0");
  expect(card).toContain("[proposed]");
  expect(card).toContain("[held]");
  expect(card).toContain("[decided]");
  expect(card).toContain("Words.");
});

t("06.2 an accepted excerpt is no ghost and its link is live", async (ctx) => {
  await withExcerpt(ctx);
  const accept = await ctx.werk("accept", "card:ex0", "--actor", "you");
  expect(accept.code).toBe(0);
  const ex = (await ctx.werk("show", "card:ex0")).stdout;
  expect(ex).not.toContain("proposed");
  const card = (await ctx.werk("show", "card")).stdout;
  expect(card).toContain("supported_by");
  expect(card).toContain("card:ex0");
  expect(card).not.toContain("[proposed]");
  expect(card).not.toContain("[held]");
});

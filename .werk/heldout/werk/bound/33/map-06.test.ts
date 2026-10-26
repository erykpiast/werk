import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decide, setup } from "./map-support.ts";

const s = setup();
beforeEach(() => {
  s.make();
});
afterEach(() => s.done());

async function stage() {
  await decide(s.werk, "pay", "We charge per seat");
  const dir = join(s.p.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "pricing.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "10:02", session: "6ae61be7", kind: "spoken", text: "seats are the unit we bill" })}\n`,
  );
  const before = (await s.werk("show", "pay")).stdout;
  const q = await s.werk("quote", "pay", "pricing", "seats are the unit we bill");
  return { before, q };
}

test("06.1 new excerpt stages as ghost", async () => {
  const { before, q } = await stage();
  expect(q.code).toBe(0);
  expect(q.stdout).toContain("proposed");
  expect(q.stdout).not.toContain("added");
  const shown = (await s.werk("show", "pay:ex0")).stdout;
  console.log(q.stdout, shown, (await s.werk("show", "pay")).stdout);
  expect(shown).toContain("proposed");
  const card = (await s.werk("show", "pay")).stdout;
  expect(card).toMatch(/seats are the unit we bill\s+proposed/);
  expect(card).toContain("[decided]");
  expect(card).toContain("We charge per seat");
  expect(before).toContain("[decided]");
});

test("06.2 accepted excerpt is live", async () => {
  await stage();
  const a = await s.werk("accept", "pay:ex0", "--actor", "you");
  expect(a.code).toBe(0);
  const ex = (await s.werk("show", "pay:ex0")).stdout;
  expect(ex).not.toContain("proposed");
  const card = (await s.werk("show", "pay")).stdout;
  console.log(card);
  expect(card).toContain("seats are the unit we bill");
  expect(card).not.toContain("[held]");
});

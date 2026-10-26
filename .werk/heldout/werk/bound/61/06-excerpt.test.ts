import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Cli, cli, decided } from "./cli.ts";

let c: Cli;
beforeEach(() => {
  c = cli();
  c.write(decided("card1", { title: "We charge per seat", why: "Seats scale" }));
  const dir = join(c.project.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "pricing.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "10:02", session: "6ae61be7", kind: "spoken", text: "yes: seats are the unit we bill" })}\n`,
  );
});
afterEach(() => c.dispose());

test("06.1 a new excerpt stages as a ghost with a pending link; the card is unchanged", async () => {
  const before = (await c.werk("show", "card1")).stdout;
  const r = await c.werk("quote", "card1", "pricing", "seats are the unit we bill");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("proposed");
  expect(r.stdout).not.toContain("added");
  const ex = (await c.werk("show", "card1:ex0")).stdout;
  expect(ex).toContain("proposed");
  const card = (await c.werk("show", "card1")).stdout;
  // The link is shown as proposed (pending) under the card.
  expect(card).toContain("seats are the unit we bill");
  expect(card).toMatch(/Say:\n\s+person: seats are the unit we bill\s+proposed/);
  expect(card).toContain("[decided]");
  expect(card).toContain("We charge per seat");
  expect(card).toContain("why: Seats scale");
  expect(before).toContain("[decided]");
});

test("06.2 an accepted excerpt is no longer a ghost and its link is live", async () => {
  await c.werk("quote", "card1", "pricing", "seats are the unit we bill");
  const acc = await c.werk("accept", "card1:ex0", "--actor", "you");
  expect(acc.code).toBe(0);
  const ex = (await c.werk("show", "card1:ex0")).stdout;
  expect(ex).not.toMatch(/\]\s+proposed/);
  const card = (await c.werk("show", "card1")).stdout;
  expect(card).toMatch(/Say:\n\s+person: seats are the unit we bill\n/);
  expect(card).not.toMatch(/person: seats are the unit we bill\s+proposed/);
  expect(c.events().length).toBeGreaterThan(0);
});

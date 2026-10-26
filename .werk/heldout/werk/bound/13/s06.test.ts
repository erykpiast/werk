// 06.1, 06.2: an excerpt is staged as a ghost and goes live with the person's accept.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decided } from "../src/map/mark-fixtures.ts";
import { useTools } from "./support.ts";

const t = useTools();

function arrange() {
  const { project, seed } = t();
  seed(decided("x", { title: "We charge per seat", why: "pricing" }));
  const dir = join(project.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "pricing.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "10:02", session: "6ae61be7", kind: "spoken", text: "yes: seats are the unit we bill" })}\n`,
  );
}

test("06.1 a new excerpt stages as a ghost with a pending link; the card is untouched", async () => {
  arrange();
  const { werk } = t();
  const before = (await werk("show", "x")).stdout;
  const q = await werk("quote", "x", "pricing", "seats are the unit we bill");
  expect(q.code, q.stderr).toBe(0);
  expect(q.stdout).toContain("proposed");
  expect(q.stdout).not.toContain("added");
  const ex = (await werk("show", "x:ex0")).stdout;
  expect(ex).toMatch(/\bproposed\b/);
  const card = (await werk("show", "x")).stdout;
  expect(card).toMatch(/supported_by\s+x:ex0.*\[proposed\].*\[held\]/s);
  // The card keeps its status and its words.
  expect(card.split("\n")[0]).toContain("[decided]");
  expect(card).toContain("We charge per seat");
  expect(card).toContain("why: pricing");
  expect(card.split("\n").slice(0, 3)).toEqual(before.split("\n").slice(0, 3));
});

test("06.2 the accept makes the excerpt real and its link live without a second accept", async () => {
  arrange();
  const { werk } = t();
  await werk("quote", "x", "pricing", "seats are the unit we bill");
  const a = await werk("accept", "x:ex0", "--actor", "you");
  expect(a.code, a.stderr).toBe(0);
  const ex = (await werk("show", "x:ex0")).stdout;
  expect(ex).not.toMatch(/\bproposed\b/);
  const card = (await werk("show", "x")).stdout;
  const row = card.split("\n").find((l) => l.includes("x:ex0")) ?? "";
  expect(row).toContain("supported_by");
  expect(row).not.toContain("[proposed]");
  expect(row).not.toContain("[held]");
});

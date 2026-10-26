import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../../src/test-env/project.ts";
import { decided, werk, writeLog } from "./helpers.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
  writeLog(p, decided("x"));
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(p.dir, ".werk", "chats", "pricing.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "10:02", session: "6ae61be7", kind: "spoken", text: "yes: seats are the unit we bill" })}\n`,
  );
});
afterEach(() => p.dispose());

test("06.1 a new excerpt stages as a ghost and waits", async () => {
  const showBefore = (await werk(p, "show", "x")).stdout;
  const q = await werk(p, "quote", "x", "pricing", "seats are the unit we bill");
  expect(q.code).toBe(0);
  expect(q.stdout).toContain("proposed");
  expect(q.stdout).not.toContain("added");
  const ex = await werk(p, "show", "x:ex0");
  expect(ex.stdout).toMatch(/proposed/);
  const card = (await werk(p, "show", "x")).stdout;
  console.log("06.1 card:\n", card);
  expect(card).toMatch(/Say:\n\s+person: .*proposed/);
  console.log("06.1 ex:", ex.stdout);
  // The card keeps its status and words.
  expect(card).toContain("[decided]");
  const strip = (s: string) => s.split("\n").filter((l) => !/ex0|Say|seats|held|^$/.test(l)).join("\n");
  expect(strip(card)).toBe(strip(showBefore));
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
  await werk(p, "quote", "x", "pricing", "seats are the unit we bill");
  const acc = await werk(p, "accept", "x:ex0", "--actor", "you");
  expect(acc.code).toBe(0);
  const ex = (await werk(p, "show", "x:ex0")).stdout;
  expect(ex).not.toMatch(/proposed/);
  const card = (await werk(p, "show", "x")).stdout;
  console.log("06.2 card:\n", card);
  expect(card).toContain("Say:");
  expect(card).toContain("seats are the unit we bill");
  expect(card).not.toMatch(/held|proposed/);
});

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createProject,
  decided,
  type Project,
  seedMap,
  werk,
} from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
  seedMap(
    p,
    decided("card1", { title: "Card one", why: "because", body: "words" }),
  );
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  const line = {
    kind: "spoken",
    speaker: "you",
    session: "s1",
    at: "2026-10-10T09:00:00.000Z",
    text: "we must keep the link for 15 minutes",
  };
  writeFileSync(
    join(p.dir, ".werk", "chats", "talk.jsonl"),
    `${JSON.stringify(line)}\n`,
  );
});
afterEach(() => p.dispose());

test("06.1 a new excerpt for a decided card stages as a ghost", async () => {
  const before = (await werk(p, "show", "card1")).stdout;
  const r = await werk(p, "quote", "card1", "talk", "keep the link");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("proposed");
  expect(r.stdout).not.toContain("added");
  const ex = await werk(p, "show", "card1:ex0");
  expect(ex.stdout).toContain("proposed");
  const card = (await werk(p, "show", "card1")).stdout;
  expect(card).toContain("card1:ex0");
  expect(card).toContain("[proposed]");
  expect(card).toContain("[held]");
  // status and words are kept
  expect(card).toContain("[decided]");
  expect(card).toContain("Card one");
  expect(card.split("\n")[0]).toBe(before.split("\n")[0]);
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
  await werk(p, "quote", "card1", "talk", "keep the link");
  const a = await werk(p, "accept", "card1:ex0", "--actor", "you");
  expect(a.code).toBe(0);
  const ex = (await werk(p, "show", "card1:ex0")).stdout;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  const card = (await werk(p, "show", "card1")).stdout;
  expect(card).toContain("supported_by");
  expect(card).toContain("card1:ex0");
  expect(card).not.toContain("[proposed]");
  expect(card).not.toContain("[held]");
});

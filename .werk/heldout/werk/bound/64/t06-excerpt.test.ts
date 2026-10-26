import { afterEach, beforeEach, expect, test } from "bun:test";
import { decided } from "../src/map/mark-fixtures.ts";
import { chat, createProject, type Project, seed, spoken, werk } from "./h.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
  seed(p, decided("x", { title: "We charge per seat" }));
  chat(p, "pricing", spoken("yes: seats are the unit we bill"));
});
afterEach(() => p.dispose());

test("06.1 a new excerpt stages as a ghost and waits", async () => {
  const before = (await werk(p, "show", "x")).stdout;
  const r = await werk(p, "quote", "x", "pricing", "seats are the unit we bill");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("proposed");
  expect(r.stdout).not.toContain("added");
  const ex = await werk(p, "show", "x:ex0");
  expect(ex.stdout).toContain("proposed");
  const card = (await werk(p, "show", "x")).stdout;
  // the link from the card to the excerpt shows as pending
  expect(card).toContain("Say:\n  person: seats are the unit we bill  proposed");
  expect(card).toContain("[decided]");
  expect(card.replace(/\n\nSay:[\s\S]*/, "").trim()).toBe(before.trim());
});

test("06.2 an accepted excerpt stops being a ghost, link live", async () => {
  await werk(p, "quote", "x", "pricing", "seats are the unit we bill");
  const a = await werk(p, "accept", "x:ex0", "--actor", "you");
  expect(a.code).toBe(0);
  const ex = await werk(p, "show", "x:ex0");
  expect(ex.stdout).not.toContain("proposed");
  const card = (await werk(p, "show", "x")).stdout;
  expect(card).toContain("Say:\n  person: seats are the unit we bill");
  expect(card).not.toContain("proposed");
});

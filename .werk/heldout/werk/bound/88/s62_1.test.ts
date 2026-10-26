import { expect, test } from "bun:test";
import { card, lines, ok, withMap } from "./h62util.ts";

test("62.1 an agent proposes a card and a person accepts it into the map", async () => {
  const p = withMap([card("root", "Root"), card("older", "Older card", "root")]);
  const l0 = lines(p);
  const add = await ok(p, ["add", "log", "--title", "Use a log", "--body", "The map is a log.", "--why", "A log never loses a write.", "--parent", "root"]);
  expect(add.out).toContain("proposed");
  const l1 = lines(p);
  expect(l1).toHaveLength(l0.length + 1);
  expect(l1.slice(0, l0.length)).toEqual(l0);
  const ghost = (await ok(p, ["show", "log"])).out;
  expect(ghost).toContain("Use a log");
  expect(ghost).toContain("The map is a log.");
  expect(ghost).toContain("A log never loses a write.");
  expect(ghost).toContain("proposed");
  const acc = await p.werk(["accept", "log", "--actor", "you"]);
  expect(acc.code).toBe(0);
  const l2 = lines(p);
  expect(l2).toHaveLength(l1.length + 1);
  expect(l2.slice(0, l1.length)).toEqual(l1);
  const real = (await ok(p, ["show", "log"])).out;
  expect(real).toContain("Use a log");
  expect(real).toContain("The map is a log.");
  expect(real).toContain("A log never loses a write.");
  expect(real).not.toContain("proposed");
  expect(real).not.toContain("ghost");
}, 30_000);

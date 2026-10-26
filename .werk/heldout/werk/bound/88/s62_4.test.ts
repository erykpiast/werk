import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { card, lines, logOf, ok, withMap } from "./h62util.ts";

test("62.4 a retitle on a real card shows only the new title and keeps the old one in the log", async () => {
  const p = withMap([card("root", "Root")]);
  await ok(p, ["add", "log", "--title", "Use a log", "--parent", "root"]);
  await ok(p, ["accept", "log", "--actor", "you"]);
  const before = lines(p);
  const re = await p.werk(["retitle", "log", "Use an append-only log"]);
  expect(re.code).toBe(0);
  const after = lines(p);
  expect(after).toHaveLength(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const show = (await ok(p, ["show", "log"])).out;
  expect(show).toContain("Use an append-only log");
  expect(show).not.toContain("Use a log");
  expect(readFileSync(logOf(p), "utf8").split("\n").some((l, i) => i < before.length && l.includes("Use a log"))).toBe(true);
  expect((await p.werk(["edit", "log", "--body", "The fold reads the log."])).code).toBe(0);
  const shown = (await ok(p, ["show", "log"])).out;
  expect(shown).toContain("The fold reads the log.");
  expect(shown).toContain("Use an append-only log");
}, 30_000);

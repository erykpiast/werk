import { expect, test } from "bun:test";
import { card, lines, ok, withMap } from "./h62util.ts";

test("62.2 an accept without the person's claim refuses and leaves the ghost waiting", async () => {
  const p = withMap([card("root", "Root")]);
  await ok(p, ["add", "log", "--title", "Use a log", "--parent", "root"]);
  const before = lines(p);
  const run = await p.werk(["accept", "log"]);
  expect(run.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", "log"])).out).toContain("proposed");
  expect((await p.werk(["accept", "log", "--actor", "you"])).code).toBe(0);
  expect((await ok(p, ["show", "log"])).out).not.toContain("proposed");
}, 30_000);

import { expect, test } from "bun:test";
import { card, lines, ok, withMap } from "./h62util.ts";

test("04.5 an accept from the command line needs --actor you", async () => {
  const p = withMap([card("root", "Root"), card("real", "A real card", "root")]);
  await ok(p, ["add", "audit", "--title", "Audit log", "--parent", "real"]);
  const before = lines(p);
  const run = await p.werk(["accept", "audit"]);
  expect(run.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", "audit"])).out).toContain("proposed");
  const yes = await p.werk(["accept", "audit", "--actor", "you"]);
  expect(yes.code).toBe(0);
  const real = (await ok(p, ["show", "audit"])).out;
  expect(real).not.toContain("proposed");
  expect(real).toContain("Audit log");
}, 30_000);

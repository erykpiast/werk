import { expect, test } from "bun:test";
import { card, lines, ok, withMap } from "./h62util.ts";

test("08.5 remove refuses without --actor you", async () => {
  const p = withMap([card("root", "Root"), card("login", "Login", "root")]);
  const before = lines(p);
  const run = await p.werk(["remove", "login"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("--actor you");
  expect((await ok(p, ["show", "login"])).out).toContain("Login");
  expect(lines(p)).toEqual(before);
}, 30_000);

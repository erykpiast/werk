import { expect, test } from "bun:test";
import { card, lines, ok, withMap } from "./h62util.ts";

test("08.6 restore refuses without --actor you", async () => {
  const p = withMap([card("root", "Root"), card("login", "Login", "root")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const before = lines(p);
  const run = await p.werk(["restore", "login"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("--actor you");
  expect((await p.werk(["show", "login"])).code).toBe(1);
  expect((await ok(p, ["show", "root"])).out).not.toContain("Login");
  expect(lines(p)).toEqual(before);
}, 30_000);

import { expect, test } from "bun:test";
import { card, ok, withMap } from "./h62util.ts";

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  const p = withMap([
    card("root", "Root"),
    card("platform", "Platform", "root"),
    card("auth", "Auth", "platform"),
    card("login", "Login", "auth"),
    card("session", "Session", "auth"),
  ]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect((await p.werk(["show", "auth"])).code).toBe(1);
  expect((await ok(p, ["show", "platform"])).out).not.toContain("Auth");
  const platform = (await ok(p, ["show", "platform"])).out;
  expect(platform).toMatch(/<- refines\s+login/);
  expect(platform).toMatch(/<- refines\s+session/);
  expect((await ok(p, ["show", "login"])).out).toContain("parent: platform  Platform");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: platform  Platform");

  await ok(p, ["restore", "auth", "--actor", "you"]);
  const platform2 = (await ok(p, ["show", "platform"])).out;
  expect(platform2).toMatch(/<- refines\s+auth/);
  expect(platform2).not.toMatch(/<- refines\s+login/);
  expect(platform2).not.toMatch(/<- refines\s+session/);
  expect((await ok(p, ["show", "auth"])).out).toContain("parent: platform  Platform");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth  Auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth  Auth");
}, 60_000);

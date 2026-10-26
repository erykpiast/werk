import { expect, test } from "bun:test";
import { card, link, ok, withMap } from "./h62util.ts";

test("08.3 a link waits until both of its ends are back", async () => {
  const p = withMap([
    card("root", "Root"),
    card("a", "Branch A", "root"),
    card("b", "Branch B", "root"),
    card("login", "Login", "a"),
    card("session", "Session", "b"),
    link("login", "session", "depends_on", "Login opens a session"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const login = await ok(p, ["show", "login"]);
  expect(login.code).toBe(0);
  expect(login.out).not.toContain("depends_on");
  expect(login.out).not.toContain("session");
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toMatch(/-> depends_on\s+session/);
  expect((await ok(p, ["show", "session"])).out).toMatch(/<- depends_on\s+login/);
}, 60_000);

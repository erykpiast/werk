import { expect, test } from "bun:test";
import { card, decided, lines, link, ok, withMap } from "./h62util.ts";

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const p = withMap([
    card("root", "Root"),
    card("auth", "Auth", "root"),
    card("login", "Login", "auth"),
    card("session", "Session", "auth"),
    card("audit", "Audit", "root"),
    link("login", "audit", "depends_on", "Login is audited"),
    decided("auth"),
  ]);
  const count = lines(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  for (const id of ["auth", "login", "session"]) expect((await p.werk(["show", id])).code).toBe(1);
  for (const view of [["show", "root"], ["show", "audit"], ["find"], ["search"], ["search", "Login"]]) {
    const out = (await ok(p, view)).out;
    for (const word of ["auth", "Auth", "login", "Login", "session", "Session"]) expect(out).not.toContain(word);
  }
  const after = lines(p);
  expect(after).toHaveLength(count + 1);
  expect(JSON.parse(after.at(-1) as string).type).toBe("node.removed");
  const removed = (await ok(p, ["removed"])).out;
  expect(removed).toContain("auth");
  expect(removed).toMatch(/and login\s+Login/);
  expect(removed).toMatch(/and session\s+Session/);
  expect((await ok(p, ["show", "audit"])).out).not.toContain("login");

  await ok(p, ["restore", "auth", "--actor", "you"]);
  const auth = (await ok(p, ["show", "auth"])).out;
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
  expect((await ok(p, ["show", "login"])).out).toMatch(/-> depends_on\s+audit/);
  expect((await ok(p, ["show", "audit"])).out).toMatch(/<- depends_on\s+login/);
  expect((await ok(p, ["removed"])).out).toBe("no card is removed\n");
}, 60_000);

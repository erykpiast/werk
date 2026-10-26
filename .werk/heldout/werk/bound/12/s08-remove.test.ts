import { expect, test } from "bun:test";
import { card, events, lines, link, ok, withMap } from "./helpers.ts";

const shows = async (p: Parameters<typeof ok>[0], id: string) => (await p.werk(["show", id])).code === 0;

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const p = withMap([
    card("root", "Root"),
    card("auth", "Auth", "root", { status: "decided" }),
    card("login", "Login", "auth"),
    card("session", "Session", "auth"),
    card("audit", "Audit", "root"),
    link("login", "audit", "depends_on", "Login writes audit entries"),
  ]);
  const before = lines(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  for (const id of ["auth", "login", "session"]) expect(await shows(p, id)).toBe(false);
  expect((await ok(p, ["show", "root"])).out).not.toMatch(/\bauth\b/);
  const added = events(p).slice(before);
  expect(added.length).toBe(1);
  expect(added[0]).toMatchObject({ type: "node.removed", payload: { id: "auth" } });
  const removed = (await ok(p, ["removed"])).out;
  expect(removed).toContain("auth: removed");
  expect(removed).toContain("and login");
  expect(removed).toContain("and session");
  expect((await ok(p, ["show", "audit"])).out).not.toContain("login");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth  Auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth  Auth");
  expect((await ok(p, ["show", "audit"])).out).toContain("<- depends_on      login  Login");
  expect((await ok(p, ["removed"])).out).toBe("no card is removed\n");
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  const p = withMap([
    card("platform", "Platform"),
    card("auth", "Auth", "platform"),
    card("login", "Login", "auth"),
    card("session", "Session", "auth"),
  ]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect(await shows(p, "auth")).toBe(false);
  expect((await ok(p, ["show", "login"])).out).toContain("parent: platform  Platform");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: platform  Platform");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).out).toContain("parent: platform  Platform");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth  Auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth  Auth");
  const plat = (await ok(p, ["show", "platform"])).out;
  expect(plat).not.toMatch(/<- refines\s+login/);
  expect(plat).not.toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both of its ends are back", async () => {
  const p = withMap([
    card("root", "Root"),
    card("a", "A", "root"),
    card("b", "B", "root"),
    card("login", "Login", "a"),
    card("session", "Session", "b"),
    link("login", "session", "depends_on", "Login opens a session"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const l = (await ok(p, ["show", "login"])).out;
  expect(l).not.toContain("session");
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toContain("-> depends_on      session  Session");
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const p = withMap([
    card("root", "Root"),
    card("login", "Login", "root"),
    card("billing", "Billing", "root"),
    ["node.added", { id: "rfc-6749", kind: "source", title: "RFC 6749" }],
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const src = (await ok(p, ["show", "rfc-6749"])).out;
  expect(src).toContain("<- supported_by    billing  Billing");
  const before = lines(p);
  const add = await p.werk(["add", "login", "--title", "New login", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  expect(add.err).toContain("restore");
  expect(add.err).toContain("login");
  expect(lines(p)).toEqual(before);
  expect(await shows(p, "login")).toBe(false);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const p = withMap([card("root", "Root"), card("login", "Login", "root")]);
  const before = lines(p);
  const r = await p.werk(["remove", "login"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("refused");
  expect(await shows(p, "login")).toBe(true);
  expect(lines(p)).toEqual(before);
});

test("08.6 restore refuses without the person's say-so", async () => {
  const p = withMap([card("root", "Root"), card("login", "Login", "root")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const before = lines(p);
  const r = await p.werk(["restore", "login"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("refused");
  expect(await shows(p, "login")).toBe(false);
  expect(lines(p)).toEqual(before);
});

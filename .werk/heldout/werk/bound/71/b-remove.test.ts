import { expect, test } from "bun:test";
import { card, childrenIn, ids, lines, link, ok, withMap } from "./b-helpers.ts";

test("08.1", async () => {
  const p = withMap([
    card("root", "Root", undefined, "decided"),
    card("auth", "Auth is by magic link", "root", "decided"),
    card("login", "Login form", "auth"),
    card("session", "Session lasts a day", "auth"),
    card("audit", "Audit log", "root"),
    link("login", "audit", "depends_on", "Login writes the audit log"),
  ]);
  const count = lines(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  // no view shows them
  for (const id of ["auth", "login", "session"]) expect((await p.werk(["show", id])).code).toBe(1);
  const root = (await ok(p, ["show", "root"])).out;
  expect(childrenIn(root)).toEqual(["audit"]);
  const views = [
    (await ok(p, ["search"])).out,
    (await ok(p, ["find"])).out,
    (await ok(p, ["search", "--status", "open"])).out,
  ].join("\n");
  for (const id of ["auth", "login", "session"]) expect(ids(views)).not.toContain(id);
  // one new removal event
  expect(lines(p)).toHaveLength(count + 1);
  expect(JSON.parse(lines(p).at(-1) as string)).toMatchObject({ type: "node.removed", payload: { id: "auth" } });
  // removed lists auth with two children
  const removed = (await ok(p, ["removed"])).out;
  expect(removed).toContain("auth: removed");
  expect(removed).toContain("and login");
  expect(removed).toContain("and session");
  // link login -> audit no longer shows
  expect((await ok(p, ["show", "audit"])).out).not.toContain("login");
  // restore
  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect(childrenIn((await ok(p, ["show", "root"])).out)).toContain("auth");
  expect(childrenIn((await ok(p, ["show", "auth"])).out).sort()).toEqual(["login", "session"]);
  expect((await ok(p, ["show", "audit"])).out).toMatch(/<- depends_on\s+login/);
  expect((await ok(p, ["show", "login"])).out).toMatch(/-> depends_on\s+audit/);
  expect((await ok(p, ["removed"])).out).toBe("no card is removed\n");
}, 60_000);

test("08.2", async () => {
  const p = withMap([
    card("platform", "Platform", undefined, "decided"),
    card("auth", "Auth", "platform"),
    card("login", "Login", "auth"),
    card("session", "Session", "auth"),
  ]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect((await p.werk(["show", "auth"])).code).toBe(1);
  expect(childrenIn((await ok(p, ["show", "platform"])).out).sort()).toEqual(["login", "session"]);
  for (const id of ["login", "session"]) expect((await ok(p, ["show", id])).out).toContain("parent: platform");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).out).toContain("parent: platform");
  expect(childrenIn((await ok(p, ["show", "platform"])).out)).toEqual(["auth"]);
  expect(childrenIn((await ok(p, ["show", "auth"])).out).sort()).toEqual(["login", "session"]);
  for (const id of ["login", "session"]) expect((await ok(p, ["show", id])).out).toContain("parent: auth");
}, 60_000);

test("08.3", async () => {
  const p = withMap([
    card("root", "Root", undefined, "decided"),
    card("web", "Web", "root"),
    card("api", "Api", "root"),
    card("login", "Login", "web"),
    card("session", "Session", "api"),
    link("login", "session", "depends_on", "Login opens a session"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const login = await ok(p, ["show", "login"]);
  expect(login.out).toContain("card login");
  expect(login.out).not.toContain("session");
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toMatch(/-> depends_on\s+session/);
  expect((await ok(p, ["show", "session"])).out).toMatch(/<- depends_on\s+login/);
}, 60_000);

test("08.4", async () => {
  const p = withMap([
    card("root", "Root", undefined, "decided"),
    card("login", "Login", "root"),
    card("billing", "Billing", "root"),
    ["node.added", { id: "rfc-6749", kind: "source", title: "OAuth 2.0", url: "https://example.invalid/rfc6749" }],
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const src = await ok(p, ["show", "rfc-6749"]);
  expect(src.out).toMatch(/<- supported_by\s+billing/);
  const count = lines(p).length;
  const add = await p.werk(["add", "login", "--title", "Login is new", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  expect(add.err).toContain("restore #login");
  expect(lines(p)).toHaveLength(count);
  expect((await p.werk(["show", "login"])).code).toBe(1);
}, 60_000);

test("08.5", async () => {
  const p = withMap([card("root", "Root", undefined, "decided"), card("login", "Login", "root")]);
  const before = lines(p);
  const run = await p.werk(["remove", "login"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("refused");
  expect((await ok(p, ["show", "login"])).out).toContain("card login");
  expect(lines(p)).toEqual(before);
}, 60_000);

test("08.6", async () => {
  const p = withMap([card("root", "Root", undefined, "decided"), card("login", "Login", "root")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const before = lines(p);
  const run = await p.werk(["restore", "login"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("refused");
  expect((await p.werk(["show", "login"])).code).toBe(1);
  expect(childrenIn((await ok(p, ["show", "root"])).out)).not.toContain("login");
  expect(lines(p)).toEqual(before);
}, 60_000);

import { expect, test } from "bun:test";
import { card, graph, lines, link, ok, withMap } from "./helpers.ts";

test("08.1 remove takes the subtree out in one step, restore brings it all back", async () => {
  const p = withMap([
    card("root", "Root"),
    card("auth", "Auth", "root", { status: "decided" }),
    card("login", "Login", "auth"),
    card("session", "Session", "auth"),
    card("audit", "Audit", "root"),
    link("login", "audit", "depends_on", "Login writes the audit trail"),
  ]);
  const count = lines(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  for (const id of ["auth", "login", "session"]) expect((await p.werk(["show", id])).code).not.toBe(0);
  const rootShow = (await ok(p, ["show", "root"])).out;
  for (const id of ["auth", "login", "session"]) expect(rootShow).not.toContain(id);
  const shape = JSON.parse(await graph(p));
  const ids = shape.nodes.map((n: { id: string }) => n.id);
  for (const id of ["auth", "login", "session"]) expect(ids).not.toContain(id);
  expect(lines(p)).toHaveLength(count + 1);
  expect(JSON.parse(lines(p).at(-1) as string).type).toBe("node.removed");
  const removed = (await ok(p, ["removed"])).out;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect((await ok(p, ["show", "audit"])).out).not.toContain("login");
  expect(JSON.stringify(shape.edges)).not.toContain("login");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  const auth = (await ok(p, ["show", "auth"])).out;
  expect(auth).toContain("login");
  expect(auth).toContain("session");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "audit"])).out).toContain("login");
  expect((await ok(p, ["removed"])).out).toBe("no card is removed\n");
});

test("08.2 reparent moves children up, restore puts them back", async () => {
  const p = withMap([
    card("root", "Root"),
    card("platform", "Platform", "root"),
    card("auth", "Auth", "platform"),
    card("login", "Login", "auth"),
    card("session", "Session", "auth"),
  ]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect((await p.werk(["show", "auth"])).code).not.toBe(0);
  expect((await ok(p, ["show", "login"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: platform");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
  const platform = (await ok(p, ["show", "platform"])).out;
  expect(platform).not.toContain("login");
  expect(platform).not.toContain("session");
});

test("08.3 a link waits until both ends are back", async () => {
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
  const login = (await ok(p, ["show", "login"])).out;
  expect(login).not.toContain("session");
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toContain("depends_on      session");
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
  expect(src).toContain("billing");
  const count = lines(p).length;
  const add = await p.werk(["add", "login", "--title", "New login", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  expect(add.err).toContain("restore #login");
  expect(lines(p)).toHaveLength(count);
  expect((await p.werk(["show", "login"])).code).not.toBe(0);
});

test("08.5 remove refuses without --actor you", async () => {
  const p = withMap([card("root", "Root"), card("login", "Login", "root")]);
  const before = lines(p);
  const run = await p.werk(["remove", "login"]);
  expect(run.code).not.toBe(0);
  expect((await p.werk(["show", "login"])).code).toBe(0);
  expect(lines(p)).toEqual(before);
});

test("08.6 restore refuses without --actor you", async () => {
  const p = withMap([card("root", "Root"), card("login", "Login", "root")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const before = lines(p);
  const run = await p.werk(["restore", "login"]);
  expect(run.code).not.toBe(0);
  expect((await p.werk(["show", "login"])).code).not.toBe(0);
  expect(lines(p)).toEqual(before);
});

// Scenarios 08.x: remove and restore.
import { expect, test } from "bun:test";
import { card, decided, events, lines, link, ok, withMap } from "./helpers.ts";

const gone = async (p: ReturnType<typeof withMap>, id: string) => (await p.werk(["show", id])).code !== 0;

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const p = withMap([
    card("root", "Root"),
    card("auth", "Login is by magic link", "root"),
    decided("auth"),
    card("login", "The login page", "auth"),
    card("session", "The session cookie", "auth"),
    card("audit", "Every sign-in is audited", "root"),
    link("login", "audit", "depends_on", "Login writes the audit trail"),
  ]);
  expect((await ok(p, ["show", "audit"])).out).toContain("login");
  const n = lines(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  for (const id of ["auth", "login", "session"]) expect(await gone(p, id)).toBe(true);
  const root = (await ok(p, ["show", "root"])).out;
  for (const id of ["auth", "login", "session"]) expect(root).not.toContain(id);
  const search = (await ok(p, ["search"])).out;
  expect(search).not.toContain("auth");
  const find = (await ok(p, ["find"])).out;
  expect(find).not.toMatch(/\b(login|session)\b/);
  const added = events(p).slice(n);
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({ type: "node.removed", payload: { id: "auth" } });
  const removed = (await ok(p, ["removed"])).out;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect((await ok(p, ["show", "audit"])).out).not.toContain("login");

  await ok(p, ["restore", "auth", "--actor", "you"]);
  const auth = (await ok(p, ["show", "auth"])).out;
  expect(auth).toContain("<- refines         login");
  expect(auth).toContain("<- refines         session");
  expect((await ok(p, ["show", "audit"])).out).toContain("login");
  expect((await ok(p, ["show", "login"])).out).toMatch(/depends_on\s+audit/);
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
  expect(await gone(p, "auth")).toBe(true);
  expect((await ok(p, ["show", "login"])).out).toContain("parent: platform  Platform");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: platform  Platform");
  const platform = (await ok(p, ["show", "platform"])).out;
  expect(platform).toMatch(/<- refines\s+login/);
  expect(platform).toMatch(/<- refines\s+session/);

  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).out).toContain("parent: platform  Platform");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth  Auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth  Auth");
  const after = (await ok(p, ["show", "platform"])).out;
  expect(after).not.toMatch(/<- refines\s+login/);
  expect(after).not.toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both of its ends are back", async () => {
  const p = withMap([
    card("root", "Root"),
    card("auth", "Auth", "root"),
    card("store", "Store", "root"),
    card("login", "Login", "auth"),
    card("session", "Session", "store"),
    link("login", "session", "depends_on", "Login opens a session"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const login = (await ok(p, ["show", "login"])).out;
  expect(login).not.toContain("session");
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toMatch(/depends_on\s+session/);
  expect((await ok(p, ["show", "session"])).out).toMatch(/depends_on\s+login/);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const p = withMap([
    card("root", "Root"),
    card("login", "Login", "root"),
    card("billing", "Billing", "root"),
    ["node.added", { id: "rfc-6749", kind: "source", title: "RFC 6749", url: "https://www.rfc-editor.org/rfc/rfc6749" }],
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const source = await ok(p, ["show", "rfc-6749"]);
  expect(source.out).toContain("billing");
  expect(source.out).not.toContain("login");
  const n = lines(p).length;
  const add = await p.werk(["add", "login", "--title", "A new login", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  expect(add.err).toContain("restore");
  expect(add.err).toContain("login");
  expect(lines(p)).toHaveLength(n);
  expect(await gone(p, "login")).toBe(true);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const p = withMap([card("root", "Root"), card("login", "Login", "root")]);
  const n = lines(p).length;
  const run = await p.werk(["remove", "login"]);
  expect(run.code).not.toBe(0);
  expect(await gone(p, "login")).toBe(false);
  expect(lines(p)).toHaveLength(n);
});

test("08.6 restore refuses without the person's say-so", async () => {
  const p = withMap([card("root", "Root"), card("login", "Login", "root")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const n = lines(p).length;
  const run = await p.werk(["restore", "login"]);
  expect(run.code).not.toBe(0);
  expect(await gone(p, "login")).toBe(true);
  expect(lines(p)).toHaveLength(n);
});

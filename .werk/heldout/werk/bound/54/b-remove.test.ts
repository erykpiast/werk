import { expect, test } from "bun:test";
import { world, type W } from "./b-helpers.ts";

const visible = async (w: W, id: string) => {
  const show = await w.werk(["show", id]);
  const search = await w.ok("search");
  const find = await w.ok("find");
  return show.code === 0 || new RegExp(`^${id}\\s`, "m").test(search) || new RegExp(`^${id}\\s`, "m").test(find);
};

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const w = world();
  w.card("root", "Root");
  w.decided("auth", "Auth", "root");
  w.card("login", "Login", "auth");
  w.card("session", "Session", "auth");
  w.card("audit", "Audit", "root");
  w.seed("edge.added", { from: "login", to: "audit", type: "depends_on", why: "every login is audited" });
  const n = w.log().length;
  await w.ok("remove", "auth", "--actor", "you");
  for (const id of ["auth", "login", "session"]) expect(await visible(w, id)).toBe(false);
  const added = w.log().slice(n);
  expect(added.length).toBe(1);
  expect(added[0]?.type).toBe("node.removed");
  const removed = await w.ok("removed");
  expect(removed).toMatch(/auth/);
  expect(removed).toMatch(/login/);
  expect(removed).toMatch(/session/);
  expect(await w.ok("show", "audit")).not.toContain("login");

  await w.ok("restore", "auth", "--actor", "you");
  expect((await w.ok("show", "auth")).split("\n")[0]).toContain("auth");
  expect(await w.ok("show", "login")).toMatch(/parent: auth/);
  expect(await w.ok("show", "session")).toMatch(/parent: auth/);
  expect(await w.ok("show", "audit")).toMatch(/<- depends_on\s+login/);
  const after = await w.ok("removed");
  expect(after).not.toMatch(/auth|login|session/);
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  const w = world();
  w.card("platform", "Platform");
  w.card("auth", "Auth", "platform");
  w.card("login", "Login", "auth");
  w.card("session", "Session", "auth");
  await w.ok("remove", "auth", "--actor", "you", "--reparent");
  expect((await w.werk(["show", "auth"])).code).not.toBe(0);
  expect(await w.ok("show", "login")).toMatch(/parent: platform/);
  expect(await w.ok("show", "session")).toMatch(/parent: platform/);
  await w.ok("restore", "auth", "--actor", "you");
  expect(await w.ok("show", "auth")).toMatch(/parent: platform/);
  expect(await w.ok("show", "login")).toMatch(/parent: auth/);
  expect(await w.ok("show", "session")).toMatch(/parent: auth/);
  const platform = await w.ok("show", "platform");
  expect(platform).not.toMatch(/<- refines\s+login/);
  expect(platform).not.toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both of its ends are back", async () => {
  const w = world();
  w.card("root", "Root");
  w.card("a", "Branch A", "root");
  w.card("b", "Branch B", "root");
  w.card("login", "Login", "a");
  w.card("session", "Session", "b");
  w.seed("edge.added", { from: "login", to: "session", type: "depends_on", why: "a login opens a session" });
  await w.ok("remove", "login", "--actor", "you");
  await w.ok("remove", "session", "--actor", "you");
  await w.ok("restore", "login", "--actor", "you");
  const login = await w.ok("show", "login");
  expect(login).not.toContain("session");
  await w.ok("restore", "session", "--actor", "you");
  expect(await w.ok("show", "login")).toMatch(/-> depends_on\s+session/);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const w = world();
  w.card("root", "Root");
  w.card("login", "Login", "root");
  w.card("billing", "Billing", "root");
  w.seed("node.added", { id: "rfc-6749", kind: "source", title: "RFC 6749", finding: "OAuth 2.0" });
  w.seed("edge.added", { from: "login", to: "rfc-6749", type: "supported_by" });
  w.seed("edge.added", { from: "billing", to: "rfc-6749", type: "supported_by" });
  await w.ok("remove", "login", "--actor", "you");
  const src = await w.werk(["show", "rfc-6749"]);
  expect(src.code).toBe(0);
  expect(src.out).toMatch(/<- supported_by\s+billing/);
  const n = w.log().length;
  const add = await w.werk(["add", "login", "--title", "A new login", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  expect(add.err).toMatch(/restore/);
  expect(add.err).toContain("login");
  expect(w.log().length).toBe(n);
  expect((await w.werk(["show", "login"])).code).not.toBe(0);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const w = world();
  w.card("login", "Login");
  const n = w.log().length;
  const r = await w.werk(["remove", "login"]);
  expect(r.code).not.toBe(0);
  expect((await w.werk(["show", "login"])).code).toBe(0);
  expect(w.log().length).toBe(n);
});

test("08.6 restore refuses without the person's say-so", async () => {
  const w = world();
  w.card("login", "Login");
  await w.ok("remove", "login", "--actor", "you");
  const n = w.log().length;
  const r = await w.werk(["restore", "login"]);
  expect(r.code).not.toBe(0);
  expect((await w.werk(["show", "login"])).code).not.toBe(0);
  expect(w.log().length).toBe(n);
});

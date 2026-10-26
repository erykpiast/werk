import { expect, test } from "bun:test";
import type { Project } from "../../src/test/project.ts";
import { card, events, lines, ok, seed, w, withRoot } from "./helpers.ts";

async function gone(p: Project, id: string) {
  const show = await w(p, "show", id);
  expect(show.code).not.toBe(0);
  const search = (await ok(p, "search")).out;
  expect(search).not.toMatch(new RegExp(`^${id} `, "m"));
  const find = (await ok(p, "find")).out;
  expect(find).not.toMatch(new RegExp(`\\b${id}\\b`));
  const root = (await ok(p, "show", "root")).out;
  expect(root).not.toMatch(new RegExp(`refines +${id} `));
}

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const p = withRoot();
  card(p, "auth", "Auth", "root", "decided");
  card(p, "login", "Login", "auth", "decided");
  card(p, "session", "Session", "auth", "decided");
  card(p, "audit", "Audit", "root", "decided");
  seed(p, "edge.added", { from: "login", to: "audit", type: "depends_on", why: "login writes audit entries" });
  expect((await ok(p, "show", "audit")).out).toContain("login");

  const before = lines(p).length;
  await ok(p, "remove", "auth", "--actor", "you");
  for (const id of ["auth", "login", "session"]) await gone(p, id);
  const added = events(p).slice(before);
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({ type: "node.removed", payload: { id: "auth" } });
  const removed = (await ok(p, "removed")).out;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect((await ok(p, "show", "audit")).out).not.toContain("login");

  await ok(p, "restore", "auth", "--actor", "you");
  const auth = (await ok(p, "show", "auth")).out;
  expect(auth).toMatch(/<- refines +login {2}Login/);
  expect(auth).toMatch(/<- refines +session {2}Session/);
  expect((await ok(p, "show", "login")).out).toMatch(/-> depends_on +audit {2}Audit/);
  expect((await ok(p, "show", "audit")).out).toMatch(/<- depends_on +login/);
  const after = (await ok(p, "removed")).out;
  expect(after).not.toContain("auth");
  expect(after).not.toContain("login");
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  const p = withRoot();
  card(p, "platform", "Platform");
  card(p, "auth", "Auth", "platform");
  card(p, "login", "Login", "auth");
  card(p, "session", "Session", "auth");
  await ok(p, "remove", "auth", "--actor", "you", "--reparent");
  expect((await w(p, "show", "auth")).code).not.toBe(0);
  for (const id of ["login", "session"]) expect((await ok(p, "show", id)).out).toContain("parent: platform  Platform");
  const platform = (await ok(p, "show", "platform")).out;
  expect(platform).toMatch(/<- refines +login /);
  expect(platform).toMatch(/<- refines +session /);

  await ok(p, "restore", "auth", "--actor", "you");
  expect((await ok(p, "show", "auth")).out).toContain("parent: platform  Platform");
  for (const id of ["login", "session"]) expect((await ok(p, "show", id)).out).toContain("parent: auth  Auth");
  const again = (await ok(p, "show", "platform")).out;
  expect(again).toMatch(/<- refines +auth /);
  expect(again).not.toMatch(/<- refines +login /);
  expect(again).not.toMatch(/<- refines +session /);
});

test("08.3 a link waits until both of its ends are back", async () => {
  const p = withRoot();
  card(p, "a", "Branch A");
  card(p, "b", "Branch B");
  card(p, "login", "Login", "a");
  card(p, "session", "Session", "b");
  seed(p, "edge.added", { from: "login", to: "session", type: "depends_on", why: "login opens a session" });
  await ok(p, "remove", "login", "--actor", "you");
  await ok(p, "remove", "session", "--actor", "you");
  await ok(p, "restore", "login", "--actor", "you");
  const login = (await ok(p, "show", "login")).out;
  expect(login).not.toContain("session");
  await ok(p, "restore", "session", "--actor", "you");
  expect((await ok(p, "show", "login")).out).toMatch(/-> depends_on +session {2}Session/);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const p = withRoot();
  card(p, "login", "Login");
  card(p, "billing", "Billing");
  seed(p, "node.added", {
    id: "rfc-6749",
    kind: "source",
    title: "RFC 6749",
    url: "https://www.rfc-editor.org/rfc/rfc6749",
  });
  seed(p, "edge.added", { from: "login", to: "rfc-6749", type: "supported_by" });
  seed(p, "edge.added", { from: "billing", to: "rfc-6749", type: "supported_by" });
  await ok(p, "remove", "login", "--actor", "you");
  const source = (await ok(p, "show", "rfc-6749")).out;
  expect(source).toMatch(/<- supported_by +billing /);
  expect(source).not.toContain("login");

  const before = lines(p);
  const add = await w(p, "add", "login", "--title", "Login again");
  expect(add.code).not.toBe(0);
  expect(add.err).toContain("restore #login");
  expect(lines(p)).toEqual(before);
  expect((await w(p, "show", "login")).code).not.toBe(0);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const p = withRoot();
  card(p, "login", "Login");
  const before = lines(p);
  const run = await w(p, "remove", "login");
  expect(run.code).not.toBe(0);
  expect((await w(p, "show", "login")).code).toBe(0);
  expect(lines(p)).toEqual(before);
});

test("08.6 restore refuses without the person's say-so", async () => {
  const p = withRoot();
  card(p, "login", "Login");
  await ok(p, "remove", "login", "--actor", "you");
  const before = lines(p);
  const run = await w(p, "restore", "login");
  expect(run.code).not.toBe(0);
  expect((await w(p, "show", "login")).code).not.toBe(0);
  expect(lines(p)).toEqual(before);
});

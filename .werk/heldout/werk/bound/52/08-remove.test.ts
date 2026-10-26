import { expect, test } from "bun:test";
import { card, decided, lines, ok, project, seed } from "./helpers.ts";

const shown = async (p: ReturnType<typeof project>, id: string) => (await p.werk(["show", id])).code === 0;

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const p = project();
  seed(p, [
    card("root", "Root"),
    card("auth", "Auth", { parent: "root" }),
    card("login", "Login", { parent: "auth" }),
    card("session", "Session", { parent: "auth" }),
    card("audit", "Audit", { parent: "root" }),
    { type: "edge.added", payload: { from: "login", to: "audit", type: "depends_on", why: "writes audit lines" } },
    decided("auth"),
  ]);
  const before = lines(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  for (const id of ["auth", "login", "session"]) expect(await shown(p, id)).toBe(false);
  const search = await ok(p, ["search"]);
  const find = await ok(p, ["find"]);
  const rootShow = await ok(p, ["show", "root"]);
  for (const id of ["auth", "login", "session"]) {
    expect(search.out).not.toMatch(new RegExp(`\\b${id}\\b`));
    expect(find.out).not.toMatch(new RegExp(`\\b${id}\\b`));
    expect(rootShow.out).not.toMatch(new RegExp(`\\b${id}\\b`));
  }
  const added = lines(p).slice(before);
  expect(added.length).toBe(1);
  expect(added[0]).toMatchObject({ type: "node.removed", payload: { id: "auth" } });
  const removed = await ok(p, ["removed"]);
  expect(removed.out).toContain("auth");
  expect(removed.out).toContain("login");
  expect(removed.out).toContain("session");
  expect((await ok(p, ["show", "audit"])).out).not.toContain("login");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  const auth = await ok(p, ["show", "auth"]);
  expect(auth.out).toMatch(/<- refines\s+login/);
  expect(auth.out).toMatch(/<- refines\s+session/);
  expect((await ok(p, ["show", "audit"])).out).toMatch(/<- depends_on\s+login/);
  const after = await ok(p, ["removed"]);
  for (const id of ["auth", "login", "session"]) expect(after.out).not.toContain(id);
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  const p = project();
  seed(p, [
    card("platform", "Platform"),
    card("auth", "Auth", { parent: "platform" }),
    card("login", "Login", { parent: "auth" }),
    card("session", "Session", { parent: "auth" }),
  ]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect(await shown(p, "auth")).toBe(false);
  let platform = (await ok(p, ["show", "platform"])).out;
  expect(platform).toMatch(/<- refines\s+login/);
  expect(platform).toMatch(/<- refines\s+session/);
  await ok(p, ["restore", "auth", "--actor", "you"]);
  platform = (await ok(p, ["show", "platform"])).out;
  expect(platform).toMatch(/<- refines\s+auth/);
  expect(platform).not.toMatch(/<- refines\s+login/);
  expect(platform).not.toMatch(/<- refines\s+session/);
  const auth = (await ok(p, ["show", "auth"])).out;
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both of its ends are back", async () => {
  const p = project();
  seed(p, [
    card("root", "Root"),
    card("a", "Branch A", { parent: "root" }),
    card("b", "Branch B", { parent: "root" }),
    card("login", "Login", { parent: "a" }),
    card("session", "Session", { parent: "b" }),
    { type: "edge.added", payload: { from: "login", to: "session", type: "depends_on", why: "needs a session" } },
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const login = await ok(p, ["show", "login"]);
  expect(login.out).not.toContain("session");
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toMatch(/-> depends_on\s+session/);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const p = project();
  seed(p, [
    card("root", "Root"),
    card("login", "Login", { parent: "root" }),
    card("billing", "Billing", { parent: "root" }),
    { type: "node.added", payload: { id: "rfc-6749", kind: "source", title: "RFC 6749", url: "https://www.rfc-editor.org/rfc/rfc6749" } },
    { type: "edge.added", payload: { from: "login", to: "rfc-6749", type: "supported_by" } },
    { type: "edge.added", payload: { from: "billing", to: "rfc-6749", type: "supported_by" } },
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const src = await ok(p, ["show", "rfc-6749"]);
  expect(src.out).toMatch(/<- supported_by\s+billing/);
  const before = lines(p).length;
  const add = await p.werk(["add", "login", "--title", "New login", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  expect(`${add.out}${add.err}`).toMatch(/restore/);
  expect(`${add.out}${add.err}`).toContain("login");
  expect(lines(p).length).toBe(before);
  expect(await shown(p, "login")).toBe(false);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const p = project();
  seed(p, [card("root", "Root"), card("login", "Login", { parent: "root" })]);
  const before = lines(p).length;
  const run = await p.werk(["remove", "login"]);
  expect(run.code).not.toBe(0);
  expect(await shown(p, "login")).toBe(true);
  expect(lines(p).length).toBe(before);
});

test("08.6 restore refuses without the person's say-so", async () => {
  const p = project();
  seed(p, [card("root", "Root"), card("login", "Login", { parent: "root" })]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const before = lines(p).length;
  const run = await p.werk(["restore", "login"]);
  expect(run.code).not.toBe(0);
  expect(await shown(p, "login")).toBe(false);
  expect(lines(p).length).toBe(before);
});

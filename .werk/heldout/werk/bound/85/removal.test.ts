import { expect, test } from "bun:test";
import { freshProject, type Project } from "../src/test/project.ts";
import { card, decided, edge, events, kill, lines, ok, root, seed, w } from "./h.ts";

const show = async (p: Project, id: string) => (await w(p, ["show", id])).out;
const base = () => {
  const p = freshProject();
  seed(p, [...root()]);
  return p;
};
const gone = async (p: Project, id: string) => {
  const r = await w(p, ["show", id]);
  return r.code !== 0 || /removed/.test(r.out + r.err);
};

test("08.1", async () => {
  const p = base();
  seed(p, [decided("auth"), decided("login", { parent: "auth" }), decided("session", { parent: "auth" }), decided("audit"), edge("login", "audit")]);
  const n = lines(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  expect(lines(p).length).toBe(n + 1);
  expect(events(p)[n]!.type).toBe("node.removed");
  for (const id of ["auth", "login", "session"]) expect(await gone(p, id)).toBe(true);
  const rootShow = await show(p, "root");
  for (const id of ["auth", "login", "session"]) expect(rootShow).not.toMatch(new RegExp(`\\b${id}\\b`));
  const removed = (await w(p, ["removed"])).out;
  for (const id of ["auth", "login", "session"]) expect(removed).toContain(id);
  expect(await show(p, "audit")).not.toContain("login");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  const a = await show(p, "auth");
  expect(a).toContain("login");
  expect(a).toContain("session");
  expect(await show(p, "login")).toMatch(/depends_on\s+audit/);
  expect(await show(p, "audit")).toContain("login");
  expect((await w(p, ["removed"])).out.trim()).not.toMatch(/auth|login|session/);
});

test("08.2", async () => {
  const p = base();
  seed(p, [decided("platform"), decided("auth", { parent: "platform" }), decided("login", { parent: "auth" }), decided("session", { parent: "auth" })]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect(await gone(p, "auth")).toBe(true);
  const pl = await show(p, "platform");
  expect(pl).toMatch(/<- refines\s+login/);
  expect(pl).toMatch(/<- refines\s+session/);
  await ok(p, ["restore", "auth", "--actor", "you"]);
  const pl2 = await show(p, "platform");
  expect(pl2).toMatch(/<- refines\s+auth/);
  expect(pl2).not.toMatch(/<- refines\s+login/);
  expect(pl2).not.toMatch(/<- refines\s+session/);
  const a = await show(p, "auth");
  expect(a).toMatch(/<- refines\s+login/);
  expect(a).toMatch(/<- refines\s+session/);
});

test("08.3", async () => {
  const p = base();
  seed(p, [decided("a"), decided("b"), decided("login", { parent: "a" }), decided("session", { parent: "b" }), edge("login", "session")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const l = await show(p, "login");
  expect(l).toContain("card login");
  expect(l).not.toMatch(/depends_on\s+session/);
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect(await show(p, "login")).toMatch(/depends_on\s+session/);
});

test("08.4", async () => {
  const p = base();
  seed(p, [
    decided("login"),
    decided("billing"),
    { type: "node.added", payload: { id: "rfc-6749", kind: "source", title: "RFC 6749" } },
    { type: "edge.added", payload: { from: "login", to: "rfc-6749", type: "supported_by" } },
    { type: "edge.added", payload: { from: "billing", to: "rfc-6749", type: "supported_by" } },
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const s = await show(p, "rfc-6749");
  expect(s).toContain("RFC 6749");
  expect(s).toContain("billing");
  const n = lines(p).length;
  const r = await w(p, ["add", "login", "--title", "New login"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/restore/);
  expect(r.err).toContain("login");
  expect(lines(p).length).toBe(n);
});

test("08.5", async () => {
  const p = base();
  seed(p, [decided("login")]);
  const n = lines(p).length;
  const r = await w(p, ["remove", "login"]);
  expect(r.code).not.toBe(0);
  expect(await show(p, "login")).toContain("card login");
  expect(lines(p).length).toBe(n);
});

test("08.6", async () => {
  const p = base();
  seed(p, [decided("login")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const n = lines(p).length;
  const r = await w(p, ["restore", "login"]);
  expect(r.code).not.toBe(0);
  expect(await gone(p, "login")).toBe(true);
  expect(lines(p).length).toBe(n);
});

test("66.1", async () => {
  const p = base();
  seed(p, [decided("storage"), decided("cache", { parent: "storage" }), decided("index", { parent: "storage" }), decided("eviction", { parent: "cache" })]);
  const n = lines(p).length;
  await ok(p, ["remove", "cache", "--actor", "you"]);
  expect(await gone(p, "cache")).toBe(true);
  expect(await gone(p, "eviction")).toBe(true);
  const st = await show(p, "storage");
  expect(st).not.toMatch(/<- refines\s+cache/);
  expect(st).toMatch(/<- refines\s+index/);
  expect((await w(p, ["removed"])).out).toContain("cache");
  expect(lines(p).length).toBe(n + 1);
});

test("66.2", async () => {
  const p = base();
  seed(p, [decided("storage"), decided("budget", { title: "Memory budget" }), decided("cache", { parent: "storage" }), decided("eviction", { parent: "cache" }), edge("cache", "budget")]);
  await ok(p, ["remove", "cache", "--actor", "you"]);
  await ok(p, ["restore", "cache", "--actor", "you"]);
  const c = await show(p, "cache");
  expect(c).not.toMatch(/removed/);
  expect(c).toMatch(/depends_on\s+budget/);
  expect(c).toMatch(/<- refines\s+eviction/);
  expect(await show(p, "storage")).toMatch(/<- refines\s+cache/);
  expect((await w(p, ["removed"])).out).not.toContain("cache");
});

test("66.3", async () => {
  const p = base();
  seed(p, [decided("storage"), decided("bad", { parent: "storage" }), decided("write", { parent: "bad" }), decided("read", { parent: "bad" })]);
  await ok(p, ["remove", "bad", "--actor", "you", "--reparent"]);
  expect(await gone(p, "bad")).toBe(true);
  const st = await show(p, "storage");
  expect(st).toMatch(/<- refines\s+write/);
  expect(st).toMatch(/<- refines\s+read/);
  expect(await gone(p, "write")).toBe(false);
  expect(await gone(p, "read")).toBe(false);
});

test("66.4", async () => {
  const p = base();
  seed(p, [
    decided("storage"), decided("post"), decided("rej"), decided("outside-parent"),
    card("cache", { parent: "storage" }), card("index", { parent: "storage" }),
    card("backup", { parent: "storage" }), card("quota", { parent: "storage" }),
    card("outside", { parent: "outside-parent" }),
    edge("backup", "post"), edge("quota", "rej"),
  ]);
  await ok(p, ["reopen", "post", "--reason", "postponed"]);
  await ok(p, ["reopen", "rej", "--reason", "rejected"]);
  const f = (await ok(p, ["find", "storage"])).out;
  expect(f).toContain("cache");
  expect(f).toContain("index");
  expect(f).not.toContain("backup");
  expect(f).not.toContain("quota");
  expect(f).not.toContain("outside");
});

test("66.5", async () => {
  const p = base();
  seed(p, [decided("storage"), card("cache", { parent: "storage" }), card("index", { parent: "storage" })]);
  await ok(p, ["remove", "cache", "--actor", "you"]);
  let f = (await ok(p, ["find", "storage"])).out;
  expect(f).toContain("index");
  expect(f).not.toContain("cache");
  await ok(p, ["restore", "cache", "--actor", "you"]);
  f = (await ok(p, ["find", "storage"])).out;
  expect(f).toContain("cache");
  expect(f).toContain("index");
});

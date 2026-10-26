import { expect, test } from "bun:test";
import { card, events, lines, ok, seed, w, withRoot } from "./h.ts";

const edge = (from: string, to: string, type: string, why?: string) => ({
  type: "edge.added",
  payload: { from, to, type, ...(why ? { why } : {}) },
});

function authMap() {
  const p = withRoot();
  seed(p, [
    card("auth", "auth", { status: "decided", parent: "root" }),
    card("login", "login", { parent: "auth" }),
    card("session", "session", { parent: "auth" }),
    card("audit", "audit", { parent: "root" }),
    edge("login", "audit", "depends_on", "audit trail"),
  ]);
  return p;
}

test("08.1 remove takes the subtree in one event; restore brings it back", async () => {
  const p = authMap();
  const n = lines(p).length;
  const r = await ok(p, "remove", "auth", "--actor", "you");
  expect(lines(p).length).toBe(n + 1);
  expect(events(p).at(-1).type).toBe("node.removed");
  for (const id of ["auth", "login", "session"]) {
    const s = await w(p, "show", id);
    expect(s.err).toContain("removed");
  }
  const root = (await ok(p, "show", "root")).out;
  for (const id of ["auth", "login", "session"]) expect(root).not.toMatch(new RegExp(`refines\\s+${id}\\b`));
  expect(r.out).toContain("login");
  const removed = (await ok(p, "removed")).out;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  const audit = (await ok(p, "show", "audit")).out;
  expect(audit).not.toContain("login");
  await ok(p, "restore", "auth", "--actor", "you");
  const login = (await ok(p, "show", "login")).out;
  expect(login).toContain("parent: auth");
  expect(login).toMatch(/depends_on\s+audit/);
  const auth = (await ok(p, "show", "auth")).out;
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
  expect((await ok(p, "removed")).out).toContain("no card is removed");
});

test("08.2 remove with reparent moves children up; restore puts them back", async () => {
  const p = withRoot();
  seed(p, [
    card("platform", "platform", { parent: "root" }),
    card("auth", "auth", { parent: "platform" }),
    card("login", "login", { parent: "auth" }),
    card("session", "session", { parent: "auth" }),
  ]);
  await ok(p, "remove", "auth", "--actor", "you", "--reparent");
  expect((await w(p, "show", "auth")).err).toContain("removed");
  const plat = (await ok(p, "show", "platform")).out;
  expect(plat).toMatch(/<- refines\s+login/);
  expect(plat).toMatch(/<- refines\s+session/);
  await ok(p, "restore", "auth", "--actor", "you");
  const plat2 = (await ok(p, "show", "platform")).out;
  expect(plat2).toMatch(/<- refines\s+auth/);
  expect(plat2).not.toMatch(/<- refines\s+login/);
  expect(plat2).not.toMatch(/<- refines\s+session/);
  const auth = (await ok(p, "show", "auth")).out;
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both ends are back", async () => {
  const p = withRoot();
  seed(p, [
    card("a", "branch a", { parent: "root" }),
    card("b", "branch b", { parent: "root" }),
    card("login", "login", { parent: "a" }),
    card("session", "session", { parent: "b" }),
    edge("login", "session", "depends_on", "needs session"),
  ]);
  await ok(p, "remove", "login", "--actor", "you");
  await ok(p, "remove", "session", "--actor", "you");
  await ok(p, "restore", "login", "--actor", "you");
  const login = (await ok(p, "show", "login")).out;
  expect(login).toContain("login");
  expect(login).not.toMatch(/depends_on\s+session/);
  await ok(p, "restore", "session", "--actor", "you");
  expect((await ok(p, "show", "login")).out).toMatch(/depends_on\s+session/);
});

test("08.4 removed id stays taken; cited source stays", async () => {
  const p = withRoot();
  seed(p, [
    card("login", "login", { parent: "root" }),
    card("billing", "billing", { parent: "root" }),
    { type: "node.added", payload: { id: "rfc-6749", kind: "source", title: "RFC 6749" } },
    edge("login", "rfc-6749", "supported_by"),
    edge("billing", "rfc-6749", "supported_by"),
  ]);
  await ok(p, "remove", "login", "--actor", "you");
  const src = (await ok(p, "show", "rfc-6749")).out;
  expect(src).toMatch(/supported_by\s+billing/);
  expect(src).not.toMatch(/supported_by\s+login/);
  const n = lines(p).length;
  const r = await w(p, "add", "login", "--title", "New login");
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/restore #login/);
  expect(lines(p).length).toBe(n);
  expect((await w(p, "show", "login")).err).toContain("removed");
});

test("08.5 remove refuses without --actor you", async () => {
  const p = withRoot();
  seed(p, [card("login", "login", { parent: "root" })]);
  const n = lines(p).length;
  const r = await w(p, "remove", "login");
  expect(r.code).not.toBe(0);
  expect((await ok(p, "show", "login")).out).toContain("card login");
  expect(lines(p).length).toBe(n);
});

test("08.6 restore refuses without --actor you", async () => {
  const p = withRoot();
  seed(p, [card("login", "login", { parent: "root" })]);
  await ok(p, "remove", "login", "--actor", "you");
  const n = lines(p).length;
  const r = await w(p, "restore", "login");
  expect(r.code).not.toBe(0);
  expect((await w(p, "show", "login")).err).toContain("removed");
  expect(lines(p).length).toBe(n);
});

// ---- 66 ----
test("66.1 agent removes a bad branch; log keeps history", async () => {
  const p = withRoot();
  seed(p, [
    card("storage", "Storage", { parent: "root" }),
    card("cache", "Cache", { parent: "storage" }),
    card("index", "Index", { parent: "storage" }),
    card("eviction", "Eviction", { parent: "cache" }),
  ]);
  const before = lines(p);
  const r = await w(p, "remove", "cache", "--actor", "you");
  expect(r.code).toBe(0);
  expect((await w(p, "show", "cache")).err).toContain("removed");
  expect((await w(p, "show", "eviction")).err).toContain("removed");
  const st = (await ok(p, "show", "storage")).out;
  expect(st).not.toMatch(/refines\s+cache/);
  expect(st).toMatch(/<- refines\s+index/);
  expect((await ok(p, "removed")).out).toContain("cache");
  expect(lines(p).slice(0, before.length)).toEqual(before);
  expect(lines(p).length).toBe(before.length + 1);
});

test("66.2 restore brings subtree and links back", async () => {
  const p = withRoot();
  seed(p, [
    card("storage", "Storage", { parent: "root" }),
    card("budget", "Memory budget", { parent: "root" }),
    card("cache", "Cache", { parent: "storage" }),
    card("eviction", "Eviction", { parent: "cache" }),
    edge("cache", "budget", "depends_on", "budget"),
  ]);
  await ok(p, "remove", "cache", "--actor", "you");
  await ok(p, "restore", "cache", "--actor", "you");
  expect((await w(p, "show", "cache")).err).not.toContain("removed");
  expect((await ok(p, "show", "storage")).out).toMatch(/<- refines\s+cache/);
  expect((await ok(p, "show", "cache")).out).toMatch(/<- refines\s+eviction/);
  expect((await ok(p, "show", "cache")).out).toMatch(/depends_on\s+budget/);
  expect((await ok(p, "removed")).out).not.toContain("cache");
});

test("66.3 remove with reparent keeps children", async () => {
  const p = withRoot();
  seed(p, [
    card("storage", "Storage", { parent: "root" }),
    card("bad", "Bad layer", { parent: "storage" }),
    card("write", "Write path", { parent: "bad" }),
    card("read", "Read path", { parent: "bad" }),
  ]);
  await ok(p, "remove", "bad", "--actor", "you", "--reparent");
  expect((await w(p, "show", "bad")).err).toContain("removed");
  const st = (await ok(p, "show", "storage")).out;
  expect(st).toMatch(/<- refines\s+write/);
  expect(st).toMatch(/<- refines\s+read/);
  expect((await w(p, "show", "write")).code).toBe(0);
  expect((await w(p, "show", "read")).code).toBe(0);
});

test("66.5 removed branch drops out of find, back after restore", async () => {
  const p = withRoot();
  seed(p, [
    card("storage", "Storage", { parent: "root" }),
    card("cache", "Cache", { parent: "storage" }),
    card("index", "Index", { parent: "storage" }),
  ]);
  await ok(p, "remove", "cache", "--actor", "you");
  const f = (await ok(p, "find", "storage")).out;
  expect(f).toContain("index");
  expect(f).not.toContain("cache");
  await ok(p, "restore", "cache", "--actor", "you");
  const f2 = (await ok(p, "find", "storage")).out;
  expect(f2).toContain("index");
  expect(f2).toContain("cache");
});

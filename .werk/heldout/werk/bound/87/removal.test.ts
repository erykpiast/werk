import { expect, test } from "bun:test";
import { card, events, lines, ok, type Project, seed, w, withRoot } from "./lib.ts";

const link = (p: Project, from: string, to: string, type = "depends_on") =>
  seed(p, "edge.added", { from, to, type, ...(type === "depends_on" ? { why: "needs it" } : {}) });

function authTree(): Project {
  const p = withRoot();
  card(p, "auth", { title: "auth" });
  card(p, "audit", { title: "audit" });
  card(p, "login", { title: "login", parent: "auth" });
  card(p, "session", { title: "session", parent: "auth" });
  link(p, "login", "audit");
  return p;
}

test("08.1 remove takes subtree in one event; restore brings everything back", async () => {
  const p = authTree();
  const n = lines(p).length;
  await ok(p, "remove", "auth", "--actor", "you");
  expect(lines(p).length).toBe(n + 1);
  expect(events(p).at(-1)!.type).toBe("node.removed");
  for (const id of ["auth", "login", "session"]) {
    const r = await w(p, "show", id);
    expect(r.code).not.toBe(0);
  }
  const root = (await ok(p, "show", "root")).out;
  expect(root).not.toContain("auth");
  const rem = (await ok(p, "removed")).out;
  expect(rem).toContain("auth");
  expect(rem).toContain("login");
  expect(rem).toContain("session");
  expect((await ok(p, "show", "audit")).out).not.toContain("login");
  await ok(p, "restore", "auth", "--actor", "you");
  const a = (await ok(p, "show", "auth")).out;
  expect(a).toContain("login");
  expect(a).toContain("session");
  expect((await ok(p, "show", "audit")).out).toContain("login");
  expect((await ok(p, "show", "login")).out).toMatch(/depends_on\s+audit/);
  expect((await ok(p, "removed")).out.trim()).not.toContain("auth");
});

test("08.2 remove --reparent moves children up; restore puts them back", async () => {
  const p = withRoot();
  card(p, "platform", { title: "platform" });
  card(p, "auth", { title: "auth", parent: "platform" });
  card(p, "login", { title: "login", parent: "auth" });
  card(p, "session", { title: "session", parent: "auth" });
  await ok(p, "remove", "auth", "--actor", "you", "--reparent");
  expect((await w(p, "show", "auth")).code).not.toBe(0);
  const pl = (await ok(p, "show", "platform")).out;
  expect(pl).toMatch(/<- refines\s+login/);
  expect(pl).toMatch(/<- refines\s+session/);
  await ok(p, "restore", "auth", "--actor", "you");
  const pl2 = (await ok(p, "show", "platform")).out;
  expect(pl2).toMatch(/<- refines\s+auth/);
  expect(pl2).not.toMatch(/<- refines\s+login/);
  expect(pl2).not.toMatch(/<- refines\s+session/);
  const a = (await ok(p, "show", "auth")).out;
  expect(a).toMatch(/<- refines\s+login/);
  expect(a).toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both ends are back", async () => {
  const p = withRoot();
  card(p, "a", { title: "A" });
  card(p, "login", { title: "login", parent: "a" });
  card(p, "b", { title: "B" });
  card(p, "session", { title: "session", parent: "b" });
  link(p, "login", "session");
  await ok(p, "remove", "login", "--actor", "you");
  await ok(p, "remove", "session", "--actor", "you");
  await ok(p, "restore", "login", "--actor", "you");
  const l = (await ok(p, "show", "login")).out;
  expect(l).toContain("login");
  expect(l).not.toMatch(/depends_on\s+session/);
  await ok(p, "restore", "session", "--actor", "you");
  expect((await ok(p, "show", "login")).out).toMatch(/depends_on\s+session/);
});

test("08.4 removed id stays taken; cited source stays", async () => {
  const p = withRoot();
  card(p, "login", { title: "login" });
  card(p, "billing", { title: "billing" });
  seed(p, "node.added", { id: "rfc-6749", kind: "source", title: "RFC 6749" });
  link(p, "login", "rfc-6749", "supported_by");
  link(p, "billing", "rfc-6749", "supported_by");
  await ok(p, "remove", "login", "--actor", "you");
  const s = (await ok(p, "show", "rfc-6749")).out;
  expect(s).toMatch(/supported_by.*billing|billing.*supported_by/s);
  expect((await ok(p, "show", "billing")).out).toContain("rfc-6749");
  const n = lines(p).length;
  const r = await w(p, "add", "login", "--title", "New login");
  expect(r.code).not.toBe(0);
  expect(r.err.toLowerCase()).toContain("restore");
  expect(r.err).toContain("login");
  expect(lines(p).length).toBe(n);
  expect((await w(p, "show", "login")).code).not.toBe(0);
});

test("08.5 remove without --actor you refuses", async () => {
  const p = withRoot();
  card(p, "login", { title: "login" });
  const n = lines(p).length;
  const r = await w(p, "remove", "login");
  expect(r.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect((await w(p, "show", "login")).code).toBe(0);
});

test("08.6 restore without --actor you refuses", async () => {
  const p = withRoot();
  card(p, "login", { title: "login" });
  await ok(p, "remove", "login", "--actor", "you");
  const n = lines(p).length;
  const r = await w(p, "restore", "login");
  expect(r.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect((await w(p, "show", "login")).code).not.toBe(0);
});

test("66.1 an agent removes a bad branch; the log keeps history", async () => {
  const p = withRoot();
  card(p, "storage", { title: "Storage" });
  card(p, "cache", { title: "Cache", parent: "storage" });
  card(p, "index", { title: "Index", parent: "storage" });
  card(p, "eviction", { title: "Eviction", parent: "cache" });
  const n = lines(p).length;
  const r = await w(p, "remove", "cache", "--actor", "you");
  expect(r.code, r.err).toBe(0);
  expect(lines(p).length).toBe(n + 1);
  expect((await w(p, "show", "cache")).out + (await w(p, "show", "cache")).err).toMatch(/removed|no node/);
  expect((await w(p, "show", "eviction")).code).not.toBe(0);
  const s = (await ok(p, "show", "storage")).out;
  expect(s).not.toMatch(/<- refines\s+cache/);
  expect(s).toMatch(/<- refines\s+index/);
  expect((await ok(p, "removed")).out).toContain("cache");
});

test("66.2 restore subtree with links", async () => {
  const p = withRoot();
  card(p, "storage", { title: "Storage" });
  card(p, "cache", { title: "Cache", parent: "storage" });
  card(p, "eviction", { title: "Eviction", parent: "cache" });
  card(p, "mem", { title: "Memory budget" });
  link(p, "cache", "mem");
  await ok(p, "remove", "cache", "--actor", "you");
  await ok(p, "restore", "cache", "--actor", "you");
  expect((await w(p, "show", "cache")).code).toBe(0);
  expect((await ok(p, "show", "storage")).out).toMatch(/<- refines\s+cache/);
  expect((await ok(p, "show", "cache")).out).toMatch(/<- refines\s+eviction/);
  expect((await ok(p, "show", "cache")).out).toMatch(/depends_on\s+mem/);
  expect((await ok(p, "removed")).out).not.toContain("cache");
});

test("66.3 remove with reparent lifts children", async () => {
  const p = withRoot();
  card(p, "storage", { title: "Storage" });
  card(p, "bad", { title: "Bad layer", parent: "storage" });
  card(p, "write", { title: "Write path", parent: "bad" });
  card(p, "read", { title: "Read path", parent: "bad" });
  await ok(p, "remove", "bad", "--actor", "you", "--reparent");
  expect((await w(p, "show", "bad")).code).not.toBe(0);
  const s = (await ok(p, "show", "storage")).out;
  expect(s).toMatch(/<- refines\s+write/);
  expect(s).toMatch(/<- refines\s+read/);
  expect((await w(p, "show", "write")).code).toBe(0);
  expect((await w(p, "show", "read")).code).toBe(0);
});

test("66.5 removed branch drops out of find and returns after restore", async () => {
  const p = withRoot();
  card(p, "storage", { title: "Storage" });
  card(p, "cache", { title: "Cache", parent: "storage", status: "open" });
  card(p, "index", { title: "Index", parent: "storage", status: "open" });
  await ok(p, "remove", "cache", "--actor", "you");
  const f = (await ok(p, "find", "storage")).out;
  expect(f).toContain("index");
  expect(f).not.toContain("cache");
  await ok(p, "restore", "cache", "--actor", "you");
  const f2 = (await ok(p, "find", "storage")).out;
  expect(f2).toContain("index");
  expect(f2).toContain("cache");
});

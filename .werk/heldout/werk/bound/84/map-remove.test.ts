import { expect, test } from "bun:test";
import { card, decidedCard, type Ev, lines, link, ok, withMap } from "./map-helpers.ts";

const T = 90_000;
const src = (id: string, title: string): Ev => ["node.added", { id, kind: "source", title }];

test("08.1 remove subtree in one event, restore brings back", async () => {
  const p = withMap([
    card("root", "Root"),
    ...decidedCard("auth", "Auth card", "root"),
    card("login", "Login card", "auth"),
    card("session", "Session card", "auth"),
    card("audit", "Audit card", "root"),
    link("login", "audit", "depends_on", "login audits"),
  ]);
  const n = lines(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  expect(lines(p)).toHaveLength(n + 1);
  expect(JSON.parse(lines(p).at(-1) as string).type).toBe("node.removed");
  for (const id of ["auth", "login", "session"]) expect((await p.werk(["show", id])).code).toBe(1);
  const rootShow = (await ok(p, ["show", "root"])).out;
  for (const t of ["Auth card", "Login card", "Session card"]) expect(rootShow).not.toContain(t);
  const find = (await ok(p, ["find"])).out;
  expect(find).not.toContain("Login card");
  const removed = (await ok(p, ["removed"])).out;
  expect(removed).toContain("auth: removed");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect((await ok(p, ["show", "audit"])).out).not.toContain("login");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  const auth = (await ok(p, ["show", "auth"])).out;
  expect(auth).toContain("login");
  expect(auth).toContain("session");
  expect((await ok(p, ["show", "audit"])).out).toContain("login");
  expect((await ok(p, ["removed"])).out).toBe("no card is removed\n");
}, T);

test("08.2 reparent remove and restore", async () => {
  const p = withMap([
    card("root", "Root"),
    card("platform", "Platform", "root"),
    card("auth", "Auth card", "platform"),
    card("login", "Login card", "auth"),
    card("session", "Session card", "auth"),
  ]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect((await p.werk(["show", "auth"])).code).toBe(1);
  for (const id of ["login", "session"]) expect((await ok(p, ["show", id])).out).toContain("parent: platform  Platform");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).out).toContain("parent: platform  Platform");
  for (const id of ["login", "session"]) expect((await ok(p, ["show", id])).out).toContain("parent: auth  Auth card");
  const pl = (await ok(p, ["show", "platform"])).out;
  expect(pl).not.toContain("Login card");
}, T);

test("08.3 link waits until both ends are back", async () => {
  const p = withMap([
    card("root", "Root"),
    card("a", "Branch A", "root"),
    card("b", "Branch B", "root"),
    card("login", "Login card", "a"),
    card("session", "Session card", "b"),
    link("login", "session", "depends_on", "needs session"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const l = (await ok(p, ["show", "login"])).out;
  expect(l).toStartWith("card login");
  expect(l).not.toContain("depends_on");
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toContain("-> depends_on      session  Session card");
}, T);

test("08.4 removed id stays taken, cited source stays", async () => {
  const p = withMap([
    card("root", "Root"),
    card("login", "Login card", "root"),
    card("billing", "Billing card", "root"),
    src("rfc-6749", "OAuth RFC"),
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const s = (await ok(p, ["show", "rfc-6749"])).out;
  expect(s).toContain("billing");
  expect(s).not.toContain("login");
  const n = lines(p).length;
  const r = await p.werk(["add", "login", "--title", "New login", "--parent", "root"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("restore #login");
  expect(lines(p)).toHaveLength(n);
  expect((await p.werk(["show", "login"])).out).not.toContain("New login");
  expect((await ok(p, ["show", "root"])).out).not.toContain("New login");
}, T);

test("08.5 remove without actor refuses", async () => {
  const p = withMap([card("root", "Root"), card("login", "Login card", "root")]);
  const before = lines(p);
  const r = await p.werk(["remove", "login"]);
  expect(r.code).not.toBe(0);
  expect((await ok(p, ["show", "login"])).out).toContain("Login card");
  expect(lines(p)).toEqual(before);
}, T);

test("08.6 restore without actor refuses", async () => {
  const p = withMap([card("root", "Root"), card("login", "Login card", "root")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const before = lines(p);
  const r = await p.werk(["restore", "login"]);
  expect(r.code).not.toBe(0);
  expect((await p.werk(["show", "login"])).code).toBe(1);
  expect(lines(p)).toEqual(before);
}, T);

const storage = () =>
  withMap([
    card("root", "Root"),
    card("storage", "Storage", "root"),
    card("cache", "Cache card", "storage"),
    card("index", "Index card", "storage"),
  ]);

test("66.1 remove a bad branch, log keeps history", async () => {
  const p = withMap([
    card("root", "Root"),
    card("storage", "Storage", "root"),
    card("cache", "Cache card", "storage"),
    card("index", "Index card", "storage"),
    card("evict", "Eviction card", "cache"),
  ]);
  const before = lines(p);
  await ok(p, ["remove", "cache", "--actor", "you"]);
  for (const id of ["cache", "evict"]) {
    const r = await p.werk(["show", id]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("removed");
  }
  const st = (await ok(p, ["show", "storage"])).out;
  expect(st).not.toContain("Cache card");
  expect(st).not.toContain("Eviction card");
  expect(st).toContain("Index card");
  expect((await ok(p, ["removed"])).out).toContain("cache");
  const after = lines(p);
  expect(after).toHaveLength(before.length + 1);
  expect(after.slice(0, -1)).toEqual(before);
}, T);

test("66.2 restore a subtree with links", async () => {
  const p = withMap([
    card("root", "Root"),
    card("storage", "Storage", "root"),
    card("mem", "Memory budget", "root"),
    card("cache", "Cache card", "storage"),
    card("evict", "Eviction card", "cache"),
    link("cache", "mem", "depends_on", "needs budget"),
  ]);
  await ok(p, ["remove", "cache", "--actor", "you"]);
  await ok(p, ["restore", "cache", "--actor", "you"]);
  const c = await p.werk(["show", "cache"]);
  expect(c.code).toBe(0);
  expect(c.err).not.toContain("removed");
  expect((await ok(p, ["show", "storage"])).out).toContain("Cache card");
  expect((await ok(p, ["show", "cache"])).out).toContain("Eviction card");
  expect(c.out).toContain("-> depends_on      mem  Memory budget");
  expect((await ok(p, ["removed"])).out).not.toContain("cache");
}, T);

test("66.3 remove parent, keep children", async () => {
  const p = withMap([
    card("root", "Root"),
    card("storage", "Storage", "root"),
    card("bad", "Bad layer", "storage"),
    card("write", "Write path", "bad"),
    card("read", "Read path", "bad"),
  ]);
  await ok(p, ["remove", "bad", "--actor", "you", "--reparent"]);
  expect((await p.werk(["show", "bad"])).err).toContain("removed");
  const st = (await ok(p, ["show", "storage"])).out;
  expect(st).toContain("Write path");
  expect(st).toContain("Read path");
  for (const id of ["write", "read"]) {
    const r = await p.werk(["show", id]);
    expect(r.code).toBe(0);
    expect(r.err).not.toContain("removed");
  }
}, T);

test("66.4 find open cards, without paused and stale", async () => {
  const p = withMap([
    card("root", "Root"),
    card("storage", "Storage topic", "root"),
    card("cache", "Cache work", "storage"),
    card("index", "Index work", "storage"),
    card("backup", "Backup work", "storage"),
    card("quota", "Quota work", "storage"),
    ...decidedCard("dp", "Postponed base", "root"),
    ...decidedCard("dr", "Rejected base", "root"),
    link("backup", "dp", "depends_on", "needs it"),
    link("quota", "dr", "depends_on", "needs it"),
    card("outside", "Outside work", "root"),
  ]);
  await ok(p, ["reopen", "dp", "--reason", "postponed", "--why", "later"]);
  await ok(p, ["reopen", "dr", "--reason", "rejected", "--why", "wrong"]);
  const out = (await ok(p, ["find", "storage"])).out;
  expect(out).toContain("Cache work");
  expect(out).toContain("Index work");
  for (const t of ["Backup work", "Quota work", "Outside work"]) expect(out).not.toContain(t);
}, T);

test("66.5 removed branch drops out of find and returns after restore", async () => {
  const p = storage();
  await ok(p, ["remove", "cache", "--actor", "you"]);
  const out = (await ok(p, ["find", "storage"])).out;
  expect(out).toContain("Index card");
  expect(out).not.toContain("Cache card");
  await ok(p, ["restore", "cache", "--actor", "you"]);
  const out2 = (await ok(p, ["find", "storage"])).out;
  expect(out2).toContain("Cache card");
  expect(out2).toContain("Index card");
}, T);

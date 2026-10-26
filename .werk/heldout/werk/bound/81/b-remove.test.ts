import { expect, test } from "bun:test";
import { Map_ } from "./b-lib.ts";

const both = (r: { out: string; err: string }) => r.out + r.err;

async function authTree(m: Map_) {
  await m.root();
  await m.real("auth", "Auth");
  await m.real("login", "Login", "auth");
  await m.real("session", "Session", "auth");
  await m.real("audit", "Audit");
  await m.ok("link", "login", "audit", "--type", "depends_on", "--why", "audits logins");
  await m.decideAlone("auth");
}

test("08.1 remove subtree in one step, restore brings it back", async () => {
  const m = new Map_();
  await authTree(m);
  const before = m.count();
  await m.ok("remove", "auth", "--actor", "you");
  expect(m.count()).toBe(before + 1);
  expect(m.events().at(-1)!.type).toBe("node.removed");
  const root = (await m.ok("show", "root")).out;
  for (const t of ["Auth", "Login", "Session"]) expect(root).not.toContain(t);
  for (const id of ["auth", "login", "session"]) expect((await m.w("show", id)).code).not.toBe(0);
  const listed = (await m.ok("removed")).out;
  expect(listed).toContain("auth");
  expect(listed).toContain("login");
  expect(listed).toContain("session");
  expect((await m.ok("show", "audit")).out).not.toContain("login");
  await m.ok("restore", "auth", "--actor", "you");
  const a = (await m.ok("show", "auth")).out;
  expect(a).toMatch(/<- refines\s+login/);
  expect(a).toMatch(/<- refines\s+session/);
  expect((await m.ok("show", "audit")).out).toMatch(/<- depends_on\s+login/);
  expect((await m.ok("removed")).out).toContain("no card is removed");
});

test("08.2 remove with reparent, restore puts children back", async () => {
  const m = new Map_();
  await m.root();
  await m.real("platform", "Platform");
  await m.real("auth", "Auth", "platform");
  await m.real("login", "Login", "auth");
  await m.real("session", "Session", "auth");
  await m.ok("remove", "auth", "--actor", "you", "--reparent");
  expect((await m.w("show", "auth")).code).not.toBe(0);
  const p = (await m.ok("show", "platform")).out;
  expect(p).toMatch(/<- refines\s+login/);
  expect(p).toMatch(/<- refines\s+session/);
  await m.ok("restore", "auth", "--actor", "you");
  const p2 = (await m.ok("show", "platform")).out;
  expect(p2).toMatch(/<- refines\s+auth/);
  expect(p2).not.toMatch(/<- refines\s+login/);
  expect(p2).not.toMatch(/<- refines\s+session/);
  const a = (await m.ok("show", "auth")).out;
  expect(a).toMatch(/<- refines\s+login/);
  expect(a).toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both ends are back", async () => {
  const m = new Map_();
  await m.root();
  await m.real("a", "Branch A");
  await m.real("b", "Branch B");
  await m.real("login", "Login", "a");
  await m.real("session", "Session", "b");
  await m.ok("link", "login", "session", "--type", "depends_on", "--why", "needs session");
  await m.ok("remove", "login", "--actor", "you");
  await m.ok("remove", "session", "--actor", "you");
  await m.ok("restore", "login", "--actor", "you");
  const l = await m.ok("show", "login");
  expect(l.out).toContain("Login");
  expect(l.out).not.toMatch(/depends_on\s+session/);
  await m.ok("restore", "session", "--actor", "you");
  expect((await m.ok("show", "login")).out).toMatch(/depends_on\s+session/);
});

test("08.4 removed id stays taken, cited source stays", async () => {
  const m = new Map_();
  await m.root();
  await m.real("login", "Login");
  await m.real("billing", "Billing");
  await m.real("rfc-6749", "RFC 6749", undefined, ["--kind", "source", "--finding", "oauth"]);
  await m.ok("link", "login", "rfc-6749", "--type", "supported_by");
  await m.ok("link", "billing", "rfc-6749", "--type", "supported_by");
  await m.ok("remove", "login", "--actor", "you");
  const s = (await m.ok("show", "rfc-6749")).out;
  expect(s).toContain("RFC 6749");
  expect(s).toMatch(/<- supported_by\s+billing/);
  const before = m.raw();
  const r = await m.w("add", "login", "--title", "New login");
  expect(r.code).not.toBe(0);
  expect(both(r)).toContain("restore");
  expect(both(r)).toContain("login");
  expect(m.raw()).toBe(before);
  expect((await m.ok("show", "root")).out).not.toContain("New login");
});

test("08.5 remove refuses without actor", async () => {
  const m = new Map_();
  await m.root();
  await m.real("login", "Login");
  const before = m.raw();
  const r = await m.w("remove", "login");
  expect(r.code).not.toBe(0);
  expect((await m.ok("show", "login")).out).toContain("Login");
  expect(m.raw()).toBe(before);
});

test("08.6 restore refuses without actor", async () => {
  const m = new Map_();
  await m.root();
  await m.real("login", "Login");
  await m.ok("remove", "login", "--actor", "you");
  const before = m.raw();
  const r = await m.w("restore", "login");
  expect(r.code).not.toBe(0);
  expect((await m.w("show", "login")).code).not.toBe(0);
  expect(m.raw()).toBe(before);
});

test("66.1 agent removes a bad branch, log keeps history", async () => {
  const m = new Map_();
  await m.root();
  await m.real("storage", "Storage");
  await m.real("cache", "Cache", "storage");
  await m.real("index", "Index", "storage");
  await m.real("eviction", "Eviction", "cache");
  const before = m.lines();
  await m.ok("remove", "cache", "--actor", "you");
  for (const id of ["cache", "eviction"]) expect(both(await m.w("show", id))).toContain("removed");
  const st = (await m.ok("show", "storage")).out;
  expect(st).not.toContain("Cache");
  expect(st).not.toContain("Eviction");
  expect(st).toMatch(/<- refines\s+index/);
  expect((await m.ok("removed")).out).toContain("cache");
  const after = m.lines();
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after.length).toBe(before.length + 1);
});

test("66.2 restore brings subtree and links back", async () => {
  const m = new Map_();
  await m.root();
  await m.real("storage", "Storage");
  await m.real("budget", "Memory budget");
  await m.real("cache", "Cache", "storage");
  await m.real("eviction", "Eviction", "cache");
  await m.ok("link", "cache", "budget", "--type", "depends_on", "--why", "budget caps cache");
  await m.ok("remove", "cache", "--actor", "you");
  await m.ok("restore", "cache", "--actor", "you");
  expect(both(await m.ok("show", "cache"))).not.toContain("removed");
  expect((await m.ok("show", "storage")).out).toMatch(/<- refines\s+cache/);
  const c = (await m.ok("show", "cache")).out;
  expect(c).toMatch(/<- refines\s+eviction/);
  expect(c).toMatch(/-> depends_on\s+budget/);
  expect((await m.ok("removed")).out).not.toContain("cache");
});

test("66.3 remove bad parent with reparent keeps children", async () => {
  const m = new Map_();
  await m.root();
  await m.real("storage", "Storage");
  await m.real("bad", "Bad layer", "storage");
  await m.real("write", "Write path", "bad");
  await m.real("read", "Read path", "bad");
  await m.ok("remove", "bad", "--actor", "you", "--reparent");
  expect(both(await m.w("show", "bad"))).toContain("removed");
  const s = (await m.ok("show", "storage")).out;
  expect(s).toMatch(/<- refines\s+write/);
  expect(s).toMatch(/<- refines\s+read/);
  for (const id of ["write", "read"]) {
    const r = await m.w("show", id);
    expect(r.code).toBe(0);
    expect(both(r)).not.toContain("removed");
  }
});

async function openAndMarked(m: Map_) {
  await m.root();
  await m.real("storage", "Storage");
  for (const [id, t] of [["cache", "Cache"], ["index", "Index"], ["backup", "Backup"], ["quota", "Quota"]] as const)
    await m.real(id, t, "storage");
  await m.real("elsewhere", "Elsewhere");
  await m.real("post", "Postponed basis");
  await m.real("rej", "Rejected basis");
  await m.decideAlone("post");
  await m.decideAlone("rej");
  await m.ok("link", "backup", "post", "--type", "depends_on", "--why", "needs post");
  await m.ok("link", "quota", "rej", "--type", "depends_on", "--why", "needs rej");
  await m.ok("reopen", "post", "--reason", "postponed", "--why", "later");
  await m.ok("reopen", "rej", "--reason", "rejected", "--why", "wrong");
}

test("66.4 find open cards in a subtree skips paused and stale", async () => {
  const m = new Map_();
  await openAndMarked(m);
  const f = (await m.ok("find", "storage")).out;
  expect(f).toContain("cache");
  expect(f).toContain("index");
  expect(f).not.toContain("backup");
  expect(f).not.toContain("quota");
  expect(f).not.toContain("elsewhere");
});

test("66.5 removed branch leaves find and returns after restore", async () => {
  const m = new Map_();
  await m.root();
  await m.real("storage", "Storage");
  await m.real("cache", "Cache", "storage");
  await m.real("index", "Index", "storage");
  await m.ok("remove", "cache", "--actor", "you");
  const f = (await m.ok("find", "storage")).out;
  expect(f).toContain("index");
  expect(f).not.toContain("cache");
  await m.ok("restore", "cache", "--actor", "you");
  const g = (await m.ok("find", "storage")).out;
  expect(g).toContain("cache");
  expect(g).toContain("index");
});

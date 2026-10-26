import { expect, test } from "bun:test";
import { mk } from "./h.ts";

const all = (r: { out: string; err: string }) => r.out + r.err;

function tree(h: ReturnType<typeof mk>) {
  h.real("root", "Root");
  h.real("auth", "Auth", "root");
  h.real("login", "Login", "auth");
  h.real("session", "Session", "auth");
  h.real("audit", "Audit", "root");
}

test("[08.1] remove takes the subtree; restore brings back", async () => {
  const h = mk();
  tree(h);
  h.edge("login", "audit", "depends_on", "audits logins");
  h.decide("auth");
  const n = h.count();
  const r = await h.w("remove", "auth", "--actor", "you");
  console.log("remove:", all(r));
  expect(r.code).toBe(0);
  expect(h.count()).toBe(n + 1);
  expect(h.events().at(-1)!.type).toBe("node.removed");
  for (const id of ["auth", "login", "session"]) {
    const s = await h.w("show", id);
    console.log("show removed", id, all(s));
    expect(all(s)).toMatch(/removed|no node/);
  }
  const root = await h.out("show", "root");
  for (const id of ["auth", "login", "session"]) expect(root).not.toMatch(new RegExp(`\\b${id}\\b`));
  const rem = await h.out("removed");
  console.log("removed:", rem);
  expect(rem).toContain("auth");
  expect(rem).toContain("login");
  expect(rem).toContain("session");
  const audit = await h.out("show", "audit");
  expect(audit).not.toContain("login");
  const rs = await h.w("restore", "auth", "--actor", "you");
  expect(rs.code).toBe(0);
  const a = await h.out("show", "auth");
  expect(a).toMatch(/<- refines\s+login/);
  expect(a).toMatch(/<- refines\s+session/);
  expect(await h.out("show", "audit")).toMatch(/<- depends_on\s+login/);
  const rem2 = await h.out("removed");
  expect(rem2).not.toContain("auth");
  console.log("removed after restore:", rem2);
});

test("[08.2] remove with reparent", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("platform", "Platform", "root");
  h.real("auth", "Auth", "platform");
  h.real("login", "Login", "auth");
  h.real("session", "Session", "auth");
  const r = await h.w("remove", "auth", "--actor", "you", "--reparent");
  expect(r.code).toBe(0);
  expect(all(await h.w("show", "auth"))).toMatch(/removed|no node/);
  const p = await h.out("show", "platform");
  expect(p).toMatch(/<- refines\s+login/);
  expect(p).toMatch(/<- refines\s+session/);
  expect((await h.w("restore", "auth", "--actor", "you")).code).toBe(0);
  const p2 = await h.out("show", "platform");
  expect(p2).toMatch(/<- refines\s+auth/);
  expect(p2).not.toMatch(/<- refines\s+login/);
  expect(p2).not.toMatch(/<- refines\s+session/);
  const a = await h.out("show", "auth");
  expect(a).toMatch(/<- refines\s+login/);
  expect(a).toMatch(/<- refines\s+session/);
});

test("[08.3] a link waits until both ends are back", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("b1", "Branch1", "root");
  h.real("b2", "Branch2", "root");
  h.real("login", "Login", "b1");
  h.real("session", "Session", "b2");
  h.edge("login", "session", "depends_on", "needs session");
  expect((await h.w("remove", "login", "--actor", "you")).code).toBe(0);
  expect((await h.w("remove", "session", "--actor", "you")).code).toBe(0);
  expect((await h.w("restore", "login", "--actor", "you")).code).toBe(0);
  const l = await h.out("show", "login");
  expect(l).toContain("Login");
  expect(l).not.toContain("session");
  expect((await h.w("restore", "session", "--actor", "you")).code).toBe(0);
  expect(await h.out("show", "login")).toMatch(/-> depends_on\s+session/);
});

test("[08.4] removed id stays taken; cited source stays", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("login", "Login", "root");
  h.real("billing", "Billing", "root");
  h.seed("node.added", { id: "rfc-6749", kind: "source", title: "RFC 6749" });
  h.edge("login", "rfc-6749", "supported_by");
  h.edge("billing", "rfc-6749", "supported_by");
  expect((await h.w("remove", "login", "--actor", "you")).code).toBe(0);
  const s = await h.w("show", "rfc-6749");
  expect(s.code).toBe(0);
  expect(s.out).toMatch(/<- supported_by\s+billing/);
  expect(s.out).not.toContain("login");
  const n = h.count();
  const a = await h.w("add", "login", "--title", "New login");
  console.log("add taken:", all(a));
  expect(a.code).not.toBe(0);
  expect(all(a).toLowerCase()).toContain("restore");
  expect(all(a)).toContain("login");
  expect(h.count()).toBe(n);
  const root = await h.out("show", "root");
  expect(root).not.toMatch(/New login/);
});

test("[08.5] remove refuses without --actor you", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("login", "Login", "root");
  const n = h.count();
  const r = await h.w("remove", "login");
  expect(r.code).not.toBe(0);
  expect(await h.out("show", "root")).toContain("login");
  expect(h.count()).toBe(n);
});

test("[08.6] restore refuses without --actor you", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("login", "Login", "root");
  await h.w("remove", "login", "--actor", "you");
  const n = h.count();
  const r = await h.w("restore", "login");
  expect(r.code).not.toBe(0);
  expect(await h.out("show", "root")).not.toContain("login");
  expect(all(await h.w("show", "login"))).toMatch(/removed|no node/);
  expect(h.count()).toBe(n);
});

test("[66.1] agent removes a bad branch", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("storage", "Storage", "root");
  h.real("cache", "Cache", "storage");
  h.real("index", "Index", "storage");
  h.real("eviction", "Eviction", "cache");
  const n = h.lines();
  const r = await h.w("remove", "cache", "--actor", "you");
  expect(r.code).toBe(0);
  expect(all(await h.w("show", "cache"))).toMatch(/removed/);
  expect(all(await h.w("show", "eviction"))).toMatch(/removed/);
  const s = await h.out("show", "storage");
  expect(s).not.toMatch(/cache|eviction/);
  expect(s).toMatch(/<- refines\s+index/);
  expect(await h.out("removed")).toContain("cache");
  const after = h.lines();
  expect(after.length).toBe(n.length + 1);
  expect(after.slice(0, n.length)).toEqual(n);
});

test("[66.2] restore returns subtree with links", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("storage", "Storage", "root");
  h.real("cache", "Cache", "storage");
  h.real("eviction", "Eviction", "cache");
  h.real("mem", "Memory budget", "root");
  h.edge("cache", "mem", "depends_on", "budget");
  await h.w("remove", "cache", "--actor", "you");
  const r = await h.w("restore", "cache", "--actor", "you");
  expect(r.code).toBe(0);
  expect(all(await h.w("show", "cache"))).not.toMatch(/removed|no node/);
  expect(await h.out("show", "storage")).toMatch(/<- refines\s+cache/);
  expect(await h.out("show", "cache")).toMatch(/<- refines\s+eviction/);
  expect(await h.out("show", "cache")).toMatch(/-> depends_on\s+mem\s+Memory budget/);
  expect(await h.out("removed")).not.toContain("cache");
});

test("[66.3] remove with reparent keeps children", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("storage", "Storage", "root");
  h.real("bad", "Bad layer", "storage");
  h.real("wp", "Write path", "bad");
  h.real("rp", "Read path", "bad");
  await h.w("remove", "bad", "--actor", "you", "--reparent");
  expect(all(await h.w("show", "bad"))).toMatch(/removed/);
  const s = await h.out("show", "storage");
  expect(s).toMatch(/<- refines\s+wp/);
  expect(s).toMatch(/<- refines\s+rp/);
  expect(all(await h.w("show", "wp"))).not.toMatch(/removed|no node/);
  expect(all(await h.w("show", "rp"))).not.toMatch(/removed|no node/);
});

test("[66.4] find skips paused and stale", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("storage", "Storage", "root");
  for (const [id, t] of [["cache", "Cache"], ["index", "Index"], ["backup", "Backup"], ["quota", "Quota"]] as const) h.real(id, t, "storage");
  h.real("other", "Other open", "root");
  h.real("pp", "Postponed basis", "root");
  h.real("rr", "Rejected basis", "root");
  h.decide("pp");
  h.decide("rr");
  h.edge("backup", "pp", "depends_on", "b");
  h.edge("quota", "rr", "depends_on", "q");
  await h.w("reopen", "pp", "--reason", "postponed", "--why", "later");
  await h.w("reopen", "rr", "--reason", "rejected", "--why", "wrong");
  const f = await h.out("find", "storage");
  console.log("find:", f);
  expect(f).toMatch(/cache/i);
  expect(f).toMatch(/index/i);
  expect(f).not.toMatch(/backup/i);
  expect(f).not.toMatch(/quota/i);
  expect(f).not.toMatch(/Other open/);
});

test("[66.5] removed branch drops from find and returns", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("storage", "Storage", "root");
  h.real("cache", "Cache", "storage");
  h.real("index", "Index", "storage");
  await h.w("remove", "cache", "--actor", "you");
  const f = await h.out("find", "storage");
  expect(f).toMatch(/index/i);
  expect(f).not.toMatch(/cache/i);
  await h.w("restore", "cache", "--actor", "you");
  const f2 = await h.out("find", "storage");
  expect(f2).toMatch(/index/i);
  expect(f2).toMatch(/cache/i);
});

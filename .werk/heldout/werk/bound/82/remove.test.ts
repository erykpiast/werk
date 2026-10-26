import { expect, test } from "bun:test";
import { all, card, events, freshProject, logLines, root, seed, w } from "./helpers.ts";

const dec = { status: "decided", who: "me" };
const edge = (p: ReturnType<typeof freshProject>, from: string, to: string, type = "depends_on", why = "uses") =>
  seed(p, "edge.added", { from, to, type, why });
const gone = /no node .* in the map|not in the map|removed/i;

function tree() {
  const p = freshProject();
  root(p);
  card(p, "auth", { title: "Auth", ...dec });
  card(p, "login", { title: "Login", parent: "auth", ...dec });
  card(p, "session", { title: "Session", parent: "auth", ...dec });
  card(p, "audit", { title: "Audit", ...dec });
  edge(p, "login", "audit");
  return p;
}

test("[08.1] removing a card takes its subtree out in one step, and a restore brings it back", async () => {
  const p = tree();
  const n = logLines(p).length;
  const r = await w(p, "remove", "auth", "--actor", "you");
  expect(r.code, all(r)).toBe(0);
  for (const id of ["auth", "login", "session"]) expect(all(await w(p, "show", id))).toMatch(/no node|is removed/);
  const rootShow = all(await w(p, "show"));
  expect(rootShow).not.toMatch(/auth|login|session/i);
  expect(logLines(p).length).toBe(n + 1);
  expect(events(p).at(-1).type).toBe("node.removed");
  const list = all(await w(p, "removed"));
  expect(list).toContain("auth");
  expect(list).toContain("login");
  expect(list).toContain("session");
  expect(all(await w(p, "show", "audit"))).not.toContain("login");
  const back = await w(p, "restore", "auth", "--actor", "you");
  expect(back.code, all(back)).toBe(0);
  const a = all(await w(p, "show", "auth"));
  expect(a).toContain("login");
  expect(a).toContain("session");
  expect(all(await w(p, "show", "login"))).toMatch(/depends_on\s+audit/);
  expect(all(await w(p, "show", "audit"))).toContain("login");
  expect(all(await w(p, "removed")).trim()).not.toMatch(/auth|login|session/);
});

test("[08.2] removing with reparent moves the children up, and a restore puts them back", async () => {
  const p = freshProject();
  root(p);
  card(p, "platform", { title: "Platform", ...dec });
  card(p, "auth", { title: "Auth", parent: "platform", ...dec });
  card(p, "login", { title: "Login", parent: "auth", ...dec });
  card(p, "session", { title: "Session", parent: "auth", ...dec });
  const r = await w(p, "remove", "auth", "--actor", "you", "--reparent");
  expect(r.code, all(r)).toBe(0);
  expect(all(await w(p, "show", "auth"))).toMatch(/no node|is removed/);
  const pl = all(await w(p, "show", "platform"));
  expect(pl).toMatch(/<- refines\s+login/);
  expect(pl).toMatch(/<- refines\s+session/);
  const b = await w(p, "restore", "auth", "--actor", "you");
  expect(b.code, all(b)).toBe(0);
  const pl2 = all(await w(p, "show", "platform"));
  expect(pl2).toMatch(/<- refines\s+auth/);
  expect(pl2).not.toMatch(/<- refines\s+login/);
  expect(pl2).not.toMatch(/<- refines\s+session/);
  const a = all(await w(p, "show", "auth"));
  expect(a).toMatch(/<- refines\s+login/);
  expect(a).toMatch(/<- refines\s+session/);
});

test("[08.3] a link waits until both of its ends are back", async () => {
  const p = freshProject();
  root(p);
  card(p, "a", { title: "A", ...dec });
  card(p, "b", { title: "B", ...dec });
  card(p, "login", { title: "Login", parent: "a", ...dec });
  card(p, "session", { title: "Session", parent: "b", ...dec });
  edge(p, "login", "session");
  await w(p, "remove", "login", "--actor", "you");
  await w(p, "remove", "session", "--actor", "you");
  const r = await w(p, "restore", "login", "--actor", "you");
  expect(r.code, all(r)).toBe(0);
  const l = all(await w(p, "show", "login"));
  expect(l).toContain("Login");
  expect(l).not.toMatch(/depends_on\s+session/);
  const r2 = await w(p, "restore", "session", "--actor", "you");
  expect(r2.code, all(r2)).toBe(0);
  expect(all(await w(p, "show", "login"))).toMatch(/depends_on\s+session/);
});

test("[08.4] a removed card's id stays taken, and a cited source stays", async () => {
  const p = freshProject();
  root(p);
  card(p, "login", { title: "Login", ...dec });
  card(p, "billing", { title: "Billing", ...dec });
  seed(p, "node.added", { id: "rfc-6749", kind: "source", title: "RFC 6749" });
  edge(p, "login", "rfc-6749", "supported_by", undefined as never);
  edge(p, "billing", "rfc-6749", "supported_by", undefined as never);
  await w(p, "remove", "login", "--actor", "you");
  const s = all(await w(p, "show", "rfc-6749"));
  expect(s).toContain("RFC 6749");
  expect(s).toContain("billing");
  const n = logLines(p).length;
  const add = await w(p, "add", "login", "--title", "New login");
  expect(add.code).not.toBe(0);
  expect(all(add)).toMatch(/restore/i);
  expect(all(add)).toContain("login");
  expect(logLines(p).length).toBe(n);
});

test("[08.5] remove refuses without --actor you", async () => {
  const p = freshProject();
  root(p);
  card(p, "login", { title: "Login", ...dec });
  const n = logLines(p).length;
  const r = await w(p, "remove", "login");
  expect(r.code).not.toBe(0);
  expect(all(await w(p, "show", "login"))).toContain("Login");
  expect(logLines(p).length).toBe(n);
});

test("[08.6] restore refuses without --actor you", async () => {
  const p = freshProject();
  root(p);
  card(p, "login", { title: "Login", ...dec });
  await w(p, "remove", "login", "--actor", "you");
  const n = logLines(p).length;
  const r = await w(p, "restore", "login");
  expect(r.code).not.toBe(0);
  expect(all(await w(p, "show", "login"))).toMatch(/no node|is removed/);
  expect(logLines(p).length).toBe(n);
});

// 66: the same operations through the agent's view
test("[66.1] an agent removes a bad branch and the log keeps its history", async () => {
  const p = freshProject();
  root(p);
  card(p, "storage", { title: "Storage", ...dec });
  card(p, "cache", { title: "Cache", parent: "storage", ...dec });
  card(p, "index", { title: "Index", parent: "storage", ...dec });
  card(p, "eviction", { title: "Eviction", parent: "cache", ...dec });
  const before = logLines(p);
  const r = await w(p, "remove", "cache", "--actor", "you");
  expect(r.code, all(r)).toBe(0);
  expect(all(await w(p, "show", "cache"))).toMatch(/no node|removed/i);
  expect(all(await w(p, "show", "eviction"))).toMatch(/no node|removed/i);
  const st = all(await w(p, "show", "storage"));
  expect(st).not.toMatch(/<- refines\s+cache/);
  expect(st).toMatch(/<- refines\s+index/);
  expect(all(await w(p, "removed"))).toContain("cache");
  const now = logLines(p);
  expect(now.slice(0, before.length)).toEqual(before);
  expect(now.length).toBe(before.length + 1);
});

test("[66.2] a restore brings the subtree and their links back", async () => {
  const p = freshProject();
  root(p);
  card(p, "storage", { title: "Storage", ...dec });
  card(p, "cache", { title: "Cache", parent: "storage", ...dec });
  card(p, "eviction", { title: "Eviction", parent: "cache", ...dec });
  card(p, "budget", { title: "Memory budget", ...dec });
  seed(p, "edge.added", { from: "cache", to: "budget", type: "depends_on", why: "needs it" });
  await w(p, "remove", "cache", "--actor", "you");
  const r = await w(p, "restore", "cache", "--actor", "you");
  expect(r.code, all(r)).toBe(0);
  const c = all(await w(p, "show", "cache"));
  expect(c).not.toMatch(/no node|is removed/);
  expect(c).toMatch(/depends_on\s+budget/);
  expect(c).toMatch(/<- refines\s+eviction/);
  expect(all(await w(p, "show", "storage"))).toMatch(/<- refines\s+cache/);
  expect(all(await w(p, "removed")).trim()).not.toContain("cache");
});

test("[66.3] an agent removes a bad parent but keeps its children", async () => {
  const p = freshProject();
  root(p);
  card(p, "storage", { title: "Storage", ...dec });
  card(p, "bad", { title: "Bad layer", parent: "storage", ...dec });
  card(p, "write", { title: "Write path", parent: "bad", ...dec });
  card(p, "read", { title: "Read path", parent: "bad", ...dec });
  await w(p, "remove", "bad", "--actor", "you", "--reparent");
  expect(all(await w(p, "show", "bad"))).toMatch(/no node|removed/i);
  const s = all(await w(p, "show", "storage"));
  expect(s).toMatch(/<- refines\s+write/);
  expect(s).toMatch(/<- refines\s+read/);
  expect(all(await w(p, "show", "write"))).not.toMatch(/no node|is removed/);
  expect(all(await w(p, "show", "read"))).not.toMatch(/no node|is removed/);
});

test("[66.4] an agent finds the open cards it can work on in a subtree", async () => {
  const p = freshProject();
  root(p);
  card(p, "storage", { title: "Storage", ...dec });
  for (const id of ["cache", "index", "backup", "quota"]) card(p, id, { title: id, parent: "storage", status: "open" });
  card(p, "pp", { title: "pp", ...dec });
  card(p, "pr", { title: "pr", ...dec });
  card(p, "outside", { title: "outside", status: "open" });
  seed(p, "edge.added", { from: "backup", to: "pp", type: "depends_on", why: "w" });
  seed(p, "edge.added", { from: "quota", to: "pr", type: "depends_on", why: "w" });
  seed(p, "node.reopened", { id: "pp", reason: "postponed", why: "later" });
  seed(p, "node.reopened", { id: "pr", reason: "rejected", why: "bad" });
  const o = all(await w(p, "find", "storage"));
  expect(o).toContain("cache");
  expect(o).toContain("index");
  expect(o).not.toContain("backup");
  expect(o).not.toContain("quota");
  expect(o).not.toContain("outside");
});

test("[66.5] a removed branch drops out of the find result and comes back after a restore", async () => {
  const p = freshProject();
  root(p);
  card(p, "storage", { title: "Storage", ...dec });
  card(p, "cache", { title: "Cache", parent: "storage", status: "open" });
  card(p, "index", { title: "Index", parent: "storage", status: "open" });
  await w(p, "remove", "cache", "--actor", "you");
  const o = all(await w(p, "find", "storage"));
  expect(o).toContain("index");
  expect(o).not.toContain("cache");
  await w(p, "restore", "cache", "--actor", "you");
  const o2 = all(await w(p, "find", "storage"));
  expect(o2).toContain("index");
  expect(o2).toContain("cache");
});

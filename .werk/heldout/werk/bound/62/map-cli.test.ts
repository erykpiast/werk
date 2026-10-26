import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  appendLog, createProject, decidedCard, logText, openCard, type Project, werkIn, writeLog,
} from "./helpers.ts";

let p: Project;
let w: ReturnType<typeof werkIn>;
beforeEach(() => { p = createProject(); w = werkIn(p); });
afterEach(() => p.dispose());

const first = (r: { stdout: string; stderr: string }) => `${r.stdout}\n${r.stderr}`;

test("05.1 propose under a parent and read back", async () => {
  writeLog(p, decidedCard("auth", "Auth"));
  const before = p.events().length;
  const added = await w("add", "login", "--title", "Use magic links", "--parent", "auth");
  expect(added.stdout.trim()).toBe("proposed");
  expect(p.events().length).toBe(before + 1);
  const shown = await w("show", "login");
  expect(shown.stdout).toContain("Use magic links");
  expect(shown.stdout).toContain("proposed");
  expect(shown.stdout).toMatch(/refines\s+auth/);
  expect(shown.stdout).toContain("rollup:");
});

test("05.2 duplicate id refused", async () => {
  writeLog(p, decidedCard("auth", "Auth"));
  await w("add", "login", "--title", "First words", "--parent", "auth");
  const n = p.events().length;
  const again = await w("add", "login", "--title", "Other words", "--parent", "auth");
  expect(again.code).not.toBe(0);
  expect(first(again)).toContain("duplicate-id");
  expect(p.events().length).toBe(n);
  expect((await w("show", "login")).stdout).toContain("First words");
});

test("05.3 decided status refused on add", async () => {
  writeLog(p, decidedCard("auth", "Auth"));
  const n = p.events().length;
  const r = await w("add", "pay", "--title", "Pay", "--parent", "auth", "--status", "decided");
  expect(r.code).not.toBe(0);
  expect(first(r)).toMatch(/decided/);
  expect(first(r)).toMatch(/not.*add|only through the status verb/);
  expect(p.events().length).toBe(n);
  const s = await w("show", "pay");
  expect(first(s)).toMatch(/unknown card|not found/i);
});

test("05.4 hash optional on ids, kept in title", async () => {
  writeLog(p, openCard("auth", "Auth"));
  const r = await w("add", "#login", "--title", "#1 priority: magic links", "--parent", "#auth");
  expect(r.stdout.trim()).toBe("proposed");
  const a = await w("show", "#login");
  const b = await w("show", "login");
  for (const s of [a, b]) {
    expect(s.stdout).toMatch(/refines\s+auth/);
    expect(s.stdout).toContain("#1 priority: magic links");
  }
});

test("05.5 hand-written bad line is listed, later cards show", async () => {
  writeLog(p, [
    ...openCard("auth", "Auth"),
    { type: "node.proposed", id: "bad", kind: "card", title: "Bad", status: "open", parent: "nowhere" },
    { type: "node.proposed", id: "login", kind: "card", title: "Login", status: "open", parent: "auth" },
  ]);
  const shown = await w("show", "login");
  expect(shown.stdout).toContain("proposed");
  expect(shown.stderr).toMatch(/log line \d+/);
  expect(shown.stderr).toContain("unknown-card");
  expect(logText(p)).toContain('"id":"bad"');
});

// ---------- 08 ----------
test("08.1 remove subtree and restore", async () => {
  writeLog(p, [
    ...decidedCard("auth", "Auth"),
    ...openCard("login", "Login", "auth"),
    ...openCard("session", "Session", "auth"),
    ...openCard("audit", "Audit"),
  ]);
  expect((await w("link", "login", "audit", "--type", "depends_on", "--why", "audit trail")).code).toBe(0);
  const n = p.events().length;
  const rm = await w("remove", "auth", "--actor", "you");
  expect(rm.code).toBe(0);
  expect(p.events().length).toBe(n + 1);
  for (const id of ["auth", "login", "session"]) expect((await w("show", id)).code).not.toBe(0);
  const removed = await w("removed");
  expect(removed.stdout).toContain("auth");
  expect(removed.stdout).toContain("login");
  expect(removed.stdout).toContain("session");
  expect((await w("show", "audit")).stdout).not.toContain("login");
  expect((await w("restore", "auth", "--actor", "you")).code).toBe(0);
  const login = await w("show", "login");
  expect(login.stdout).toMatch(/refines\s+auth/);
  expect(login.stdout).toMatch(/depends_on\s+audit/);
  const auth = await w("show", "auth");
  expect(auth.stdout).toContain("login");
  expect(auth.stdout).toContain("session");
  expect((await w("removed")).stdout).not.toContain("auth");
});

test("08.2 reparent remove and restore", async () => {
  writeLog(p, [
    ...decidedCard("platform", "Platform"),
    ...openCard("auth", "Auth", "platform"),
    ...openCard("login", "Login", "auth"),
    ...openCard("session", "Session", "auth"),
  ]);
  expect((await w("remove", "auth", "--actor", "you", "--reparent")).code).toBe(0);
  expect((await w("show", "auth")).code).not.toBe(0);
  const plat = (await w("show", "platform")).stdout;
  expect(plat).toContain("login");
  expect(plat).toContain("session");
  expect((await w("restore", "auth", "--actor", "you")).code).toBe(0);
  const plat2 = (await w("show", "platform")).stdout;
  expect(plat2).toMatch(/<- refines\s+auth/);
  expect(plat2).not.toMatch(/<- refines\s+login/);
  expect(plat2).not.toMatch(/<- refines\s+session/);
  const auth = (await w("show", "auth")).stdout;
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
});

test("08.3 link waits until both ends are back", async () => {
  writeLog(p, [...openCard("root", "Root"), ...openCard("a", "A", "root"), ...openCard("b", "B", "root"),
    ...openCard("login", "Login", "a"), ...openCard("session", "Session", "b")]);
  expect((await w("link", "login", "session", "--type", "depends_on", "--why", "needs")).code).toBe(0);
  await w("remove", "login", "--actor", "you");
  await w("remove", "session", "--actor", "you");
  await w("restore", "login", "--actor", "you");
  const l = await w("show", "login");
  expect(l.code).toBe(0);
  expect(l.stdout).not.toMatch(/depends_on\s+session/);
  await w("restore", "session", "--actor", "you");
  expect((await w("show", "login")).stdout).toMatch(/depends_on\s+session/);
});

test("08.4 removed id stays taken, source stays", async () => {
  writeLog(p, [...openCard("root", "Root"), ...openCard("login", "Login", "root"), ...openCard("billing", "Billing", "root")]);
  await w("add", "rfc-6749", "--kind", "source", "--title", "OAuth RFC", "--why", "finding");
  await w("accept", "rfc-6749", "--actor", "you");
  expect((await w("link", "login", "rfc-6749", "--type", "supported_by")).code).toBe(0);
  expect((await w("link", "billing", "rfc-6749", "--type", "supported_by")).code).toBe(0);
  await w("remove", "login", "--actor", "you");
  const src = await w("show", "rfc-6749");
  expect(src.code).toBe(0);
  expect((await w("show", "billing")).stdout).toContain("rfc-6749");
  const n = p.events().length;
  const add = await w("add", "login", "--title", "New login", "--parent", "root");
  expect(add.code).not.toBe(0);
  expect(first(add)).toMatch(/restore/);
  expect(first(add)).toContain("login");
  expect(p.events().length).toBe(n);
});

test("08.5 remove refuses without actor", async () => {
  writeLog(p, openCard("login", "Login"));
  const n = p.events().length;
  const r = await w("remove", "login");
  expect(r.code).not.toBe(0);
  expect((await w("show", "login")).code).toBe(0);
  expect(p.events().length).toBe(n);
});

test("08.6 restore refuses without actor", async () => {
  writeLog(p, [...openCard("root", "Root"), ...openCard("login", "Login", "root")]);
  await w("remove", "login", "--actor", "you");
  const n = p.events().length;
  const r = await w("restore", "login");
  expect(r.code).not.toBe(0);
  expect((await w("show", "login")).code).not.toBe(0);
  expect(p.events().length).toBe(n);
});

// ---------- 09 ----------
const lines = (r: { stdout: string }) => r.stdout.split("\n").filter((l) => l.trim() !== "");

test("09.1 search index", async () => {
  writeLog(p, [
    ...decidedCard("d1", "Decided one"), ...decidedCard("d2", "Decided two", "d1"), ...decidedCard("d3", "Decided three", "d1"),
    ...openCard("o1", "Open one", "d1"),
    { type: "node.proposed", id: "g1", kind: "card", title: "Ghost one", status: "decided", parent: "d1" },
  ]);
  const r = await w("search");
  const ls = lines(r);
  expect(ls.length).toBe(3);
  for (const id of ["d1", "d2", "d3"]) expect(r.stdout).toContain(id);
  expect(r.stdout).toContain("Decided one");
  expect(r.stdout).not.toContain("o1");
  expect(r.stdout).not.toContain("g1");
});

test("09.2 two terms ranked", async () => {
  writeLog(p, [
    ...decidedCard("root", "Root"),
    ...decidedCard("layout", "Cache layout", "root", { body: "Cache eviction and the eviction policy" }),
    ...openCard("timer", "Eviction timer", "root", { why: "eviction", body: "CACHE warmup" }),
    ...decidedCard("size", "Cache size", "root"),
    ...openCard("gone", "Gone", "root", { body: "cache eviction" }),
  ]);
  await w("remove", "gone", "--actor", "you");
  const r = await w("search", "cache", "eviction");
  const ls = lines(r);
  expect(ls.length).toBe(2);
  expect(ls[0]).toContain("layout");
  expect(ls[0]).toContain("decided");
  expect(ls[0]).toContain("Cache layout");
  expect(ls[1]).toContain("timer");
  expect(ls[1]).toContain("open");
  expect(r.stdout).not.toContain("Cache size");
  expect(r.stdout).not.toContain("gone");
});

test("09.3 rejected option and narrowing", async () => {
  writeLog(p, [
    ...decidedCard("parent", "Parent topic"),
    ...decidedCard("storage", "Storage format", "parent"),
    ...openCard("other", "Elsewhere", undefined, { body: "sqlite is mentioned" }),
    { type: "node.proposed", id: "opt", kind: "option", title: "Database file", status: "open", why: "SQLite needs a native build" },
    { type: "node.accepted", id: "opt", actor: "you" },
    { type: "edge.added", from: "opt", to: "storage", link: "alternative_to" },
  ]);
  expect(p.events().length).toBeGreaterThan(5);
  const r = await w("search", "sqlite");
  expect(r.stdout).toContain("Storage format");
  expect(r.stdout).toContain("decided");
  expect(r.stdout).toContain("Elsewhere");
  const under = await w("search", "sqlite", "--under", "parent");
  expect(lines(under).length).toBe(1);
  expect(under.stdout).toContain("Storage format");
  const st = await w("search", "sqlite", "--status", "decided");
  expect(lines(st).length).toBe(1);
  expect(st.stdout).toContain("Storage format");
});

function clientTree() {
  return [
    ...decidedCard("root", "Root"),
    ...decidedCard("client", "Client", "root"),
    ...openCard("routing", "Routing", "client"),
    { type: "node.proposed", id: "theme", kind: "card", title: "Theme", status: "proto", why: "w", parent: "client" },
    { type: "node.accepted", id: "theme", actor: "you" },
    ...openCard("guards", "Route guards", "routing"),
    ...decidedCard("pp", "Postponed card", "client"),
    ...openCard("p1", "Paused card", "client"),
    { type: "edge.added", from: "p1", to: "pp", link: "depends_on", why: "needs it" },
    ...decidedCard("inv", "Invalidated base", "root"),
    ...openCard("s1", "Stale card", "client"),
    { type: "edge.added", from: "s1", to: "inv", link: "depends_on", why: "needs it" },
    ...openCard("billing", "Billing", "root"),
  ];
}

test("09.4 find open work under one card", async () => {
  writeLog(p, [
    ...clientTree(),
    { type: "node.proposed", id: "opt1", kind: "option", title: "Opt thing", status: "open", why: "no" },
    { type: "node.accepted", id: "opt1", actor: "you" },
    { type: "edge.added", from: "opt1", to: "routing", link: "alternative_to" },
    { type: "node.proposed", id: "src1", kind: "source", title: "Src thing", status: "open", why: "f" },
    { type: "node.accepted", id: "src1", actor: "you" },
    { type: "edge.added", from: "routing", to: "src1", link: "supported_by" },
  ]);
  expect((await w("reopen", "pp", "--reason", "postponed", "--why", "later")).code).toBe(0);
  expect((await w("reopen", "inv", "--reason", "invalidated", "--why", "wrong")).code).toBe(0);
  const shownP = (await w("show", "p1")).stdout;
  const shownS = (await w("show", "s1")).stdout;
  expect(shownP).toContain("PAUSED");
  expect(shownS).toContain("STALE");
  expect((await w("show", "pp")).stdout).toContain("POSTPONED");
  const r = await w("find", "routing");
  const ls = lines(r);
  expect(r.stdout).toContain("Routing");
  expect(r.stdout.indexOf("Routing")).toBeLessThan(r.stdout.indexOf("Route guards"));
  expect(r.stdout).not.toContain("Billing");
  expect(r.stdout).not.toContain("Opt thing");
  expect(r.stdout).not.toContain("Src thing");
  void ls;
  const c = await w("find", "client");
  expect(c.stdout).not.toContain("Paused card");
  expect(c.stdout).not.toContain("Stale card");
  expect(c.stdout).not.toContain("Postponed card");
  expect(c.stdout).toContain("Routing");
  expect(c.stdout).toContain("Theme");
  expect(c.stdout.indexOf("Routing")).toBeLessThan(c.stdout.indexOf("Route guards"));
  expect(c.stdout.indexOf("Theme")).toBeLessThan(c.stdout.indexOf("Route guards"));
  expect(c.stdout).not.toMatch(/\bClient\b/);
});

test("09.5 reopened rejected shows in find", async () => {
  writeLog(p, [
    ...openCard("t1", "Tree one"), ...openCard("t2", "Tree two"),
    ...decidedCard("auth", "Auth flow"),
  ]);
  const re = await w("reopen", "auth", "--reason", "rejected", "--why", "no longer wanted");
  expect(re.code).toBe(0);
  const r = await w("find");
  expect(r.stdout).toContain("Tree one");
  expect(r.stdout).toContain("Tree two");
  expect(r.stdout).toContain("Auth flow");
});

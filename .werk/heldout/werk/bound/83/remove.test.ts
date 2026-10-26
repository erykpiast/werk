import { expect, test } from "bun:test";
import { logEvents, logLines, ok, real, seed, shown, withRoot } from "./lib.ts";

const dep = (from: string, to: string) => ({
  type: "edge.added",
  payload: { from, to, type: "depends_on", why: "needs it" },
});
const decided = (id: string, parent = "root", extra = {}) =>
  real(id, parent, { status: "decided", who: "me", no_basis: "x", ...extra });
const open = (id: string, parent = "root", title = id) => real(id, parent, { title, status: "open" });

test("08.1 removing takes the subtree out in one step and a restore brings it back", async () => {
  const p = withRoot([decided("auth"), open("login", "auth"), open("session", "auth"), open("audit"), dep("login", "audit")]);
  const n = logLines(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  const added = logEvents(p).slice(n);
  expect(added.length).toBe(1);
  expect(added[0].type).toBe("node.removed");
  for (const id of ["auth", "login", "session"]) expect((await shown(p, id)).code).toBe(1);
  const root = (await shown(p, "root")).text;
  for (const id of ["auth", "login", "session"]) expect(root).not.toContain(id);
  const rm = (await p.werk(["removed"])).out;
  expect(rm).toContain("auth");
  expect(rm).toContain("login");
  expect(rm).toContain("session");
  expect((await shown(p, "audit")).text).not.toContain("login");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  const a = (await shown(p, "auth")).text;
  expect(a).toContain("login");
  expect(a).toContain("session");
  expect((await shown(p, "audit")).text).toContain("login");
  expect((await p.werk(["removed"])).out).toContain("no card is removed");
});

test("08.2 removal with reparent moves the children up and a restore puts them back", async () => {
  const p = withRoot([open("platform"), open("auth", "platform"), open("login", "auth"), open("session", "auth")]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect((await shown(p, "auth")).code).toBe(1);
  const pl = (await shown(p, "platform")).text;
  expect(pl).toMatch(/<- refines\s+login/);
  expect(pl).toMatch(/<- refines\s+session/);
  await ok(p, ["restore", "auth", "--actor", "you"]);
  const pl2 = (await shown(p, "platform")).text;
  expect(pl2).toMatch(/<- refines\s+auth/);
  expect(pl2).not.toMatch(/<- refines\s+login/);
  expect(pl2).not.toMatch(/<- refines\s+session/);
  const a = (await shown(p, "auth")).text;
  expect(a).toMatch(/<- refines\s+login/);
  expect(a).toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both of its ends are back", async () => {
  const p = withRoot([open("a"), open("b"), open("login", "a"), open("session", "b"), dep("login", "session")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const l = await shown(p, "login");
  expect(l.code).toBe(0);
  expect(l.text).not.toMatch(/depends_on\s+session/);
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect((await shown(p, "login")).text).toMatch(/depends_on\s+session/);
});

test("08.4 a removed card's id stays taken and a cited source stays", async () => {
  const p = withRoot([
    open("login"),
    open("billing"),
    real("rfc-6749", undefined, { kind: "source", title: "RFC 6749", finding: "f" }),
    { type: "edge.added", payload: { from: "login", to: "rfc-6749", type: "supported_by" } },
    { type: "edge.added", payload: { from: "billing", to: "rfc-6749", type: "supported_by" } },
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const s = await shown(p, "rfc-6749");
  expect(s.code).toBe(0);
  expect(s.text).toContain("billing");
  expect(s.text).not.toMatch(/<- supported_by\s+login/);
  const before = logLines(p);
  const r = await p.werk(["add", "login", "--title", "New login"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/restore/);
  expect(r.err).toContain("login");
  expect(logLines(p)).toEqual(before);
  expect((await shown(p, "login")).code).toBe(1);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const p = withRoot([open("login")]);
  const before = logLines(p);
  const r = await p.werk(["remove", "login"]);
  expect(r.code).not.toBe(0);
  expect((await shown(p, "login")).code).toBe(0);
  expect(logLines(p)).toEqual(before);
});

test("08.6 restore refuses without the person's say-so", async () => {
  const p = withRoot([open("login")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const before = logLines(p);
  const r = await p.werk(["restore", "login"]);
  expect(r.code).not.toBe(0);
  expect((await shown(p, "login")).code).toBe(1);
  expect(logLines(p)).toEqual(before);
});

test("66.1 an agent removes a bad branch and the log keeps its history", async () => {
  const p = withRoot([open("storage"), open("cache", "storage"), open("index", "storage"), open("eviction", "cache")]);
  const n = logLines(p).length;
  await ok(p, ["remove", "cache", "--actor", "you"]);
  for (const id of ["cache", "eviction"]) {
    const s = await shown(p, id);
    expect(s.text).toContain("removed");
  }
  const st = (await shown(p, "storage")).text;
  expect(st).not.toMatch(/<- refines\s+cache/);
  expect(st).toMatch(/<- refines\s+index/);
  expect((await p.werk(["removed"])).out).toContain("cache");
  expect(logLines(p).length).toBe(n + 1);
});

test("66.2 a restore brings the subtree and its links back", async () => {
  const p = withRoot([open("storage"), open("cache", "storage"), open("eviction", "cache"), open("mem", "root", "Memory budget"), dep("cache", "mem")]);
  await ok(p, ["remove", "cache", "--actor", "you"]);
  await ok(p, ["restore", "cache", "--actor", "you"]);
  const c = await shown(p, "cache");
  expect(c.text).not.toContain("is removed");
  expect(c.text).toMatch(/depends_on\s+mem/);
  expect(c.text).toMatch(/<- refines\s+eviction/);
  expect((await shown(p, "storage")).text).toMatch(/<- refines\s+cache/);
  expect((await p.werk(["removed"])).out).not.toContain("cache");
});

test("66.3 remove with the option that lifts children", async () => {
  const p = withRoot([open("storage"), open("bad", "storage", "Bad layer"), open("write", "bad"), open("read", "bad")]);
  await ok(p, ["remove", "bad", "--actor", "you", "--reparent"]);
  expect((await shown(p, "bad")).text).toContain("removed");
  const st = (await shown(p, "storage")).text;
  expect(st).toMatch(/<- refines\s+write/);
  expect(st).toMatch(/<- refines\s+read/);
  for (const id of ["write", "read"]) {
    const s = await shown(p, id);
    expect(s.code).toBe(0);
    expect(s.text).not.toContain("is removed");
  }
});

test("66.5 a removed branch drops out of find and comes back after a restore", async () => {
  const p = withRoot([open("storage"), open("cache", "storage"), open("index", "storage")]);
  await ok(p, ["remove", "cache", "--actor", "you"]);
  const f = (await ok(p, ["find", "storage"])).out;
  expect(f).toContain("index");
  expect(f).not.toContain("cache");
  await ok(p, ["restore", "cache", "--actor", "you"]);
  const f2 = (await ok(p, ["find", "storage"])).out;
  expect(f2).toContain("index");
  expect(f2).toContain("cache");
});

import { afterEach, expect, test } from "bun:test";
import { linkLine } from "./b-helpers.ts";
import { cleanupAll, type P, project } from "./cli.ts";

afterEach(cleanupAll);

const shows = (p: P, id: string) => p.werk("show", id).code === 0;
const parentOf = (p: P, id: string) => /parent: (\S+)/.exec(p.werk("show", id).out)?.[1];
const children = (p: P, id: string) =>
  p
    .werk("show", id)
    .out.split("\n")
    .filter((l) => /^\s+<- refines/.test(l))
    .map((l) => l.trim().split(/\s+/)[2]);

test("08.1 remove subtree in one step, restore brings it back", () => {
  const p = project();
  p.card("root", "Root");
  p.card("auth", "Auth", { parent: "root", status: "decided" });
  p.card("login", "Login", { parent: "auth", status: "decided" });
  p.card("session", "Session", { parent: "auth", status: "decided" });
  p.card("audit", "Audit", { parent: "root", status: "decided" });
  p.seed("edge.added", { from: "login", to: "audit", type: "depends_on", why: "writes audit lines" });
  const before = p.lines().length;
  expect(p.werk("remove", "auth", "--actor", "you").code).toBe(0);
  for (const id of ["auth", "login", "session"]) {
    expect(shows(p, id)).toBe(false);
    expect(p.werk("search").out).not.toContain(`${id} `);
    expect(p.werk("find").out).not.toMatch(new RegExp(`^${id}\\s`, "m"));
  }
  expect(children(p, "root")).not.toContain("auth");
  const ev = p.events().slice(before);
  expect(ev.length).toBe(1);
  expect(ev[0]?.type).toBe("node.removed");
  const removed = p.werk("removed").out;
  expect(removed).toMatch(/auth: removed/);
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect(linkLine(p.werk("show", "audit").out, "depends_on", "login")).toBeUndefined();
  expect(p.werk("restore", "auth", "--actor", "you").code).toBe(0);
  expect(shows(p, "auth")).toBe(true);
  expect(parentOf(p, "login")).toBe("auth");
  expect(parentOf(p, "session")).toBe("auth");
  expect(linkLine(p.werk("show", "audit").out, "depends_on", "login")).toBeDefined();
  expect(linkLine(p.werk("show", "login").out, "depends_on", "audit")).toBeDefined();
  expect(p.werk("removed").out).not.toMatch(/auth|login|session/);
});

test("08.2 remove with reparent moves children up, restore puts them back", () => {
  const p = project();
  p.card("root", "Root");
  p.card("platform", "Platform", { parent: "root" });
  p.card("auth", "Auth", { parent: "platform" });
  p.card("login", "Login", { parent: "auth" });
  p.card("session", "Session", { parent: "auth" });
  expect(p.werk("remove", "auth", "--actor", "you", "--reparent").code).toBe(0);
  expect(shows(p, "auth")).toBe(false);
  expect(children(p, "platform").sort()).toEqual(["login", "session"]);
  expect(p.werk("restore", "auth", "--actor", "you").code).toBe(0);
  expect(children(p, "platform")).toEqual(["auth"]);
  expect(children(p, "auth").sort()).toEqual(["login", "session"]);
});

test("08.3 a link waits until both ends are back", () => {
  const p = project();
  p.card("root", "Root");
  p.card("branch-a", "Branch A", { parent: "root" });
  p.card("branch-b", "Branch B", { parent: "root" });
  p.card("login", "Login", { parent: "branch-a", status: "decided" });
  p.card("session", "Session", { parent: "branch-b", status: "decided" });
  p.seed("edge.added", { from: "login", to: "session", type: "depends_on", why: "needs a session" });
  expect(p.werk("remove", "login", "--actor", "you").code).toBe(0);
  expect(p.werk("remove", "session", "--actor", "you").code).toBe(0);
  expect(p.werk("restore", "login", "--actor", "you").code).toBe(0);
  expect(shows(p, "login")).toBe(true);
  expect(linkLine(p.werk("show", "login").out, "depends_on", "session")).toBeUndefined();
  expect(p.werk("restore", "session", "--actor", "you").code).toBe(0);
  expect(linkLine(p.werk("show", "login").out, "depends_on", "session")).toBeDefined();
  expect(linkLine(p.werk("show", "session").out, "depends_on", "login")).toBeDefined();
});

test("08.4 removed id stays taken; cited source stays", () => {
  const p = project();
  p.card("root", "Root");
  p.card("login", "Login", { parent: "root" });
  p.card("billing", "Billing", { parent: "root" });
  p.seed("node.added", { id: "rfc-6749", kind: "source", title: "RFC 6749", finding: "OAuth 2.0" });
  p.seed("edge.added", { from: "login", to: "rfc-6749", type: "supported_by" });
  p.seed("edge.added", { from: "billing", to: "rfc-6749", type: "supported_by" });
  expect(p.werk("remove", "login", "--actor", "you").code).toBe(0);
  const src = p.werk("show", "rfc-6749");
  expect(src.code).toBe(0);
  expect(linkLine(src.out, "supported_by", "billing")).toBeDefined();
  const before = p.raw();
  const add = p.werk("add", "login", "--title", "New login", "--parent", "root");
  expect(add.code).not.toBe(0);
  expect(add.all).toMatch(/restore #login/);
  expect(p.raw()).toBe(before);
});

test("08.5 remove refuses without --actor you", () => {
  const p = project();
  p.card("root", "Root");
  p.card("login", "Login", { parent: "root" });
  const before = p.raw();
  expect(p.werk("remove", "login").code).not.toBe(0);
  expect(shows(p, "login")).toBe(true);
  expect(p.raw()).toBe(before);
});

test("08.6 restore refuses without --actor you", () => {
  const p = project();
  p.card("root", "Root");
  p.card("login", "Login", { parent: "root" });
  expect(p.werk("remove", "login", "--actor", "you").code).toBe(0);
  const before = p.raw();
  expect(p.werk("restore", "login").code).not.toBe(0);
  expect(shows(p, "login")).toBe(false);
  expect(p.raw()).toBe(before);
});

test("66.1 agent removes a bad branch; log keeps history", () => {
  const p = project();
  p.card("root", "Root");
  p.card("storage", "Storage", { parent: "root" });
  p.card("cache", "Cache", { parent: "storage" });
  p.card("index", "Index", { parent: "storage" });
  p.card("eviction", "Eviction", { parent: "cache" });
  const before = p.lines();
  // werk refuses a remove without the claim that the person asked; the agent passes it.
  expect(p.werk("remove", "cache", "--actor", "you").code).toBe(0);
  const c = p.werk("show", "cache");
  expect(c.code).not.toBe(0);
  expect(c.all).toMatch(/removed/);
  const e = p.werk("show", "eviction");
  expect(e.all).toMatch(/removed/);
  expect(children(p, "storage")).toEqual(["index"]);
  expect(p.werk("removed").out).toContain("cache");
  const after = p.lines();
  expect(after.length).toBe(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
});

test("66.2 restore brings subtree and links back", () => {
  const p = project();
  p.card("root", "Root");
  p.card("storage", "Storage", { parent: "root" });
  p.card("memory-budget", "Memory budget", { parent: "root", status: "decided" });
  p.card("cache", "Cache", { parent: "storage" });
  p.card("eviction", "Eviction", { parent: "cache" });
  p.seed("edge.added", { from: "cache", to: "memory-budget", type: "depends_on", why: "fits the budget" });
  p.werk("remove", "cache", "--actor", "you");
  expect(p.werk("restore", "cache", "--actor", "you").code).toBe(0);
  const c = p.werk("show", "cache");
  expect(c.code).toBe(0);
  expect(c.all).not.toMatch(/removed/);
  expect(children(p, "storage")).toContain("cache");
  expect(children(p, "cache")).toContain("eviction");
  expect(linkLine(c.out, "depends_on", "memory-budget")).toBeDefined();
  expect(p.werk("removed").out).not.toContain("cache");
});

test("66.3 remove bad parent, lift its children", () => {
  const p = project();
  p.card("root", "Root");
  p.card("storage", "Storage", { parent: "root" });
  p.card("bad-layer", "Bad layer", { parent: "storage" });
  p.card("write-path", "Write path", { parent: "bad-layer" });
  p.card("read-path", "Read path", { parent: "bad-layer" });
  expect(p.werk("remove", "bad-layer", "--actor", "you", "--reparent").code).toBe(0);
  expect(p.werk("show", "bad-layer").all).toMatch(/removed/);
  expect(children(p, "storage").sort()).toEqual(["read-path", "write-path"]);
  for (const id of ["write-path", "read-path"]) {
    const s = p.werk("show", id);
    expect(s.code).toBe(0);
    expect(s.all).not.toMatch(/removed/);
  }
});

test("66.4 find open cards in a subtree, without paused and stale", () => {
  const p = project();
  p.card("root", "Root");
  p.card("storage", "Storage", { parent: "root", status: "decided" });
  p.card("later", "Later engine", { parent: "root", status: "decided" });
  p.card("wrong", "Wrong choice", { parent: "root", status: "decided" });
  for (const [id, t] of [
    ["cache", "Cache"],
    ["index", "Index"],
    ["backup", "Backup"],
    ["quota", "Quota"],
  ])
    p.card(id as string, t as string, { parent: "storage" });
  p.card("elsewhere", "Elsewhere open", { parent: "root" });
  p.seed("edge.added", { from: "backup", to: "later", type: "depends_on", why: "runs on the engine" });
  p.seed("edge.added", { from: "quota", to: "wrong", type: "depends_on", why: "built on the choice" });
  expect(p.werk("reopen", "later", "--reason", "postponed", "--why", "next quarter").code).toBe(0);
  expect(p.werk("reopen", "wrong", "--reason", "rejected", "--why", "wrong").code).toBe(0);
  const out = p.werk("find", "storage").out;
  const ids = out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split(/\s+/)[0]);
  expect(ids).toContain("cache");
  expect(ids).toContain("index");
  expect(ids).not.toContain("backup");
  expect(ids).not.toContain("quota");
  expect(ids).not.toContain("elsewhere");
});

test("66.5 removed branch drops out of find, back after restore", () => {
  const p = project();
  p.card("root", "Root");
  p.card("storage", "Storage", { parent: "root", status: "decided" });
  p.card("cache", "Cache", { parent: "storage" });
  p.card("index", "Index", { parent: "storage" });
  p.werk("remove", "cache", "--actor", "you");
  const ids = () =>
    p
      .werk("find", "storage")
      .out.split("\n")
      .filter(Boolean)
      .map((l) => l.split(/\s+/)[0]);
  expect(ids()).toContain("index");
  expect(ids()).not.toContain("cache");
  p.werk("restore", "cache", "--actor", "you");
  expect(ids()).toContain("index");
  expect(ids()).toContain("cache");
});

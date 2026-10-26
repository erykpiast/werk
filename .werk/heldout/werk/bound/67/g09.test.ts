import { expect, test } from "bun:test";
import { make } from "./lib.ts";

const ids = (out: string) =>
  out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split(/\s+/)[0]);

test("09.1 an agent lists the index of decided cards", async () => {
  const p = make();
  p.card("root", { title: "Root", status: "decided", who: "me" });
  p.card("d1", { title: "Decided one", parent: "root", status: "decided", who: "me" });
  p.card("d2", { title: "Decided two", parent: "root", status: "decided", who: "me" });
  p.card("open1", { title: "Open one", parent: "root" });
  p.seed("node.proposed", {
    id: "ghost1",
    kind: "card",
    title: "Ghost one",
    parent: "root",
    status: "decided",
    who: "me",
  });
  const r = await p.w("search");
  expect(r.code).toBe(0);
  const lines = r.out.split("\n").filter(Boolean);
  expect(lines).toEqual(["root  Root", "d1  Decided one", "d2  Decided two"]);
  expect(r.out).not.toContain("open1");
  expect(r.out).not.toContain("ghost1");
});

test("09.2 an agent searches with two terms and sees the best match first", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  p.card("cache-layout", {
    title: "Cache layout",
    body: "Cache eviction uses an eviction policy.",
    parent: "root",
    status: "decided",
    who: "me",
  });
  p.card("eviction-timer", { title: "Eviction timer", why: "eviction", body: "CACHE warmup", parent: "root" });
  p.card("cache-size", { title: "Cache size", body: "cache", parent: "root", status: "decided", who: "me" });
  p.card("old-cache", { title: "Old", body: "cache eviction", parent: "root" });
  expect((await p.w("remove", "old-cache", "--actor", "you")).code).toBe(0);
  const r = await p.w("search", "cache", "eviction");
  expect(r.code).toBe(0);
  const lines = r.out.split("\n").filter(Boolean);
  expect(lines).toEqual(["cache-layout  decided  Cache layout", "eviction-timer  open  Eviction timer"]);
});

test("09.3 an agent finds a card by a word in a rejected option and narrows the search", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  p.card("parent-topic", { title: "Parent topic", parent: "root", status: "decided", who: "me" });
  p.card("storage", { title: "Storage format", parent: "parent-topic", status: "decided", who: "me" });
  p.seed("node.added", {
    id: "storage:opt0",
    kind: "option",
    title: "A database file",
    why_not: "SQLite needs a native build",
  });
  p.seed("edge.added", { from: "storage:opt0", to: "storage", type: "alternative_to" });
  p.card("outside", { title: "Outside card", body: "Maybe sqlite later", parent: "root" });
  const r = await p.w("search", "sqlite");
  expect(r.out).toContain("storage  decided  Storage format");
  expect(ids(r.out)).toContain("outside");
  const u = await p.w("search", "sqlite", "--under", "parent-topic");
  expect(ids(u.out)).toEqual(["storage"]);
  const s = await p.w("search", "sqlite", "--status", "decided");
  expect(ids(s.out)).toEqual(["storage"]);
});

test("09.4 an agent finds the open work under one card", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  p.card("client", { title: "Client", parent: "root", status: "decided", who: "me" });
  p.card("routing", { title: "Routing", parent: "client" });
  p.card("theme", { title: "Theme", parent: "client", status: "proto" });
  p.card("guards", { title: "Route guards", parent: "routing" });
  // the cards whose reopen pauses or stales the marked cards
  p.card("base-p", { title: "Base postponed", parent: "root", status: "decided", who: "me" });
  p.card("base-r", { title: "Base rejected", parent: "root", status: "decided", who: "me" });
  p.card("paused", { title: "Paused card", parent: "client" });
  p.card("stale", { title: "Stale card", parent: "client" });
  p.card("postponed", { title: "Postponed card", parent: "client", status: "decided", who: "me" });
  p.seed("edge.added", { from: "paused", to: "base-p", type: "depends_on", why: "x" });
  p.seed("edge.added", { from: "stale", to: "base-r", type: "depends_on", why: "x" });
  p.seed("node.reopened", { id: "base-p", reason: "postponed", why: "later" });
  p.seed("node.reopened", { id: "base-r", reason: "rejected", why: "wrong" });
  p.seed("node.reopened", { id: "postponed", reason: "postponed", why: "later" });
  p.seed("node.added", { id: "routing:opt0", kind: "option", title: "Hash routes", why_not: "ugly" });
  p.seed("edge.added", { from: "routing:opt0", to: "routing", type: "alternative_to" });
  p.seed("node.added", { id: "src-r", kind: "source", title: "Router docs", finding: "ok" });
  p.seed("edge.added", { from: "routing", to: "src-r", type: "supported_by" });
  p.card("billing-root", { title: "Billing root", status: "decided", who: "me" });
  p.card("billing", { title: "Billing", parent: "billing-root" });
  const r = await p.w("find", "routing");
  expect(r.code).toBe(0);
  expect(ids(r.out)).toEqual(["routing", "guards"]);
  const c = await p.w("find", "client");
  const got = ids(c.out);
  expect(got).toContain("routing");
  expect(got).toContain("theme");
  expect(got.indexOf("routing")).toBeLessThan(got.indexOf("guards"));
  expect(got.indexOf("theme")).toBeLessThan(got.indexOf("guards"));
  expect(got).not.toContain("client");
  expect(got).not.toContain("paused");
  expect(got).not.toContain("stale");
  expect(got).not.toContain("postponed");
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const p = make();
  p.card("tree-a", { title: "Tree A", status: "decided", who: "me" });
  p.card("open-a", { title: "Open A", parent: "tree-a" });
  p.card("tree-b", { title: "Tree B", status: "decided", who: "me" });
  p.card("open-b", { title: "Open B", parent: "tree-b" });
  p.card("auth-flow", { title: "Auth flow", parent: "tree-a", status: "decided", who: "me" });
  p.seed("node.reopened", { id: "auth-flow", reason: "rejected", why: "wrong flow" });
  const r = await p.w("find");
  const got = ids(r.out);
  expect(got).toContain("open-a");
  expect(got).toContain("open-b");
  expect(got).toContain("auth-flow");
  expect(got).not.toContain("tree-a");
  expect(got).not.toContain("tree-b");
  expect(r.out).not.toContain("decided");
});

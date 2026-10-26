import { expect, test } from "bun:test";
import { decided, ghost, link, open, useWerk } from "./query-support.ts";

const { werk, seed } = useWerk();
const lines = (s: string) => s.trim().split("\n").filter(Boolean);

test("09.1 index of decided cards", async () => {
  seed([
    ...decided("a", { title: "Alpha" }),
    ...decided("b", { title: "Beta" }),
    ...decided("c", { title: "Gamma" }),
    ...open("o", { title: "Open one" }),
    ghost("g", { title: "Ghosty", status: "decided" }),
  ]);
  const r = await werk("search");
  expect(r.code).toBe(0);
  expect(lines(r.stdout)).toEqual(["a  Alpha", "b  Beta", "c  Gamma"]);
});

test("09.2 two terms, best match first", async () => {
  seed([
    ...decided("layout", {
      title: "Cache layout",
      body: "Cache eviction and eviction policy.",
    }),
    ...open("timer", {
      title: "Eviction timer",
      why: "eviction",
      body: "CACHE warmup",
    }),
    ...decided("size", { title: "Cache size", body: "cache only" }),
    ...decided("gone", { title: "Gone", body: "cache eviction" }),
    { type: "node.removed", id: "gone", actor: "you" },
  ]);
  const r = await werk("search", "cache", "eviction");
  expect(r.code).toBe(0);
  expect(lines(r.stdout)).toEqual([
    "layout  [decided]  Cache layout",
    "timer  [open]  Eviction timer",
  ]);
});

test("09.3 rejected option word and narrowing", async () => {
  seed([
    ...decided("parent", { title: "Parent topic" }),
    ...decided("fmt", { title: "Storage format", parent: "parent" }),
    ...open("opt", {
      kind: "option",
      title: "Use a database",
      why: "SQLite needs a native build",
    }),
    link("opt", "fmt", "alternative_to", ""),
    ...open("other", { title: "Other", body: "we use sqlite here" }),
  ]);
  const all = await werk("search", "sqlite");
  expect(all.stdout).toContain("fmt  [decided]  Storage format");
  expect(all.stdout).toContain("other  [open]  Other");
  const under = await werk("search", "sqlite", "--under", "parent");
  expect(lines(under.stdout)).toEqual(["fmt  [decided]  Storage format"]);
  const st = await werk("search", "sqlite", "--status", "decided");
  expect(lines(st.stdout)).toEqual(["fmt  [decided]  Storage format"]);
});

function work() {
  return [
    ...decided("client", { title: "Client" }),
    ...open("routing", { title: "Routing", parent: "client" }),
    ...open("theme", { title: "Theme", parent: "client", status: "proto" }),
    ...open("guards", { title: "Route guards", parent: "routing" }),
    // stale: depends on a decided card that is then reopened as invalidated
    ...decided("dd", { title: "DD" }),
    ...open("stalec", { title: "Stale card", parent: "client" }),
    link("stalec", "dd"),
    { type: "node.reopened", id: "dd", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" },
    // paused
    ...decided("qq", { title: "QQ" }),
    ...open("pausedc", { title: "Paused card", parent: "client" }),
    link("pausedc", "qq"),
    { type: "node.reopened", id: "qq", reason: "postponed", at: "2026-10-10T09:00:00.000Z" },
    // postponed
    ...decided("postc", { title: "Postponed card", parent: "client" }),
    { type: "node.reopened", id: "postc", reason: "postponed", at: "2026-10-10T09:00:00.000Z" },
    ...open("opt", { kind: "option", title: "An option", why: "no" }),
    link("opt", "routing", "alternative_to", ""),
    ...open("src", { kind: "source", title: "A source" }),
    link("routing", "src", "supported_by", ""),
    ...open("billing", { title: "Billing" }),
  ];
}

test("09.4 find the open work under one card", async () => {
  seed(work());
  const r = await werk("find", "routing");
  expect(r.code).toBe(0);
  expect(lines(r.stdout)).toEqual([
    "routing  [open]  Routing",
    "guards  [open]  Route guards",
  ]);
  const c = await werk("find", "client");
  expect(lines(c.stdout)).toEqual([
    "routing  [open]  Routing",
    "theme  [proto]  Theme",
    "guards  [open]  Route guards",
  ]);
  expect(c.stdout).not.toContain("Stale card");
  expect(c.stdout).not.toContain("Paused card");
  expect(c.stdout).not.toContain("Postponed card");
});

test("09.5 reopened as rejected comes back as work in every tree", async () => {
  seed([
    ...open("t1", { title: "Tree one" }),
    ...open("t2", { title: "Tree two" }),
    ...decided("auth", { title: "Auth flow" }),
    { type: "node.reopened", id: "auth", reason: "rejected", at: "2026-10-10T09:00:00.000Z" },
  ]);
  const r = await werk("find");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Tree one");
  expect(r.stdout).toContain("Tree two");
  expect(r.stdout).toContain("Auth flow");
  expect(r.stdout).not.toContain("[decided]");
});

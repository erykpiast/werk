import { expect } from "bun:test";
import { decided, ghost, link, open } from "../src/map/mark-fixtures.ts";
import { type Ctx, t } from "./helpers.ts";

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

t("09.1 search with no term lists the decided cards", async (ctx) => {
  ctx.seed(
    ...decided("d1", { title: "Decided one" }),
    ...decided("d2", { title: "Decided two" }),
    ...decided("d3", { title: "Decided three" }),
    ...open("o1", { title: "Open card" }),
    ghost("g1", { title: "Ghost card" }),
    { type: "node.edited", id: "g1", who: "me", noBasis: "t" },
    { type: "criterion.added", id: "g1", form: "revisit" },
    { type: "node.decided", id: "g1" },
  );
  const r = await ctx.werk("search");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(3);
  for (const [id, title] of [["d1", "Decided one"], ["d2", "Decided two"], ["d3", "Decided three"]]) {
    expect(out.some((l) => l.includes(id as string) && l.includes(title as string))).toBe(true);
  }
  expect(r.stdout).not.toContain("Open card");
  expect(r.stdout).not.toContain("Ghost card");
});

t("09.2 search with two terms ranks the most hits first", async (ctx) => {
  ctx.seed(
    ...decided("cache-layout", { title: "Cache layout", body: "Cache eviction happens here.\n\nThe eviction policy is LRU." }),
    ...open("eviction-timer", { title: "Eviction timer", why: "eviction needs a timer", body: "CACHE warmup" }),
    ...decided("cache-size", { title: "Cache size", body: "cache is small" }),
    ...open("gone", { title: "Gone", body: "cache eviction" }),
    { type: "node.removed", id: "gone" },
  );
  const r = await ctx.werk("search", "cache", "eviction");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(2);
  expect(out[0]).toContain("cache-layout");
  expect(out[0]).toContain("decided");
  expect(out[0]).toContain("Cache layout");
  expect(out[1]).toContain("eviction-timer");
  expect(out[1]).toContain("open");
  expect(r.stdout).not.toContain("Cache size");
  expect(r.stdout).not.toContain("Gone");
});

t("09.3 a word in a rejected option is found and the search narrows", async (ctx) => {
  ctx.seed(
    ...decided("parent-topic", { title: "Parent topic" }),
    ...decided("storage-format", { parent: "parent-topic", title: "Storage format" }),
    ...open("opt", { kind: "option", title: "SQL store", why: "SQLite needs a native build" }),
    link("opt", "storage-format", "alternative_to"),
    ...open("other", { title: "Other open", body: "we may use sqlite here" }),
  );
  const all = await ctx.werk("search", "sqlite");
  expect(all.stdout).toContain("Storage format");
  expect(all.stdout).toContain("decided");
  expect(all.stdout).toContain("Other open");
  const under = await ctx.werk("search", "sqlite", "--under", "parent-topic");
  expect(lines(under.stdout)).toHaveLength(1);
  expect(under.stdout).toContain("Storage format");
  const st = await ctx.werk("search", "sqlite", "--status", "decided");
  expect(lines(st.stdout)).toHaveLength(1);
  expect(st.stdout).toContain("Storage format");
});


t("09.4 find lists open work under one card", async (ctx) => {
  ctx.seed(
    ...decided("client", { title: "Client" }),
    ...open("routing", { parent: "client", title: "Routing" }),
    ...open("theme", { parent: "client", title: "Theme", status: "proto" }),
    ...open("guards", { parent: "routing", title: "Route guards" }),
    ...decided("p3", { parent: "client", title: "Postponed card" }),
    ...open("p1", { parent: "client", title: "Paused card" }),
    link("p1", "p3"),
    ...decided("base", { title: "Base" }),
    ...open("p2", { parent: "client", title: "Stale card" }),
    link("p2", "base"),
    { type: "node.reopened", id: "p3", reason: "postponed", at: "2026-10-10T09:00:00.000Z" },
    { type: "node.reopened", id: "base", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" },
    ...open("opt", { kind: "option", title: "An option" }),
    link("opt", "routing", "alternative_to"),
    ...open("src", { kind: "source", title: "A source" }),
    link("routing", "src", "supported_by"),
    ...open("billing", { title: "Billing" }),
  );
  const r1 = await ctx.werk("find", "routing");
  expect(r1.code).toBe(0);
  const o1 = lines(r1.stdout);
  expect(o1[0]).toContain("Routing");
  expect(o1[1]).toContain("Route guards");
  expect(r1.stdout).not.toContain("Billing");
  expect(r1.stdout).not.toContain("An option");
  expect(r1.stdout).not.toContain("A source");
  const r2 = await ctx.werk("find", "client");
  const o2 = lines(r2.stdout);
  const idx = (t: string) => o2.findIndex((l) => l.includes(t));
  expect(idx("Routing")).toBeGreaterThanOrEqual(0);
  expect(idx("Theme")).toBeGreaterThanOrEqual(0);
  expect(idx("Route guards")).toBeGreaterThan(idx("Routing"));
  expect(idx("Route guards")).toBeGreaterThan(idx("Theme"));
  expect(o2.some((l) => l.includes("Client"))).toBe(false);
  for (const t of ["Paused card", "Stale card", "Postponed card"]) expect(r2.stdout).not.toContain(t);
});

t("09.5 a reopened card shows as work in every tree", async (ctx) => {
  ctx.seed(
    ...open("t1", { title: "Tree one" }),
    ...open("t2", { title: "Tree two" }),
    ...decided("auth", { title: "Auth flow" }),
    { type: "node.reopened", id: "auth", reason: "rejected", at: "2026-10-10T09:00:00.000Z" },
  );
  const r = await ctx.werk("find");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Tree one");
  expect(r.stdout).toContain("Tree two");
  expect(r.stdout).toContain("Auth flow");
  expect(r.stdout).not.toContain("[decided]");
});

import { expect, setDefaultTimeout, test } from "bun:test";

setDefaultTimeout(120000);
import { createProject, decide, makeWerk, real } from "./support.ts";

async function withW<T>(body: (w: ReturnType<typeof makeWerk>, p: ReturnType<typeof createProject>) => Promise<T>) {
  const p = createProject();
  try {
    return await body(makeWerk(p), p);
  } finally {
    await p.dispose();
  }
}
const ids = (out: string) => out.split("\n").filter(Boolean).map((l) => l.split(/\s+/)[0]);

test("09.1 search with no term lists decided cards only", () =>
  withW(async (w) => {
    await real(w, "d1", "Decided one");
    await real(w, "d2", "Decided two");
    await real(w, "d3", "Decided three");
    for (const id of ["d1", "d2", "d3"]) await decide(w, id);
    await real(w, "open1", "Open card");
    // a ghost that was decided before it became a ghost
    expect((await w("add", "ghost1", "--title", "Ghost card")).code).toBe(0);
    await decide(w, "ghost1");
    const r = await w("search");
    expect(r.code).toBe(0);
    const lines = r.stdout.split("\n").filter(Boolean);
    expect(lines.length).toBe(3);
    expect(r.stdout).toContain("d1  Decided one");
    expect(r.stdout).toContain("d2  Decided two");
    expect(r.stdout).toContain("d3  Decided three");
    expect(r.stdout).not.toContain("open1");
    expect(r.stdout).not.toContain("ghost1");
  }));

test("09.2 two terms, best match first", () =>
  withW(async (w) => {
    await real(w, "layout", "Cache layout", { body: "Cache eviction and the eviction policy" });
    await decide(w, "layout");
    await real(w, "timer", "Eviction timer", { why: "eviction", body: "CACHE warmup" });
    await real(w, "size", "Cache size", { body: "cache" });
    await decide(w, "size");
    await real(w, "gone", "Gone", { body: "cache eviction" });
    expect((await w("remove", "gone")).code).toBe(0);
    const r = await w("search", "cache", "eviction");
    expect(r.code).toBe(0);
    const lines = r.stdout.split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("layout");
    expect(lines[0]).toContain("[decided]");
    expect(lines[0]).toContain("Cache layout");
    expect(lines[1]).toContain("timer");
    expect(lines[1]).toContain("[open]");
    expect(r.stdout).not.toContain("Cache size");
    expect(r.stdout).not.toContain("gone");
  }));

test("09.3 rejected option word, --under and --status", () =>
  withW(async (w) => {
    await real(w, "parent", "Parent topic");
    await decide(w, "parent");
    await real(w, "storage", "Storage format", { parent: "parent" });
    expect((await w("add", "storage:opt0", "--kind", "option", "--title", "SQLite", "--why", "SQLite needs a native build")).code).toBe(0);
    expect((await w("link", "storage:opt0", "storage", "--type", "alternative_to")).code).toBe(0);
    expect((await w("accept", "storage:opt0", "--actor", "you")).code).toBe(0);
    await decide(w, "storage");
    await real(w, "other", "Elsewhere", { body: "we say sqlite here" });
    const all = await w("search", "sqlite");
    expect(all.code).toBe(0);
    expect(all.stdout).toContain("storage  [decided]  Storage format");
    expect(all.stdout).toContain("other");
    const under = await w("search", "sqlite", "--under", "parent");
    expect(ids(under.stdout)).toEqual(["storage"]);
    const dec = await w("search", "sqlite", "--status", "decided");
    expect(ids(dec.stdout)).toEqual(["storage"]);
  }));

test("09.4 find the open work under one card", () =>
  withW(async (w) => {
    await real(w, "client", "Client");
    await decide(w, "client");
    await real(w, "routing", "Routing", { parent: "client" });
    await real(w, "theme", "Theme", { parent: "client", status: "proto" });
    await real(w, "guards", "Route guards", { parent: "routing" });
    await real(w, "paused", "Paused card", { parent: "client" });
    await real(w, "stale", "Stale card", { parent: "client" });
    await real(w, "postponed", "Postponed card", { parent: "client" });
    // marks: reopen a decided card; marks flow to dependents
    // postponed: reopen a decided card as postponed; a dependent is paused
    await real(w, "p0", "P0", { parent: "client" });
    expect((await w("add", "routing:opt", "--kind", "option", "--title", "Opt", "--why", "w")).code).toBe(0);
    expect((await w("link", "routing:opt", "routing", "--type", "alternative_to")).code).toBe(0);
    expect((await w("accept", "routing:opt", "--actor", "you")).code).toBe(0);
    expect((await w("add", "src", "--kind", "source", "--title", "Src")).code).toBe(0);
    expect((await w("link", "routing", "src", "--type", "supported_by", "--why", "w")).code).toBe(0);
    expect((await w("accept", "src", "--actor", "you")).code).toBe(0);
    await real(w, "billing", "Billing");
    // marks
    await decide(w, "p0");
    expect((await w("link", "paused", "p0", "--type", "depends_on", "--why", "w")).code).toBe(0);
    expect((await w("link", "stale", "p0", "--type", "depends_on", "--why", "w")).code).toBe(0);
    expect((await w("link", "postponed", "p0", "--type", "depends_on", "--why", "w")).code).toBe(0);
    expect((await w("reopen", "p0", "--reason", "postponed", "--why", "later")).code).toBe(0);
    const r1 = await w("find", "routing");
    expect(r1.code).toBe(0);
    expect(ids(r1.stdout).slice(0, 2)).toEqual(["routing", "guards"]);
    expect(r1.stdout).not.toContain("billing");
    expect(r1.stdout).not.toContain("routing:opt");
    expect(r1.stdout).not.toMatch(/\bsrc\b/);
    const r2 = await w("find", "client");
    const order = ids(r2.stdout);
    expect(order).not.toContain("client");
    expect(order.indexOf("routing")).toBeLessThan(order.indexOf("guards"));
    expect(order.indexOf("theme")).toBeLessThan(order.indexOf("guards"));
    expect(order).not.toContain("paused");
    expect(order).not.toContain("stale");
    expect(order).not.toContain("postponed");
  }));

test("09.5 a rejected reopen is work in every tree", () =>
  withW(async (w) => {
    await real(w, "t1", "Tree one");
    await real(w, "t2", "Tree two");
    await real(w, "auth", "Auth flow");
    await decide(w, "auth");
    expect((await w("reopen", "auth", "--reason", "rejected", "--why", "no")).code).toBe(0);
    const r = await w("find");
    expect(r.code).toBe(0);
    const got = ids(r.stdout);
    expect(got).toContain("t1");
    expect(got).toContain("t2");
    expect(got).toContain("auth");
    expect((await w("search")).stdout.trim()).toBe("");
  }));

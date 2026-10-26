import { expect, test } from "bun:test";
import { card, edge, freshProject, ghost, ok, seed } from "./lib.ts";

const rows = (out: string) => out.split("\n").filter((l) => l !== "");

test("09.1 search with no term lists decided cards only", async () => {
  const p = freshProject();
  seed(p, [
    card("a", "Alpha rule", "decided"),
    card("b", "Beta rule", "decided", "a"),
    card("c", "Gamma rule", "decided", "a"),
    card("o", "Open thing", "open", "a"),
    ghost("g", "Ghost thing", "decided", "a"),
  ]);
  const out = (await ok(p, ["search"])).out;
  const r = rows(out);
  expect(r).toHaveLength(3);
  expect(r).toContain("a  Alpha rule");
  expect(r).toContain("b  Beta rule");
  expect(r).toContain("c  Gamma rule");
  expect(out).not.toContain("Open thing");
  expect(out).not.toContain("Ghost thing");
});

test("09.2 search with two terms, best match first", async () => {
  const p = freshProject();
  seed(p, [
    card("root", "Root", "decided"),
    card("layout", "Cache layout", "decided", "root", { body: "Cache eviction\n\neviction policy" }),
    card("timer", "Eviction timer", "open", "root", { why: "eviction", body: "CACHE warmup" }),
    card("size", "Cache size", "decided", "root", { why: "cache" }),
    card("gone", "Cache gone", "open", "root", { body: "cache eviction" }),
  ]);
  seed(p, [["node.removed", { id: "gone" }]]);
  const r = rows((await ok(p, ["search", "cache", "eviction"])).out);
  expect(r).toHaveLength(2);
  expect(r[0]).toBe("layout  decided  Cache layout");
  expect(r[1]).toBe("timer  open  Eviction timer");
  const out = r.join("\n");
  expect(out).not.toContain("Cache size");
  expect(out).not.toContain("Cache gone");
});

test("09.3 search finds a card by a rejected option and narrows", async () => {
  const p = freshProject();
  seed(p, [
    card("root", "Root", "decided"),
    card("parent", "Parent topic", "decided", "root"),
    card("storage", "Storage format", "decided", "parent"),
    ["node.added", { id: "storage:opt0", kind: "option", title: "Database", why_not: "SQLite needs a native build" }],
    edge("storage:opt0", "storage", "alternative_to"),
    card("elsewhere", "Elsewhere", "open", "root", { body: "we may use sqlite" }),
  ]);
  const all = await ok(p, ["search", "sqlite"]);
  expect(all.out).toContain("storage  decided  Storage format");
  expect(all.out).toContain("elsewhere  open  Elsewhere");
  expect((await ok(p, ["search", "sqlite", "--under", "parent"])).out).toBe("storage  decided  Storage format\n");
  expect((await ok(p, ["search", "sqlite", "--status", "decided"])).out).toBe("storage  decided  Storage format\n");
});

test("09.4 find lists open work under one card", async () => {
  const p = freshProject();
  seed(p, [
    card("client", "Client", "decided"),
    card("routing", "Routing", "open", "client"),
    card("theme", "Theme", "proto", "client"),
    card("guards", "Route guards", "open", "routing"),
    card("billing", "Billing", "open"),
    card("baseX", "Base paused", "decided"),
    card("baseY", "Base stale", "decided"),
    card("paused", "Paused card", "decided", "client"),
    card("stale", "Stale card", "decided", "client"),
    card("postponed", "Postponed card", "decided", "client"),
    ["node.added", { id: "routing:opt0", kind: "option", title: "Other router", why_not: "Slow" }],
    edge("routing:opt0", "routing", "alternative_to"),
    ["node.added", { id: "survey", kind: "source", title: "Router survey" }],
    edge("routing", "survey", "supported_by"),
    edge("paused", "baseX", "depends_on", "needs x"),
    edge("stale", "baseY", "depends_on", "needs y"),
    ["node.reopened", { id: "baseX", reason: "postponed" }],
    ["node.reopened", { id: "baseY", reason: "invalidated" }],
    ["node.reopened", { id: "paused", reason: "invalidated" }],
    ["node.reopened", { id: "stale", reason: "invalidated" }],
    ["node.reopened", { id: "postponed", reason: "postponed" }],
  ]);
  const a = rows((await ok(p, ["find", "routing"])).out);
  expect(a).toHaveLength(2);
  expect(a[0]).toStartWith("routing  ");
  expect(a[1]).toStartWith("guards  ");
  const aj = a.join("\n");
  for (const bad of ["Billing", "Other router", "Router survey"]) expect(aj).not.toContain(bad);
  const b = rows((await ok(p, ["find", "client"])).out);
  const ids = b.map((l) => l.split("  ")[0]);
  expect(ids.indexOf("routing")).toBeGreaterThanOrEqual(0);
  expect(ids.indexOf("theme")).toBeGreaterThanOrEqual(0);
  expect(ids.indexOf("guards")).toBeGreaterThan(ids.indexOf("routing"));
  expect(ids.indexOf("guards")).toBeGreaterThan(ids.indexOf("theme"));
  expect(ids).not.toContain("client");
  expect(ids).not.toContain("paused");
  expect(ids).not.toContain("stale");
  expect(ids).not.toContain("postponed");
});

test("09.5 a card reopened as rejected comes back as work", async () => {
  const p = freshProject();
  seed(p, [
    card("ta", "Tree A", "open"),
    card("tb", "Tree B", "open"),
    card("auth", "Auth flow", "decided", "ta"),
    ["node.reopened", { id: "auth", reason: "rejected" }],
  ]);
  const out = (await ok(p, ["find"])).out;
  expect(out).toContain("ta  open  Tree A");
  expect(out).toContain("tb  open  Tree B");
  expect(out).toContain("auth  open  Auth flow");
  expect(out).not.toContain("decided");
});

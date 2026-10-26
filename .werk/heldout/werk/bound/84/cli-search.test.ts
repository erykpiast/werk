import { expect, test } from "bun:test";
import { card, fresh, ok, seed } from "./cli-helpers.ts";

test("09.1 index lists decided cards only", async () => {
  const p = fresh([
    card("a", "Alpha", { parent: "root", status: "decided" }),
    card("b", "Beta", { parent: "root", status: "decided" }),
    card("c", "Gamma", { parent: "root", status: "decided" }),
    card("o", "Open one", { parent: "root" }),
    { type: "node.proposed", actor: "agent", payload: { id: "g", kind: "card", title: "Ghostly", status: "decided", parent: "root" } },
  ]);
  const out = (await ok(p, ["search"])).out;
  const lines = out.split("\n").filter(Boolean);
  // root is decided? root added with default status
  expect(out).toContain("a  Alpha");
  expect(out).toContain("b  Beta");
  expect(out).toContain("c  Gamma");
  expect(out).not.toContain("Open one");
  expect(out).not.toContain("Ghostly");
  expect(lines.filter((l) => !l.startsWith("root")).length).toBe(3);
});

test("09.2 two terms, best first", async () => {
  const p = fresh([
    card("layout", "Cache layout", { parent: "root", status: "decided", body: "Cache eviction and eviction policy" }),
    card("timer", "Eviction timer", { parent: "root", why: "eviction", body: "CACHE warmup" }),
    card("size", "Cache size", { parent: "root", status: "decided" }),
    card("gone", "Gone", { parent: "root", body: "cache eviction" }),
    { type: "node.removed", payload: { id: "gone" } },
  ]);
  const out = (await ok(p, ["search", "cache", "eviction"])).out;
  const lines = out.split("\n").filter(Boolean);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/^layout\s+decided\s+Cache layout/);
  expect(lines[1]).toMatch(/^timer\s+open\s+Eviction timer/);
  expect(out).not.toContain("Cache size");
  expect(out).not.toContain("Gone");
});

test("09.3 rejected option word, --under, --status", async () => {
  const p = fresh([
    card("parent", "Parent topic", { parent: "root", status: "decided" }),
    card("storage", "Storage format", { parent: "parent", status: "decided" }),
    { type: "node.added", payload: { id: "storage:opt0", kind: "option", title: "Embedded db", why_not: "SQLite needs a native build" } },
    { type: "edge.added", payload: { from: "storage:opt0", to: "storage", type: "alternative_to" } },
    card("other", "Other work", { parent: "root", body: "sqlite" }),
  ]);
  const all = (await ok(p, ["search", "sqlite"])).out;
  expect(all).toMatch(/storage\s+decided\s+Storage format/);
  expect(all).toMatch(/other\s+open\s+Other work/);
  const under = (await ok(p, ["search", "sqlite", "--under", "parent"])).out;
  expect(under.split("\n").filter(Boolean)).toHaveLength(1);
  expect(under).toContain("Storage format");
  const st = (await ok(p, ["search", "sqlite", "--status", "decided"])).out;
  expect(st.split("\n").filter(Boolean)).toHaveLength(1);
  expect(st).toContain("Storage format");
});

function clientMap() {
  return fresh([
    card("client", "Client", { parent: "root", status: "decided" }),
    card("routing", "Routing", { parent: "client" }),
    card("theme", "Theme", { parent: "client", status: "proto" }),
    card("guards", "Route guards", { parent: "routing" }),
    card("paused", "Paused card", { parent: "client" }),
    card("stale", "Stale card", { parent: "client" }),
    card("post", "Postponed card", { parent: "client" }),
    card("billing", "Billing", { parent: "root" }),
    { type: "node.added", payload: { id: "routing:opt0", kind: "option", title: "Opt", why_not: "no" } },
    { type: "edge.added", payload: { from: "routing:opt0", to: "routing", type: "alternative_to" } },
    { type: "node.added", payload: { id: "src1", kind: "source", title: "Src1" } },
    { type: "edge.added", payload: { from: "routing", to: "src1", type: "supported_by" } },
  ]);
}

test("09.4 find under a card", async () => {
  const p = clientMap();
  // paused, stale, postponed via dependencies
  seed(p, [
    card("pa", "PA", { parent: "root", status: "decided" }),
    card("pb", "PB", { parent: "root", status: "decided" }),
    card("pc", "PC", { parent: "root", status: "decided" }),
    { type: "edge.added", payload: { from: "paused", to: "pa", type: "depends_on", why: "w" } },
    { type: "edge.added", payload: { from: "stale", to: "pb", type: "depends_on", why: "w" } },
    { type: "edge.added", payload: { from: "post", to: "pc", type: "depends_on", why: "w" } },
    { type: "node.reopened", payload: { id: "pa", reason: "postponed" } },
    { type: "node.reopened", payload: { id: "pb", reason: "rejected" } },
    { type: "node.reopened", payload: { id: "pc", reason: "postponed" } },
  ]);
  const r = (await ok(p, ["find", "routing"])).out;
  expect(r.indexOf("routing")).toBeLessThan(r.indexOf("guards"));
  expect(r).not.toContain("Billing");
  expect(r).not.toContain("opt0");
  expect(r).not.toContain("src1");
  expect(r).not.toContain("Opt");
  const c = (await ok(p, ["find", "client"])).out;
  expect(c.indexOf("Routing")).toBeLessThan(c.indexOf("Route guards"));
  expect(c.indexOf("Theme")).toBeLessThan(c.indexOf("Route guards"));
  expect(c).not.toMatch(/^client\s/m);
  expect(c).not.toContain("Paused card");
  expect(c).not.toContain("Stale card");
  expect(c).not.toContain("Postponed card");
});

test("09.5 find with no id includes rejected reopen", async () => {
  const p = fresh([
    card("t1", "Tree one", { parent: "root" }),
    card("auth", "Auth flow", { parent: "root", status: "decided" }),
    { type: "node.reopened", payload: { id: "auth", reason: "rejected" } },
    card("dec", "Decided card", { parent: "root", status: "decided" }),
  ]);
  const out = (await ok(p, ["find"])).out;
  expect(out).toContain("Tree one");
  expect(out).toContain("Auth flow");
  expect(out).not.toContain("Decided card");
});

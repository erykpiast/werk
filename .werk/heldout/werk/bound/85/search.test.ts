import { expect, test } from "bun:test";
import { freshProject, type Project } from "../src/test/project.ts";
import { card, decided, edge, kill, lines, ok, root, seed, w } from "./h.ts";

const base = () => {
  const p = freshProject();
  seed(p, [...root()]);
  return p;
};
const out = async (p: Project, args: string[]) => (await ok(p, args)).out;
const ls = (s: string) => s.split("\n").filter((l) => l.trim() !== "");

test("09.1", async () => {
  const p = freshProject();
  seed(p, [
    { type: "node.added", payload: { id: "root", kind: "card", title: "Root", status: "open" } },
    decided("d1", { title: "Dee one" }), decided("d2", { title: "Dee two" }), decided("d3", { title: "Dee three" }),
    card("o1", { title: "Open one" }),
    { type: "node.proposed", actor: "agent", payload: { id: "g1", kind: "card", title: "Ghost one", parent: "root", status: "decided" } },
  ]);
  const s = await out(p, ["search"]);
  console.log("09.1 out:", JSON.stringify(s));
  for (const id of ["d1", "d2", "d3"]) expect(s).toContain(id);
  expect(s).toContain("Dee one");
  expect(s).not.toContain("o1");
  expect(s).not.toContain("g1");
  expect(s).not.toContain("Ghost");
  // "one line for each of the three decided cards": the root is decided too, so the root is listed
  expect(ls(s).length).toBe(3);
});

test("09.2", async () => {
  const p = base();
  seed(p, [
    decided("cache-layout", { title: "Cache layout", body: "Cache eviction and the eviction policy" }),
    card("evict-timer", { title: "Eviction timer", why: "eviction", body: "CACHE warmup" }),
    decided("cache-size", { title: "Cache size", body: "sizes" }),
    decided("gone", { title: "cache eviction gone" }),
  ]);
  await ok(p, ["remove", "gone", "--actor", "you"]);
  const s = await out(p, ["search", "cache", "eviction"]);
  console.log("09.2 out:", JSON.stringify(s));
  const l = ls(s);
  expect(l.length).toBe(2);
  expect(l[0]).toContain("cache-layout");
  expect(l[0]).toContain("decided");
  expect(l[0]).toContain("Cache layout");
  expect(l[1]).toContain("evict-timer");
  expect(l[1]).toContain("open");
  expect(s).not.toContain("cache-size");
  expect(s).not.toContain("gone");
});

test("09.3", async () => {
  const p = base();
  seed(p, [
    decided("parent-topic", { title: "Parent topic" }),
    decided("storage-format", { title: "Storage format", parent: "parent-topic" }),
    { type: "node.added", payload: { id: "opt", kind: "option", title: "Use X", why_not: "SQLite needs a native build" } },
    { type: "edge.added", payload: { from: "opt", to: "storage-format", type: "alternative_to" } },
    card("elsewhere", { title: "Elsewhere", body: "we talk of sqlite" }),
  ]);
  let s = await out(p, ["search", "sqlite"]);
  expect(s).toContain("storage-format");
  expect(s).toContain("decided");
  expect(s).toContain("elsewhere");
  s = await out(p, ["search", "sqlite", "--under", "parent-topic"]);
  expect(s).toContain("storage-format");
  expect(s).not.toContain("elsewhere");
  s = await out(p, ["search", "sqlite", "--status", "decided"]);
  expect(s).toContain("storage-format");
  expect(s).not.toContain("elsewhere");
});

function tree() {
  const p = base();
  seed(p, [
    decided("client", { title: "Client" }),
    card("routing", { title: "Routing", parent: "client" }),
    card("theme", { title: "Theme", parent: "client", status: "proto" }),
    card("guards", { title: "Route guards", parent: "routing" }),
    decided("post"), decided("rej"),
    card("paused", { title: "Paused card", parent: "client" }), edge("paused", "post"),
    card("stale", { title: "Stale card", parent: "client" }), edge("stale", "rej"),
    decided("pp", { parent: "client", title: "Postponed card" }),
    { type: "node.added", payload: { id: "opt", kind: "option", title: "Opt", why_not: "no" } },
    { type: "edge.added", payload: { from: "opt", to: "routing", type: "alternative_to" } },
    { type: "node.added", payload: { id: "src", kind: "source", title: "Src" } },
    { type: "edge.added", payload: { from: "routing", to: "src", type: "supported_by" } },
    decided("bparent"), card("billing", { title: "Billing", parent: "bparent" }),
  ]);
  return p;
}

test("09.4", async () => {
  const p = tree();
  await ok(p, ["reopen", "post", "--reason", "postponed"]);
  await ok(p, ["reopen", "rej", "--reason", "rejected"]);
  await ok(p, ["reopen", "pp", "--reason", "postponed"]);
  let s = await out(p, ["find", "routing"]);
  console.log("09.4 find routing:", JSON.stringify(s));
  expect(s.indexOf("routing")).toBeGreaterThanOrEqual(0);
  expect(s.indexOf("guards")).toBeGreaterThan(s.indexOf("routing"));
  for (const x of ["billing", "opt", "src"]) expect(s).not.toMatch(new RegExp(`\\b${x}\\b`));
  s = await out(p, ["find", "client"]);
  console.log("09.4 find client:", JSON.stringify(s));
  expect(s.indexOf("guards")).toBeGreaterThan(s.indexOf("routing"));
  expect(s.indexOf("guards")).toBeGreaterThan(s.indexOf("theme"));
  expect(s).not.toMatch(/\bclient\b/);
  for (const x of ["paused", "stale", "pp"]) expect(s).not.toMatch(new RegExp(`\\b${x}\\b`));
});

test("09.5", async () => {
  const p = base();
  seed(p, [
    decided("t1"), decided("t2"), card("o1", { parent: "t1", title: "Open A" }), card("o2", { parent: "t2", title: "Open B" }),
    decided("auth-flow", { title: "Auth flow" }),
  ]);
  await ok(p, ["reopen", "auth-flow", "--reason", "rejected"]);
  const s = await out(p, ["find"]);
  console.log("09.5:", JSON.stringify(s));
  expect(s).toContain("o1");
  expect(s).toContain("o2");
  expect(s).toContain("auth-flow");
  for (const x of ["t1", "t2"]) expect(s).not.toMatch(new RegExp(`\\b${x}\\b`));
});

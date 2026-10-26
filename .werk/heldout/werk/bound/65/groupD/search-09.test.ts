import { expect, test } from "bun:test";
import { card, link, ok, reopen, withMap } from "./helpers.ts";

const D = { status: "decided" };
const O = { status: "open" };

test("09.1 search with no term lists decided cards only", async () => {
  const p = withMap([
    card("root", "Root", undefined, D),
    card("d1", "First decided", "root", D),
    card("d2", "Second decided", "root", D),
    card("o1", "Open one", "root", O),
    ["node.proposed", { id: "g1", kind: "card", title: "Ghost one", parent: "root", status: "decided" }, "agent"],
  ]);
  const out = (await ok(p, ["search"])).out;
  const rows = out.split("\n").filter(Boolean);
  // root is also decided in this map; the three named decided cards are root, d1, d2.
  expect(rows).toEqual(["root  Root", "d1  First decided", "d2  Second decided"]);
  expect(out).not.toContain("o1");
  expect(out).not.toContain("g1");
});

test("09.2 two terms, best match first", async () => {
  const p = withMap([
    card("root", "Root", undefined, O),
    card("layout", "Cache layout", "root", {
      status: "decided",
      body: "Cache eviction runs hourly. The eviction policy is LRU.",
    }),
    card("timer", "Eviction timer", "root", {
      status: "open",
      why: "The eviction runs on a timer.",
      body: "CACHE warmup first.",
    }),
    card("size", "Cache size", "root", { status: "decided", body: "The cache holds 1 GB." }),
    card("gone", "Gone card", "root", { status: "decided", body: "cache eviction once" }),
  ]);
  await ok(p, ["remove", "gone", "--actor", "you"]);
  const rows = (await ok(p, ["search", "cache", "eviction"])).out.split("\n").filter(Boolean);
  expect(rows).toEqual(["layout  decided  Cache layout", "timer  open  Eviction timer"]);
});

test("09.3 a word in a rejected option, narrowed by --under and --status", async () => {
  const p = withMap([
    card("root", "Root", undefined, O),
    card("parent", "Parent topic", "root", D),
    card("storage", "Storage format", "parent", D),
    [
      "node.added",
      { id: "storage:opt0", kind: "option", title: "A database file", why_not: "SQLite needs a native build" },
    ],
    link("storage:opt0", "storage", "alternative_to"),
    card("other", "Other work", "root", { status: "open", body: "Maybe sqlite later" }),
  ]);
  const all = (await ok(p, ["search", "sqlite"])).out;
  expect(all).toContain("storage  decided  Storage format");
  expect(all).toContain("other  open  Other work");
  expect((await ok(p, ["search", "sqlite", "--under", "parent"])).out).toBe("storage  decided  Storage format\n");
  expect((await ok(p, ["search", "sqlite", "--status", "decided"])).out).toBe("storage  decided  Storage format\n");
});

test("09.4 find the open work under one card", async () => {
  const p = withMap([
    card("root", "Root", undefined, D),
    card("client", "Client", "root", D),
    card("routing", "Routing", "client", O),
    card("theme", "Theme", "client", { status: "proto" }),
    card("guards", "Route guards", "routing", O),
    card("basis-p", "Postponed basis", "root", D),
    card("basis-r", "Rejected basis", "root", D),
    card("paused", "Paused card", "client", O),
    link("paused", "basis-p", "depends_on", "needs it"),
    card("stale", "Stale card", "client", O),
    link("stale", "basis-r", "depends_on", "needs it"),
    card("postponed", "Postponed card", "client", D),
    ["node.added", { id: "routing:opt0", kind: "option", title: "Hash routing", why_not: "Ugly" }],
    link("routing:opt0", "routing", "alternative_to"),
    ["node.added", { id: "router-src", kind: "source", title: "Router docs" }],
    link("routing", "router-src", "supported_by"),
    card("billing", "Billing", "root", O),
    reopen("basis-p", "postponed"),
    reopen("basis-r", "rejected"),
    reopen("postponed", "postponed"),
  ]);
  const r = (await ok(p, ["find", "routing"])).out.split("\n").filter(Boolean);
  expect(r[0]).toContain("routing");
  expect(r[0]).toContain("Routing");
  expect(r.findIndex((l) => l.startsWith("guards"))).toBeGreaterThan(0);
  const rt = r.join("\n");
  for (const s of ["billing", "routing:opt0", "router-src", "Hash routing", "Router docs"]) expect(rt).not.toContain(s);
  const c = (await ok(p, ["find", "client"])).out.split("\n").filter(Boolean);
  const at = (id: string) => c.findIndex((l) => l.startsWith(`${id} `));
  expect(at("routing")).toBeGreaterThanOrEqual(0);
  expect(at("theme")).toBeGreaterThanOrEqual(0);
  expect(at("guards")).toBeGreaterThan(at("routing"));
  expect(at("guards")).toBeGreaterThan(at("theme"));
  for (const id of ["client", "paused", "stale", "postponed"]) expect(at(id)).toBe(-1);
});

test("09.5 a card reopened as rejected comes back as work", async () => {
  const p = withMap([
    card("root", "Root", undefined, D),
    card("tree-a", "Tree A", "root", D),
    card("tree-b", "Tree B", "root", D),
    card("open-a", "Open A", "tree-a", O),
    card("open-b", "Open B", "tree-b", O),
    card("auth-flow", "Auth flow", "tree-a", D),
    reopen("auth-flow", "rejected"),
  ]);
  const out = (await ok(p, ["find"])).out;
  expect(out).toContain("open-a");
  expect(out).toContain("open-b");
  expect(out).toContain("Auth flow");
  expect(out).not.toContain("decided");
  for (const id of ["root ", "tree-a ", "tree-b "]) expect(out.split("\n").some((l) => l.startsWith(id))).toBe(false);
});

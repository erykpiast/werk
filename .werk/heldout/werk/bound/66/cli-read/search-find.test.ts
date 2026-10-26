import { expect, test } from "bun:test";
import { card, edge, ids, ok, project, seed } from "./helpers.ts";

test("09.1 search with no term lists the decided cards only", async () => {
  const p = project();
  seed(p, [
    card("root", "Root"),
    card("d1", "First decided", { status: "decided", parent: "root" }),
    card("d2", "Second decided", { status: "decided", parent: "root" }),
    card("d3", "Third decided", { status: "decided", parent: "root" }),
    card("o1", "Open one", { parent: "root" }),
    {
      type: "node.proposed",
      actor: "agent",
      payload: { id: "g1", kind: "card", title: "Ghost decided", status: "decided", parent: "root" },
    },
  ]);
  // The ghost was decided before it became a ghost: check the map shows it as a decided ghost.
  const g = await ok(p, ["show", "g1"]);
  expect(g.out).toStartWith("card g1  [decided]  proposed");
  const run = await ok(p, ["search"]);
  const out = run.out.split("\n").filter(Boolean);
  expect(out).toContain("d1  First decided");
  expect(out).toContain("d2  Second decided");
  expect(out).toContain("d3  Third decided");
  expect(out).toHaveLength(3);
  expect(run.out).not.toContain("o1");
  expect(run.out).not.toContain("g1");
});

test("09.2 search with two terms ranks by hits and drops non-matching and removed cards", async () => {
  const p = project();
  seed(p, [
    card("root", "Root"),
    card("layout", "Cache layout", {
      status: "decided",
      parent: "root",
      body: "Cache eviction runs on writes. The eviction policy is LRU.",
    }),
    card("timer", "Eviction timer", { parent: "root", why: "eviction runs hourly", body: "CACHE warmup comes first." }),
    card("size", "Cache size", { status: "decided", parent: "root", body: "The cache holds 1 GB." }),
    card("gone", "Gone card", { status: "decided", parent: "root", body: "cache eviction was here" }),
    { type: "node.removed", payload: { id: "gone" } },
  ]);
  expect((await ok(p, ["removed"])).out).toContain("gone");
  const run = await ok(p, ["search", "cache", "eviction"]);
  const out = run.out.split("\n").filter(Boolean);
  expect(out).toEqual(["layout  decided  Cache layout", "timer  open  Eviction timer"]);
});

test("09.3 search finds a word in an option's why-not and narrows by --under and --status", async () => {
  const p = project();
  seed(p, [
    card("root", "Root"),
    card("topic", "Parent topic", { status: "decided", parent: "root" }),
    card("storage", "Storage format", { status: "decided", parent: "topic", body: "Logs are JSON lines." }),
    {
      type: "node.added",
      payload: {
        id: "storage:opt0",
        kind: "option",
        title: "Embedded database",
        why_not: "SQLite needs a native build",
      },
    },
    edge("storage:opt0", "storage", "alternative_to"),
    card("other", "Other idea", { parent: "root", body: "We could try sqlite later." }),
  ]);
  const all = await ok(p, ["search", "sqlite"]);
  expect(all.out).toContain("storage  decided  Storage format");
  expect(ids(all.out)).toContain("other");
  const under = await ok(p, ["search", "sqlite", "--under", "topic"]);
  expect(ids(under.out)).toEqual(["storage"]);
  const decided = await ok(p, ["search", "sqlite", "--status", "decided"]);
  expect(ids(decided.out)).toEqual(["storage"]);
});

async function clientMap() {
  const p = project();
  seed(p, [
    card("root", "Root", { status: "decided" }),
    card("client", "Client", { status: "decided", parent: "root" }),
    card("routing", "Routing", { parent: "client" }),
    card("theme", "Theme", { status: "proto", parent: "client" }),
    card("guards", "Route guards", { parent: "routing" }),
    card("basis-p", "Basis to postpone", { status: "decided", parent: "root" }),
    card("basis-r", "Basis to reject", { status: "decided", parent: "root" }),
    card("pausedc", "Paused card", { parent: "client" }),
    edge("pausedc", "basis-p", "depends_on", "takes the basis"),
    card("stalec", "Stale card", { parent: "client" }),
    edge("stalec", "basis-r", "depends_on", "takes the basis"),
    card("postc", "Postponed card", { status: "decided", parent: "client" }),
    {
      type: "node.added",
      payload: { id: "routing:opt0", kind: "option", title: "Hash routing", why_not: "ugly urls" },
    },
    edge("routing:opt0", "routing", "alternative_to"),
    { type: "node.added", payload: { id: "src-router", kind: "source", title: "Router docs", finding: "works" } },
    edge("routing", "src-router", "supported_by"),
    card("billing", "Billing", { parent: "root" }),
  ]);
  await ok(p, ["reopen", "basis-p", "--reason", "postponed", "--why", "later"]);
  await ok(p, ["reopen", "basis-r", "--reason", "rejected", "--why", "wrong"]);
  await ok(p, ["reopen", "postc", "--reason", "postponed", "--why", "later"]);
  return p;
}

test("09.4 find lists the open work under one card, breadth first, without paused, stale or postponed cards", async () => {
  const p = await clientMap();
  const stale = await ok(p, ["stale"]);
  expect(stale.out).toContain("pausedc");
  expect(stale.out).toContain("stalec");
  const routing = ids((await ok(p, ["find", "routing"])).out);
  expect(routing[0]).toBe("routing");
  expect(routing).toContain("guards");
  expect(routing.indexOf("guards")).toBeGreaterThan(0);
  for (const id of ["billing", "routing:opt0", "src-router"]) expect(routing).not.toContain(id);
  const client = ids((await ok(p, ["find", "client"])).out);
  expect(client).toContain("routing");
  expect(client).toContain("theme");
  expect(client).toContain("guards");
  expect(client.indexOf("routing")).toBeLessThan(client.indexOf("guards"));
  expect(client.indexOf("theme")).toBeLessThan(client.indexOf("guards"));
  for (const id of ["client", "pausedc", "stalec", "postc"]) expect(client).not.toContain(id);
});

test("09.5 a card reopened as rejected comes back in find over the whole map", async () => {
  const p = project();
  seed(p, [
    card("root", "Root", { status: "decided" }),
    card("t1", "Tree one", { status: "decided", parent: "root" }),
    card("o1", "Open in tree one", { parent: "t1" }),
    card("t2", "Tree two", { status: "decided", parent: "root" }),
    card("o2", "Open in tree two", { parent: "t2" }),
    card("auth", "Auth flow", { status: "decided", parent: "t1" }),
  ]);
  await ok(p, ["reopen", "auth", "--reason", "rejected", "--why", "wrong flow"]);
  const found = ids((await ok(p, ["find"])).out);
  expect(found).toContain("o1");
  expect(found).toContain("o2");
  expect(found).toContain("auth");
  for (const id of ["root", "t1", "t2"]) expect(found).not.toContain(id);
});

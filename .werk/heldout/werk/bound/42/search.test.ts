import { expect, test } from "bun:test";
import { mk } from "./h.ts";

const lines = (s: string) => s.split("\n").filter(Boolean);

test("[09.1] index of decided cards", async () => {
  const h = mk();
  h.real("d1", "Decided one");
  h.real("d2", "Decided two");
  h.real("d3", "Decided three");
  h.real("o1", "Open one");
  h.decide("d1");
  h.decide("d2");
  h.decide("d3");
  await h.w("add", "g1", "--title", "Ghost decided");
  const dg = await h.w("status", "g1", "decided");
  console.log("ghost decide:", dg.out + dg.err);
  if (dg.code !== 0) {
    // give the ghost what the contract needs
    await h.w("edit", "g1", "--who", "you");
    await h.w("link", "g1", "d1", "--type", "depends_on", "--why", "b");
    await h.w("add", "go", "--kind", "option", "--title", "Ghost opt", "--why_not", "x");
    await h.w("link", "go", "g1", "--type", "alternative_to");
    await h.w("kill", "g1", "--revisit");
    const again = await h.w("status", "g1", "decided");
    console.log("ghost decide again:", again.out + again.err);
    expect(again.code).toBe(0);
  }
  const r = await h.w("search");
  expect(r.code).toBe(0);
  const ls = lines(r.out);
  console.log("index:", r.out);
  expect(ls.length).toBe(3);
  expect(r.out).toContain("d1  Decided one");
  expect(r.out).not.toContain("Open one");
  expect(r.out).not.toContain("Ghost decided");
  expect(r.out).not.toContain("g1");
});

test("[09.2] two terms, best match first", async () => {
  const h = mk();
  h.real("cl", "Cache layout", undefined, { why: "x", body: "Cache eviction and the eviction policy" });
  h.real("et", "Eviction timer", undefined, { why: "eviction", body: "CACHE warmup" });
  h.real("cs", "Cache size", undefined, { why: "x", body: "cache is sized" });
  h.real("gone", "Gone one", undefined, { why: "x", body: "cache eviction" });
  h.decide("cl");
  h.decide("cs");
  h.decide("gone");
  await h.w("remove", "gone", "--actor", "you");
  const r = await h.w("search", "cache", "eviction");
  console.log("search:", r.out);
  const ls = lines(r.out);
  expect(ls.length).toBe(2);
  expect(ls[0]).toMatch(/^cl\s+decided\s+Cache layout$/);
  expect(ls[1]).toMatch(/^et\s+open\s+Eviction timer$/);
  expect(r.out).not.toContain("Cache size");
  expect(r.out).not.toContain("Gone one");
});

test("[09.3] word in a rejected option; narrowing", async () => {
  const h = mk();
  h.real("parent", "Parent topic", undefined, { why: "x" });
  h.real("sf", "Storage format", "parent", { why: "x" });
  h.seed("node.added", { id: "opt", kind: "option", title: "Use SQLite store", why_not: "SQLite needs a native build" });
  h.edge("opt", "sf", "alternative_to");
  h.real("elsewhere", "Open elsewhere", undefined, { why: "x", body: "we could use sqlite here" });
  h.decide("parent");
  h.decide("sf");
  // the option title says "SQLite", but search reads only card words and why-nots
  const r = await h.w("search", "sqlite");
  console.log("sqlite:", r.out);
  expect(r.out).toMatch(/^sf\s+decided\s+Storage format$/m);
  expect(r.out).toMatch(/^elsewhere\s+open\s+Open elsewhere$/m);
  const u = await h.w("search", "sqlite", "--under", "parent");
  expect(lines(u.out)).toEqual(["sf  decided  Storage format"]);
  const s = await h.w("search", "sqlite", "--status", "decided");
  expect(lines(s.out)).toEqual(["sf  decided  Storage format"]);
});

test("[09.4] find the open work under one card", async () => {
  const h = mk();
  h.real("client", "Client", undefined, { why: "x" });
  h.real("routing", "Routing", "client", { why: "x" });
  h.real("theme", "Theme", "client", { why: "x", status: "proto" });
  h.real("guards", "Route guards", "routing", { why: "x" });
  h.real("pausedc", "Paused card", "client", { why: "x" });
  h.real("stalec", "Stale card", "client", { why: "x" });
  h.real("postc", "Postponed card", "client", { why: "x" });
  h.real("pb", "Paused basis", undefined, { why: "x" });
  h.real("sb", "Stale basis", undefined, { why: "x" });
  h.seed("node.added", { id: "o1", kind: "option", title: "Opt", why_not: "x" });
  h.edge("o1", "routing", "alternative_to");
  h.seed("node.added", { id: "s1", kind: "source", title: "Src" });
  h.edge("routing", "s1", "supported_by");
  h.real("billing", "Billing", undefined, { why: "x" });
  h.decide("pb");
  h.decide("sb");
  h.decide("postc");
  h.decide("client");
  h.edge("pausedc", "pb", "depends_on", "p");
  h.edge("stalec", "sb", "depends_on", "s");
  await h.w("reopen", "pb", "--reason", "postponed", "--why", "later");
  await h.w("reopen", "sb", "--reason", "rejected", "--why", "wrong");
  await h.w("reopen", "postc", "--reason", "postponed", "--why", "later");
  const r = await h.w("find", "routing");
  console.log("find routing:", r.out);
  const ids = lines(r.out).map((l) => l.split(/\s+/)[0]);
  expect(ids[0]).toBe("routing");
  expect(ids[1]).toBe("guards");
  expect(r.out).not.toContain("Billing");
  expect(r.out).not.toMatch(/\bo1\b|\bs1\b/);
  const c = await h.w("find", "client");
  console.log("find client:", c.out);
  const cids = lines(c.out).map((l) => l.split(/\s+/)[0]);
  expect(cids).toContain("routing");
  expect(cids).toContain("theme");
  expect(cids.indexOf("guards")).toBeGreaterThan(cids.indexOf("routing"));
  expect(cids.indexOf("guards")).toBeGreaterThan(cids.indexOf("theme"));
  expect(cids).not.toContain("client");
  for (const x of ["pausedc", "stalec", "postc"]) expect(cids).not.toContain(x);
});

test("[09.5] a card reopened as rejected comes back as work", async () => {
  const h = mk();
  h.real("t1", "Tree one", undefined, { why: "x" });
  h.real("t2", "Tree two", undefined, { why: "x" });
  h.real("auth", "Auth flow", "t1", { why: "x" });
  h.decide("auth");
  await h.w("reopen", "auth", "--reason", "rejected", "--why", "wrong");
  const r = await h.w("find");
  console.log("find all:", r.out);
  const ids = lines(r.out).map((l) => l.split(/\s+/)[0]);
  expect(ids).toContain("t1");
  expect(ids).toContain("t2");
  expect(ids).toContain("auth");
  expect(r.out).not.toMatch(/\sdecided\s/);
});

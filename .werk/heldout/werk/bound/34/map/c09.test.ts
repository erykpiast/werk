import { expect, test } from "bun:test";
import { decidedCard, harness, link, proposed, real, writeLog, YOU } from "./util.ts";

const { project, werk } = harness();
const SLOW = 60_000;
const lines = (s: string) => s.split("\n").filter((l) => l !== "");
const reopen = (id: string, reason: string) => ({
  type: "node.reopened", id, reason, at: new Date().toISOString(),
});

test("09.1 search with no term lists the decided cards", async () => {
  writeLog(project(),
    decidedCard("one"), decidedCard("two"), decidedCard("three"),
    real("openc"),
    proposed("ghostc"), { type: "node.edited", id: "ghostc", who: "me", noBasis: "t" },
    { type: "criterion.added", id: "ghostc", form: "revisit" }, { type: "node.decided", id: "ghostc" });
  const out = lines((await werk("search")).stdout);
  expect(out).toHaveLength(3);
  for (const id of ["one", "two", "three"]) expect(out.join("\n")).toContain(`${id}  Title ${id}`);
  const all = out.join("\n");
  expect(all).not.toContain("openc");
  expect(all).not.toContain("ghostc");
}, SLOW);

test("09.2 two terms, best match first", async () => {
  writeLog(project(),
    decidedCard("cache-layout", { title: "Cache layout", body: "Cache eviction and the eviction policy" }),
    real("timer", { title: "Eviction timer", why: "eviction", body: "CACHE warmup" }),
    decidedCard("cache-size", { title: "Cache size", body: "cache only" }),
    decidedCard("gone", { title: "Gone", body: "cache eviction" }));
  expect((await werk("remove", "gone", ...YOU)).code).toBe(0);
  const out = lines((await werk("search", "cache", "eviction")).stdout);
  expect(out).toHaveLength(2);
  expect(out[0]).toContain("cache-layout");
  expect(out[0]).toContain("[decided]");
  expect(out[0]).toContain("Cache layout");
  expect(out[1]).toContain("timer");
  expect(out[1]).toContain("[open]");
  expect(out.join("\n")).not.toContain("Cache size");
  expect(out.join("\n")).not.toContain("gone");
}, SLOW);

test("09.3 a word in a rejected option, narrowed by --under and --status", async () => {
  writeLog(project(),
    decidedCard("parent-topic", { title: "Parent topic" }),
    decidedCard("storage", { title: "Storage format", parent: "parent-topic" }),
    real("opt", { kind: "option", title: "Use SQLite", why: "SQLite needs a native build" }),
    link("opt", "storage", "alternative_to"),
    real("outside", { title: "Outside card", body: "mentions sqlite here" }));
  const all = (await werk("search", "sqlite")).stdout;
  expect(all).toMatch(/storage\s+\[decided\]/);
  expect(all).toContain("outside");
  const under = lines((await werk("search", "sqlite", "--under", "parent-topic")).stdout);
  expect(under).toHaveLength(1);
  expect(under[0]).toContain("storage");
  const dec = lines((await werk("search", "sqlite", "--status", "decided")).stdout);
  expect(dec).toHaveLength(1);
  expect(dec[0]).toContain("storage");
}, SLOW);

test("09.4 find lists open work under one card", async () => {
  writeLog(project(),
    decidedCard("client", { title: "Client" }),
    real("routing", { parent: "client", title: "Routing" }),
    real("theme", { parent: "client", title: "Theme", status: "proto" }),
    real("guards", { parent: "routing", title: "Route guards" }),
    decidedCard("pp", { parent: "client", title: "Postponed card" }),
    real("paused", { parent: "client", title: "Paused card" }), link("paused", "pp"),
    decidedCard("dd"),
    decidedCard("stale", { parent: "client", title: "Stale card" }), link("stale", "dd"),
    reopen("pp", "postponed"), reopen("dd", "invalidated"), reopen("stale", "invalidated"),
    real("opt", { kind: "option", title: "Routing option", why: "no" }), link("opt", "routing", "alternative_to"),
    real("src", { kind: "source", title: "Routing source", why: "f" }), link("routing", "src", "supported_by"),
    real("billing", { title: "Billing" }));
  const routing = (await werk("find", "routing")).stdout;
  const r = lines(routing);
  expect(r[0]).toContain("Routing");
  expect(r[1]).toContain("Route guards");
  for (const w of ["Billing", "Routing option", "Routing source"]) expect(routing).not.toContain(w);
  const client = (await werk("find", "client")).stdout;
  const c = lines(client);
  const idx = (t: string) => c.findIndex((l) => l.endsWith(t));
  expect(idx("Routing")).toBeGreaterThanOrEqual(0);
  expect(idx("Theme")).toBeGreaterThanOrEqual(0);
  expect(idx("Route guards")).toBeGreaterThan(Math.max(idx("Routing"), idx("Theme")));
  expect(c.some((l) => /^client\s/.test(l))).toBe(false);
  for (const t of ["Paused card", "Stale card", "Postponed card", "Billing"]) expect(client).not.toContain(t);
}, SLOW);

test("09.5 a decided card reopened as rejected comes back as work in every tree", async () => {
  writeLog(project(),
    real("a1", { title: "Tree A" }), real("b1", { title: "Tree B" }),
    decidedCard("auth", { title: "Auth flow" }), reopen("auth", "rejected"));
  const out = (await werk("find")).stdout;
  expect(out).toContain("Tree A");
  expect(out).toContain("Tree B");
  expect(out).toContain("Auth flow");
  expect(out).not.toContain("[decided]");
}, SLOW);

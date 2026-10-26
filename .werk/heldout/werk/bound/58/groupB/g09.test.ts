import { afterEach, beforeEach, expect, test } from "bun:test";
import { decided, ghost, link, open } from "../../src/map/mark-fixtures.ts";
import { make, SLOW, seed, YOU } from "./helper.ts";

let t: ReturnType<typeof make>;
beforeEach(() => {
  t = make();
});
afterEach(() => t.project.dispose());
const lines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");

test("09.1 search with no term lists the decided index", async () => {
  seed(
    t.project,
    decided("d1", { title: "First decided" }),
    decided("d2", { title: "Second decided" }),
    decided("d3", { title: "Third decided" }),
    open("op", { title: "Open one" }),
    ghost("gh", { status: "decided", title: "Ghost one" }),
  );
  const r = await t.werk("search");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(3);
  for (const [id, title] of [
    ["d1", "First decided"],
    ["d2", "Second decided"],
    ["d3", "Third decided"],
  ])
    expect(out.some((l) => l.includes(id) && l.includes(title))).toBe(true);
  expect(r.stdout).not.toContain("Open one");
  expect(r.stdout).not.toContain("Ghost one");
}, SLOW);

test("09.2 two terms, best match first", async () => {
  seed(
    t.project,
    decided("layout", {
      title: "Cache layout",
      body: "Cache eviction happens by an eviction policy.",
    }),
    open("timer", {
      title: "Eviction timer",
      why: "eviction",
      body: "CACHE warmup",
    }),
    decided("size", { title: "Cache size" }),
    decided("gone", { title: "Gone card", body: "cache eviction" }),
  );
  expect((await t.werk("remove", "gone", ...YOU)).code).toBe(0);
  const r = await t.werk("search", "cache", "eviction");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(2);
  expect(out[0]).toContain("layout");
  expect(out[0]).toContain("decided");
  expect(out[0]).toContain("Cache layout");
  expect(out[1]).toContain("timer");
  expect(out[1]).toContain("open");
  expect(out[1]).toContain("Eviction timer");
  expect(r.stdout).not.toContain("Cache size");
  expect(r.stdout).not.toContain("Gone card");
}, SLOW);

test("09.3 a word in a rejected option, narrowed", async () => {
  seed(
    t.project,
    decided("parent", { title: "Parent topic" }),
    decided("storage", { title: "Storage format", parent: "parent" }),
    open("opt", {
      kind: "option",
      title: "Embedded database",
      why: "SQLite needs a native build",
    }),
    link("opt", "storage", "alternative_to"),
    open("elsewhere", { title: "Elsewhere", body: "we could use sqlite here" }),
  );
  const all = await t.werk("search", "sqlite");
  expect(all.stdout).toContain("storage");
  expect(all.stdout).toContain("Storage format");
  expect(all.stdout).toContain("decided");
  expect(all.stdout).toContain("Elsewhere");
  const under = await t.werk("search", "sqlite", "--under", "parent");
  expect(lines(under.stdout)).toHaveLength(1);
  expect(under.stdout).toContain("Storage format");
  const dec = await t.werk("search", "sqlite", "--status", "decided");
  expect(lines(dec.stdout)).toHaveLength(1);
  expect(dec.stdout).toContain("Storage format");
}, SLOW);

test("09.4 find the open work under one card", async () => {
  seed(
    t.project,
    decided("client", { title: "Client" }),
    open("routing", { parent: "client", title: "Routing" }),
    open("theme", { parent: "client", title: "Theme", status: "proto" }),
    open("guards", { parent: "routing", title: "Route guards" }),
    decided("pp", { parent: "client", title: "Postponer" }),
    decided("yy", { title: "Invalidated basis" }),
    open("paused", { parent: "client", title: "Paused card" }),
    open("stale", { parent: "client", title: "Stale card" }),
    link("paused", "pp"),
    link("stale", "yy"),
    open("opt", { kind: "option", title: "An option", why: "no" }),
    link("opt", "routing", "alternative_to"),
    open("src", { kind: "source", title: "A source" }),
    link("routing", "src", "supported_by"),
    open("billing", { title: "Billing" }),
    { type: "node.reopened", id: "pp", reason: "postponed", at: "2026-10-10T09:00:00.000Z" },
    { type: "node.reopened", id: "yy", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" },
  );
  const marks = (await t.werk("stale")).stdout;
  console.log(marks);
  const r = await t.werk("find", "routing");
  const out = lines(r.stdout);
  expect(out[0]).toContain("Routing");
  expect(out[1]).toContain("Route guards");
  expect(r.stdout).not.toContain("Billing");
  expect(r.stdout).not.toContain("An option");
  expect(r.stdout).not.toContain("A source");
  const c = await t.werk("find", "client");
  const co = lines(c.stdout);
  const i = (s: string) => co.findIndex((l) => l.includes(s));
  expect(i("Routing")).toBeGreaterThanOrEqual(0);
  expect(i("Theme")).toBeGreaterThanOrEqual(0);
  expect(i("Route guards")).toBeGreaterThan(Math.max(i("Routing"), i("Theme")));
  expect(c.stdout).not.toMatch(/\bClient\b/);
  expect(c.stdout).not.toContain("Paused card");
  expect(c.stdout).not.toContain("Stale card");
  expect(c.stdout).not.toContain("Postponer");
}, SLOW);

test("09.5 a reopened-rejected card comes back as work in every tree", async () => {
  seed(
    t.project,
    open("treea", { title: "Tree A open" }),
    open("treeb", { title: "Tree B open" }),
    decided("auth", { title: "Auth flow" }),
    { type: "node.reopened", id: "auth", reason: "rejected", at: "2026-10-10T09:00:00.000Z" },
  );
  const r = await t.werk("find");
  expect(r.stdout).toContain("Tree A open");
  expect(r.stdout).toContain("Tree B open");
  expect(r.stdout).toContain("Auth flow");
  expect(r.stdout).not.toContain("[decided]");
}, SLOW);

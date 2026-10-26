// 09.1 - 09.5: the search and find verbs.
import { expect, test } from "bun:test";
import { decided, ghost, link, open, reopen } from "../src/map/mark-fixtures.ts";
import { useTools } from "./support.ts";

const t = useTools();
const lines = (out: string) => out.split("\n").filter((l) => l.trim() !== "");

test("09.1 search with no term lists the decided cards only", async () => {
  // A ghost that was decided before it was accepted: node.decided on a ghost.
  const decidedGhost = [
    ghost("ghosty", { title: "Ghost card" }),
    { type: "node.edited", id: "ghosty", who: "me", noBasis: "test" },
    { type: "criterion.added", id: "ghosty", form: "revisit" },
    { type: "node.decided", id: "ghosty" },
  ];
  t().seed(
    decided("d1", { title: "First decided" }),
    decided("d2", { title: "Second decided" }),
    decided("d3", { title: "Third decided" }),
    open("o1", { title: "Open card" }),
    decidedGhost,
  );
  const r = await t().werk("search");
  expect(r.code, r.stderr).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(3);
  for (const [id, title] of [["d1", "First decided"], ["d2", "Second decided"], ["d3", "Third decided"]]) {
    expect(out.some((l) => l.includes(id as string) && l.includes(title as string))).toBe(true);
  }
  expect(r.stdout).not.toContain("o1");
  expect(r.stdout).not.toContain("Ghost card");
});

test("09.2 two terms, best match first, removed card hidden", async () => {
  t().seed(
    decided("layout", { title: "Cache layout", body: "Cache eviction happens by the eviction policy" }),
    open("timer", { title: "Eviction timer", why: "eviction", body: "CACHE warmup" }),
    decided("size", { title: "Cache size", body: "cache is sized by memory" }),
    decided("gone", { title: "Gone card", body: "cache eviction" }),
    { type: "node.removed", id: "gone" },
  );
  const r = await t().werk("search", "cache", "eviction");
  expect(r.code, r.stderr).toBe(0);
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
});

test("09.3 a word in a rejected option's why-not, and the narrowing flags", async () => {
  t().seed(
    decided("parent", { title: "Parent topic" }),
    decided("storage", { title: "Storage format", parent: "parent" }),
    open("storage:opt0", { kind: "option", title: "Embedded db", why: "SQLite needs a native build" }),
    { type: "edge.added", from: "storage:opt0", to: "storage", link: "alternative_to", why: "" },
    open("elsewhere", { title: "Elsewhere", body: "we could use sqlite here" }),
  );
  const { werk } = t();
  const all = await werk("search", "sqlite");
  expect(all.code, all.stderr).toBe(0);
  expect(all.stdout).toMatch(/storage\s+\[decided\]\s+Storage format/);
  expect(all.stdout).toContain("elsewhere");
  const under = await werk("search", "sqlite", "--under", "parent");
  expect(lines(under.stdout)).toHaveLength(1);
  expect(under.stdout).toContain("Storage format");
  const status = await werk("search", "sqlite", "--status", "decided");
  expect(lines(status.stdout)).toHaveLength(1);
  expect(status.stdout).toContain("Storage format");
});

function clientTree() {
  t().seed(
    decided("client", { title: "Client" }),
    open("routing", { title: "Routing", parent: "client" }),
    open("theme", { title: "Theme", parent: "client", status: "proto" }),
    open("guards", { title: "Route guards", parent: "routing" }),
    decided("base", { title: "Base" }),
    decided("pc", { title: "Postponed card", parent: "client" }),
    decided("stalec", { title: "Stale card", parent: "client" }),
    decided("pausedc", { title: "Paused card", parent: "client" }),
    link("stalec", "base"),
    link("pausedc", "pc"),
    reopen("stalec", { reason: "invalidated" }),
    reopen("pausedc", { reason: "invalidated" }),
    reopen("base", { reason: "rejected" }),
    reopen("pc", { reason: "postponed" }),
    open("routing:opt0", { kind: "option", title: "Option card", why: "no" }),
    { type: "edge.added", from: "routing:opt0", to: "routing", link: "alternative_to", why: "" },
    open("routing:src", { kind: "source", title: "Source card" }),
    { type: "edge.added", from: "routing", to: "routing:src", link: "supported_by", why: "" },
    open("billing", { title: "Billing" }),
  );
}

test("09.4 find lists the open work under one card", async () => {
  clientTree();
  const { werk } = t();
  const routing = await werk("find", "routing");
  expect(routing.code, routing.stderr).toBe(0);
  const r = lines(routing.stdout);
  expect(r[0]).toContain("routing");
  expect(r[1]).toContain("guards");
  expect(routing.stdout).not.toContain("billing");
  expect(routing.stdout).not.toContain("Option card");
  expect(routing.stdout).not.toContain("Source card");
  const client = await werk("find", "client");
  expect(client.code, client.stderr).toBe(0);
  const ids = lines(client.stdout).map((l) => l.split(/\s+/)[0]);
  expect(ids.indexOf("routing")).toBeGreaterThanOrEqual(0);
  expect(ids.indexOf("theme")).toBeGreaterThanOrEqual(0);
  expect(ids.indexOf("guards")).toBeGreaterThan(ids.indexOf("routing"));
  expect(ids.indexOf("guards")).toBeGreaterThan(ids.indexOf("theme"));
  expect(ids).not.toContain("client");
  expect(ids).not.toContain("pc");
  expect(ids).not.toContain("stalec");
  expect(ids).not.toContain("pausedc");
});

test("09.5 a card reopened as rejected is work in every tree", async () => {
  t().seed(
    open("t1", { title: "Tree one" }),
    open("t2", { title: "Tree two" }),
    decided("auth", { title: "Auth flow" }),
    reopen("auth", { reason: "rejected" }),
  );
  const r = await t().werk("find");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout).toContain("t1");
  expect(r.stdout).toContain("t2");
  expect(r.stdout).toContain("Auth flow");
  expect(r.stdout).not.toContain("[decided]");
});

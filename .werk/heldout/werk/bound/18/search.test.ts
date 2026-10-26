// Held-out steps 09.1-09.5: search and find.
import { expect, test } from "bun:test";
import { card, link, ok, seeded } from "./cli-helpers.ts";

const out = (text: string) => text.split("\n").filter((l) => l !== "");

test("09.1 search with no term lists the index of decided cards", async () => {
  const p = seeded([
    card("root", "Root topic", { status: "decided" }),
    card("d1", "First decided", { status: "decided", parent: "root" }),
    card("d2", "Second decided", { status: "decided", parent: "root" }),
    card("o1", "An open card", { parent: "root" }),
    ["node.proposed", { id: "g1", kind: "card", title: "A ghost card", status: "decided", parent: "root" }, "agent"],
  ]);
  const got = out((await ok(p, ["search"])).out);
  expect(got).toHaveLength(3);
  expect(got).toContain("root  Root topic");
  expect(got).toContain("d1  First decided");
  expect(got).toContain("d2  Second decided");
  expect(got.join("\n")).not.toContain("o1");
  expect(got.join("\n")).not.toContain("g1");
});

test("09.2 search with two terms shows the best match first", async () => {
  const p = seeded([
    card("root", "Root", { status: "decided" }),
    card("cl", "Cache layout", { status: "decided", parent: "root", body: "Cache eviction uses one eviction policy." }),
    card("et", "Eviction timer", { parent: "root", why: "eviction", body: "CACHE warmup" }),
    card("cs", "Cache size", { status: "decided", parent: "root", body: "the cache holds 1 GB" }),
    card("gone", "Gone card", { parent: "root", body: "cache eviction" }),
  ]);
  await ok(p, ["remove", "gone", "--actor", "you"]);
  const got = out((await ok(p, ["search", "cache", "eviction"])).out);
  expect(got).toEqual(["cl  decided  Cache layout", "et  open  Eviction timer"]);
});

test("09.3 search finds a card by a word in a rejected option, and narrows", async () => {
  const p = seeded([
    card("parent", "Parent topic", { status: "decided" }),
    card("sf", "Storage format", { status: "decided", parent: "parent" }),
    ["node.added", { id: "sf:opt0", kind: "option", title: "A database file", why_not: "SQLite needs a native build" }],
    link("sf:opt0", "sf", "alternative_to"),
    card("other", "Other root", { status: "decided" }),
    card("oc", "Open card", { parent: "other", body: "maybe sqlite later" }),
  ]);
  const all = (await ok(p, ["search", "sqlite"])).out;
  expect(all).toContain("sf  decided  Storage format");
  expect(all).toContain("oc  open  Open card");
  expect(out((await ok(p, ["search", "sqlite", "--under", "parent"])).out)).toEqual(["sf  decided  Storage format"]);
  expect(out((await ok(p, ["search", "sqlite", "--status", "decided"])).out)).toEqual(["sf  decided  Storage format"]);
});

test("09.4 find lists the open work under one card", async () => {
  const p = seeded([
    card("client", "Client", { status: "decided" }),
    card("routing", "Routing", { parent: "client" }),
    card("theme", "Theme", { parent: "client", status: "proto" }),
    card("guards", "Route guards", { parent: "routing" }),
    // Other tree: the bases of the paused and stale cards, and Billing.
    card("other", "Other", { status: "decided" }),
    card("billing", "Billing", { parent: "other" }),
    card("base-p", "Base of paused", { parent: "other", status: "decided" }),
    card("base-s", "Base of stale", { parent: "other", status: "decided" }),
    card("paused", "Paused card", { parent: "client" }),
    link("paused", "base-p", "depends_on", "needs it"),
    card("stale", "Stale card", { parent: "client" }),
    link("stale", "base-s", "depends_on", "needs it"),
    card("postponed", "Postponed card", { parent: "client", status: "decided" }),
    ["node.reopened", { id: "postponed", reason: "postponed" }],
    ["node.reopened", { id: "base-p", reason: "postponed" }],
    ["node.reopened", { id: "base-s", reason: "invalidated" }],
    ["node.added", { id: "routing:opt0", kind: "option", title: "Hash routing option", why_not: "ugly" }],
    link("routing:opt0", "routing", "alternative_to"),
    ["node.added", { id: "src-r", kind: "source", title: "Router source", url: "https://x", finding: "f" }],
    link("routing", "src-r", "supported_by"),
  ]);
  const stale = (await ok(p, ["stale"])).out;
  expect(stale).toContain("paused");
  expect(stale).toContain("stale");
  const r = out((await ok(p, ["find", "routing"])).out);
  expect(r[0]).toStartWith("routing ");
  expect(r[1]).toStartWith("guards ");
  const rs = r.join("\n");
  for (const word of ["billing", "routing:opt0", "src-r"]) expect(rs).not.toContain(word);
  const c = out((await ok(p, ["find", "client"])).out);
  const at = (id: string) => c.findIndex((l) => l.startsWith(`${id} `));
  expect(at("routing")).toBeGreaterThanOrEqual(0);
  expect(at("theme")).toBeGreaterThanOrEqual(0);
  expect(at("routing")).toBeLessThan(at("guards"));
  expect(at("theme")).toBeLessThan(at("guards"));
  for (const id of ["client", "paused", "stale", "postponed"]) expect(at(id)).toBe(-1);
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const p = seeded([
    card("t1", "Tree one", { status: "decided" }),
    card("o1", "Open in one", { parent: "t1" }),
    card("t2", "Tree two", { status: "decided" }),
    card("o2", "Open in two", { parent: "t2" }),
    card("af", "Auth flow", { parent: "t1", status: "decided" }),
    ["node.reopened", { id: "af", reason: "rejected" }],
  ]);
  const got = out((await ok(p, ["find"])).out);
  const ids = got.map((l) => l.split(" ")[0]);
  expect(ids).toContain("o1");
  expect(ids).toContain("o2");
  expect(ids).toContain("af");
  expect(got.some((l) => l.includes("decided"))).toBe(false);
  expect(ids).not.toContain("t1");
  expect(ids).not.toContain("t2");
});

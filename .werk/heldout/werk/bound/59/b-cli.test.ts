// Held-out steps 08.x, 09.x, 11.x: remove/restore, search/find, show/rollup, on the command line.
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

function setup() {
  const p = freshProject();
  const log = join(p.dir, ".werk", "log.jsonl");
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  const seed = (type: string, payload: object) =>
    appendFileSync(log, `${JSON.stringify({ seq: lines().length + 1, at: "t", actor: "you", type, payload })}\n`);
  const card = (id: string, title: string, fields: Record<string, unknown> = {}) =>
    seed("node.added", { id, kind: "card", title, ...fields });
  const ok = async (...args: string[]) => {
    const r = await p.werk(args);
    if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}${r.out}`);
    return r.out;
  };
  return { p, log, lines, seed, card, ok };
}

/** Every CLI view of the map, joined: the root, every card listed by find and search, and a full search. */
async function views(p: Project): Promise<string> {
  const outs = await Promise.all([
    p.werk(["show"]),
    p.werk(["find"]),
    p.werk(["search"]),
    p.werk(["search", "auth"]),
    p.werk(["search", "login"]),
    p.werk(["search", "session"]),
  ]);
  return outs.map((r) => r.out).join("\n");
}

const decided = { status: "decided", who: "me" };

// 08.1
test("08.1 remove takes the subtree out in one step, restore brings it back", async () => {
  const { p, lines, card, seed, ok } = setup();
  card("root", "Root", { ...decided });
  card("auth", "Auth", { ...decided, parent: "root" });
  card("login", "Login", { parent: "auth" });
  card("session", "Session", { parent: "auth" });
  card("audit", "Audit", { parent: "root" });
  seed("edge.added", { from: "login", to: "audit", type: "depends_on", why: "login writes the audit trail" });
  expect(await ok("show", "audit")).toContain("<- depends_on      login");

  const before = lines().length;
  await ok("remove", "auth", "--actor", "you");
  const v = await views(p);
  for (const id of ["auth", "login", "session"]) {
    expect(v).not.toMatch(new RegExp(`\\b${id}\\b`));
    expect((await p.werk(["show", id])).code).not.toBe(0);
  }
  const added = lines().slice(before);
  expect(added).toHaveLength(1);
  expect(added[0]).toContain("node.removed");
  const removed = await ok("removed");
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect(await ok("show", "audit")).not.toContain("login");

  await ok("restore", "auth", "--actor", "you");
  const auth = await ok("show", "auth");
  expect(auth).toContain("<- refines         login");
  expect(auth).toContain("<- refines         session");
  expect(await ok("show", "audit")).toContain("<- depends_on      login");
  expect(await ok("removed")).not.toMatch(/auth|login|session/);
});

// 08.2
test("08.2 reparent moves the children up, and a restore puts them back", async () => {
  const { card, ok } = setup();
  card("platform", "Platform", { ...decided });
  card("auth", "Auth", { ...decided, parent: "platform" });
  card("login", "Login", { parent: "auth" });
  card("session", "Session", { parent: "auth" });
  await ok("remove", "auth", "--actor", "you", "--reparent");
  const platform = await ok("show", "platform");
  expect(platform).not.toContain("auth");
  expect(platform).toContain("<- refines         login");
  expect(platform).toContain("<- refines         session");
  await ok("restore", "auth", "--actor", "you");
  const again = await ok("show", "platform");
  expect(again).toContain("<- refines         auth");
  expect(again).not.toContain("<- refines         login");
  expect(again).not.toContain("<- refines         session");
  const auth = await ok("show", "auth");
  expect(auth).toContain("<- refines         login");
  expect(auth).toContain("<- refines         session");
});

// 08.3
test("08.3 a link waits until both of its ends are back", async () => {
  const { card, seed, ok } = setup();
  card("root", "Root", { ...decided });
  card("a", "Branch A", { parent: "root" });
  card("b", "Branch B", { parent: "root" });
  card("login", "Login", { parent: "a" });
  card("session", "Session", { parent: "b" });
  seed("edge.added", { from: "login", to: "session", type: "depends_on", why: "login opens a session" });
  await ok("remove", "login", "--actor", "you");
  await ok("remove", "session", "--actor", "you");
  await ok("restore", "login", "--actor", "you");
  const login = await ok("show", "login");
  expect(login).toContain("Login");
  expect(login).not.toContain("session");
  await ok("restore", "session", "--actor", "you");
  expect(await ok("show", "login")).toContain("-> depends_on      session");
});

// 08.4
test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const { lines, card, seed, ok, p } = setup();
  card("root", "Root", { ...decided });
  card("login", "Login", { parent: "root" });
  card("billing", "Billing", { parent: "root" });
  seed("node.added", { id: "rfc-6749", kind: "source", title: "RFC 6749", finding: "OAuth 2.0" });
  seed("edge.added", { from: "login", to: "rfc-6749", type: "supported_by" });
  seed("edge.added", { from: "billing", to: "rfc-6749", type: "supported_by" });
  await ok("remove", "login", "--actor", "you");
  const source = await ok("show", "rfc-6749");
  expect(source).toContain("RFC 6749");
  expect(source).toContain("<- supported_by    billing");
  const before = lines().length;
  const add = await p.werk(["add", "login", "--title", "A new login", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  expect(add.err + add.out).toMatch(/restore #?login/);
  expect(lines().length).toBe(before);
  expect((await p.werk(["show", "login"])).code).not.toBe(0);
});

// 08.5
test("08.5 remove refuses without the person's say-so", async () => {
  const { lines, card, ok, p } = setup();
  card("root", "Root", { ...decided });
  card("login", "Login", { parent: "root" });
  const before = lines().length;
  const r = await p.werk(["remove", "login"]);
  expect(r.code).not.toBe(0);
  expect(await ok("show", "login")).toContain("Login");
  expect(lines().length).toBe(before);
});

// 08.6
test("08.6 restore refuses without the person's say-so", async () => {
  const { lines, card, ok, p } = setup();
  card("root", "Root", { ...decided });
  card("login", "Login", { parent: "root" });
  await ok("remove", "login", "--actor", "you");
  const before = lines().length;
  const r = await p.werk(["restore", "login"]);
  expect(r.code).not.toBe(0);
  expect((await p.werk(["show", "login"])).code).not.toBe(0);
  expect(await ok("show", "root")).not.toContain("login");
  expect(lines().length).toBe(before);
});

// 09.1
test("09.1 search with no term lists the decided cards only", async () => {
  const { card, seed, ok } = setup();
  card("root", "Root topic", { ...decided });
  card("d-one", "First decided", { ...decided, parent: "root" });
  card("d-two", "Second decided", { ...decided, parent: "root" });
  card("open-one", "Still open", { parent: "root" });
  seed("node.proposed", { id: "ghost-one", kind: "card", title: "Ghost decided", status: "decided", parent: "root" });
  const out = await ok("search");
  const rows = out.split("\n").filter(Boolean);
  expect(rows).toHaveLength(3);
  for (const [id, title] of [
    ["root", "Root topic"],
    ["d-one", "First decided"],
    ["d-two", "Second decided"],
  ]) {
    expect(rows.some((r) => r.includes(id as string) && r.includes(title as string))).toBe(true);
  }
  expect(out).not.toContain("open-one");
  expect(out).not.toContain("ghost-one");
});

// 09.2
test("09.2 search with two terms ranks the best match first", async () => {
  const { card, ok } = setup();
  card("root", "Root", { ...decided });
  card("cache-layout", "Cache layout", {
    ...decided,
    parent: "root",
    body: "Cache eviction runs hourly. The eviction policy is LRU.",
  });
  card("eviction-timer", "Eviction timer", {
    parent: "root",
    why: "eviction needs a clock",
    body: "CACHE warmup first.",
  });
  card("cache-size", "Cache size", { ...decided, parent: "root", body: "The cache holds 1 GB." });
  card("gone", "Gone card", { parent: "root", body: "cache eviction everywhere" });
  await ok("remove", "gone", "--actor", "you");
  const rows = (await ok("search", "cache", "eviction")).split("\n").filter(Boolean);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain("cache-layout");
  expect(rows[0]).toContain("decided");
  expect(rows[0]).toContain("Cache layout");
  expect(rows[1]).toContain("eviction-timer");
  expect(rows[1]).toContain("open");
  expect(rows[1]).toContain("Eviction timer");
  expect(rows.join("\n")).not.toContain("cache-size");
  expect(rows.join("\n")).not.toContain("gone");
});

// 09.3
test("09.3 search finds a word in a rejected option and narrows", async () => {
  const { card, seed, ok } = setup();
  card("root", "Root", { ...decided });
  card("parent-topic", "Parent topic", { ...decided, parent: "root" });
  card("storage-format", "Storage format", { ...decided, parent: "parent-topic", body: "One JSON line per event." });
  seed("node.added", {
    id: "storage-format:opt0",
    kind: "option",
    title: "A database file",
    why_not: "SQLite needs a native build",
  });
  seed("edge.added", { from: "storage-format:opt0", to: "storage-format", type: "alternative_to" });
  card("elsewhere", "Elsewhere", { parent: "root", body: "maybe sqlite later" });
  const all = await ok("search", "sqlite");
  expect(all.split("\n").some((r) => r.includes("storage-format") && r.includes("decided"))).toBe(true);
  expect(all).toContain("elsewhere");
  const under = (await ok("search", "sqlite", "--under", "parent-topic")).split("\n").filter(Boolean);
  expect(under).toHaveLength(1);
  expect(under[0]).toContain("storage-format");
  const dec = (await ok("search", "sqlite", "--status", "decided")).split("\n").filter(Boolean);
  expect(dec).toHaveLength(1);
  expect(dec[0]).toContain("storage-format");
});

// 09.4
test("09.4 find lists the open work under one card", async () => {
  const { card, seed, ok } = setup();
  card("root", "Root", { ...decided });
  card("client", "Client", { ...decided, parent: "root" });
  card("routing", "Routing", { parent: "client" });
  card("theme", "Theme", { parent: "client", status: "proto" });
  card("route-guards", "Route guards", { parent: "routing" });
  seed("node.added", { id: "routing:opt0", kind: "option", title: "Hash routing", why_not: "ugly urls" });
  seed("edge.added", { from: "routing:opt0", to: "routing", type: "alternative_to" });
  seed("node.added", { id: "router-docs", kind: "source", title: "Router docs", finding: "History API" });
  seed("edge.added", { from: "routing", to: "router-docs", type: "supported_by" });
  card("billing", "Billing", { parent: "root" });
  // Bases outside the Client tree.
  card("base-a", "Base A", { ...decided, parent: "root" });
  card("base-b", "Base B", { ...decided, parent: "root" });
  card("paused-card", "Paused card", { parent: "client" });
  seed("edge.added", { from: "paused-card", to: "base-a", type: "depends_on", why: "needs A" });
  card("stale-card", "Stale card", { parent: "client" });
  seed("edge.added", { from: "stale-card", to: "base-b", type: "depends_on", why: "needs B" });
  card("postponed-card", "Postponed card", { ...decided, parent: "client" });
  await ok("reopen", "base-a", "--reason", "postponed", "--why", "later");
  await ok("reopen", "base-b", "--reason", "invalidated", "--why", "wrong");
  await ok("reopen", "postponed-card", "--reason", "postponed", "--why", "later");
  const marks = await ok("stale");
  expect(marks).toContain("paused-card");
  expect(marks).toContain("stale-card");

  const r = (await ok("find", "routing")).split("\n").filter(Boolean);
  expect(r[0]).toContain("routing");
  expect(r.findIndex((l) => l.includes("route-guards"))).toBeGreaterThan(0);
  const rt = r.join("\n");
  expect(rt).not.toContain("billing");
  expect(rt).not.toContain("routing:opt0");
  expect(rt).not.toContain("router-docs");

  const c = (await ok("find", "client")).split("\n").filter(Boolean);
  const at = (id: string) => c.findIndex((l) => l.split(/\s+/)[0] === id);
  expect(at("routing")).toBeGreaterThanOrEqual(0);
  expect(at("theme")).toBeGreaterThanOrEqual(0);
  expect(at("route-guards")).toBeGreaterThan(at("routing"));
  expect(at("route-guards")).toBeGreaterThan(at("theme"));
  expect(at("client")).toBe(-1);
  expect(at("paused-card")).toBe(-1);
  expect(at("stale-card")).toBe(-1);
  expect(at("postponed-card")).toBe(-1);
});

// 09.5
test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const { card, ok } = setup();
  card("tree-a", "Tree A", { ...decided });
  card("work-a", "Work A", { parent: "tree-a" });
  card("tree-b", "Tree B", { ...decided });
  card("work-b", "Work B", { parent: "tree-b" });
  card("auth-flow", "Auth flow", { ...decided, parent: "tree-b" });
  await ok("reopen", "auth-flow", "--reason", "rejected", "--why", "wrong idea");
  const out = await ok("find");
  const ids = out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.trim().split(/\s+/)[0]);
  expect(ids).toContain("work-a");
  expect(ids).toContain("work-b");
  expect(ids).toContain("auth-flow");
  expect(ids).not.toContain("tree-a");
  expect(ids).not.toContain("tree-b");
});

// 11.1
test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const { card, ok } = setup();
  card("root", "Root", { ...decided });
  card("child-open", "Child open", { parent: "root" });
  card("child-proto", "Child proto", { parent: "root", status: "proto" });
  card("grand", "Grand", { ...decided, parent: "child-open" });
  const out = await ok("show", "root");
  const rollups = out.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(rollups).toHaveLength(1);
  expect(rollups[0]).toContain("4 cards");
  expect(rollups[0]).toContain("1 open");
  expect(rollups[0]).toContain("1 proto");
  expect(rollups[0]).toContain("2 decided");
});

// 11.2
test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const { card, ok } = setup();
  card("parent", "Parent", { ...decided });
  card("child", "Child", { ...decided, parent: "parent" });
  card("g1", "Grand one", { parent: "child" });
  card("g2", "Grand two", { ...decided, parent: "child" });
  const out = await ok("show", "parent");
  const link = out.split("\n").find((l) => l.includes("<- refines") && l.includes("child"));
  expect(link).toBeDefined();
  expect(link).toContain("3 cards");
  expect(out.split("\n").find((l) => l.startsWith("subtree:"))).toContain("4 cards");
});

// 11.3
test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const { card, seed, ok } = setup();
  card("root", "Root", { ...decided });
  card("base", "Base card", { ...decided, parent: "root" });
  card("subject", "Subject card", { parent: "root" });
  seed("edge.added", { from: "subject", to: "base", type: "depends_on", why: "it reuses the base format" });
  seed("node.added", { id: "subject:opt0", kind: "option", title: "Use XML", why_not: "too verbose" });
  seed("edge.added", { from: "subject:opt0", to: "subject", type: "alternative_to" });
  seed("excerpt.quoted", {
    id: "subject:ex0",
    title: "keep one log per conversation",
    card: "subject",
    conversation: "c1",
    session: "s1",
    message: 0,
    start: 0,
    end: 29,
    speaker: "person",
    said_at: "t0",
  });
  seed("node.proposed", { id: "bench", kind: "source", title: "Benchmark notes", finding: "JSON is fast enough" });
  seed("edge.added", { from: "subject", to: "bench", type: "supported_by" });
  const out = await ok("show", "subject");
  expect(out).toContain("-> depends_on      base");
  expect(out).toContain("it reuses the base format");
  const lastLink = Math.max(...out.split("\n").map((l, i) => (/^\s+(->|<-) /.test(l) ? i : -1)));
  const lines = out.split("\n");
  const optIdx = lines.findIndex((l) => l.trim() === "Options");
  expect(optIdx).toBeGreaterThan(lastLink);
  const tail = lines.slice(optIdx).join("\n");
  expect(tail).toContain("Use XML");
  expect(tail).toContain("too verbose");
  const sayIdx = lines.findIndex((l) => l.trim() === "Say");
  expect(sayIdx).toBeGreaterThan(-1);
  const say = lines.slice(sayIdx).join("\n");
  expect(say).toContain("person");
  expect(say).toContain("keep one log per conversation");
  const evIdx = lines.findIndex((l) => l.trim() === "Ev");
  expect(evIdx).toBeGreaterThan(-1);
  const evBlock = lines.slice(evIdx, evIdx + 4).join("\n");
  expect(evBlock).toContain("Benchmark notes");
  expect(evBlock).toContain("JSON is fast enough");
  expect(evBlock).toContain("proposed");
});

// 11.4
test("11.4 a card with no options prints no Options section", async () => {
  const { card, seed, ok } = setup();
  card("root", "Root", { ...decided });
  card("subject", "Subject card", { parent: "root" });
  seed("excerpt.quoted", {
    id: "subject:ex0",
    title: "the words",
    card: "subject",
    conversation: "c1",
    session: "s1",
    message: 0,
    start: 0,
    end: 9,
    speaker: "agent",
    said_at: "t0",
  });
  seed("node.added", { id: "src", kind: "source", title: "A source", finding: "a finding" });
  seed("edge.added", { from: "subject", to: "src", type: "supported_by" });
  const lines = (await ok("show", "subject")).split("\n").map((l) => l.trim());
  expect(lines).toContain("Say");
  expect(lines).toContain("Ev");
  expect(lines).not.toContain("Options");
});

// 11.5
test("11.5 show with no id prints the root card", async () => {
  const { card, ok } = setup();
  card("root", "The root title", { ...decided });
  card("second", "Second card", { parent: "root" });
  const out = await ok("show");
  expect(out).toContain("The root title");
  expect(out).toMatch(/^subtree: 2 cards/m);
  const link = out.split("\n").find((l) => l.includes("<- refines") && l.includes("second"));
  expect(link).toContain("(1 card, 1 open)");
});

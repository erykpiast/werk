// Held-out steps 08.x (remove/restore), 09.x (search/find) and 11.x (show rollups).
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readMap } from "../src/map/store.ts";
import { shapeRead } from "../src/serve/map-api.ts";
import { freshProject, type Project } from "../src/test/project.ts";

function logOf(p: Project): string {
  return join(p.dir, ".werk", "log.jsonl");
}
function lines(p: Project): string[] {
  return readFileSync(logOf(p), "utf8").split("\n").filter(Boolean);
}
function seed(p: Project, type: string, payload: object): void {
  appendFileSync(
    logOf(p),
    `${JSON.stringify({ seq: lines(p).length + 1, at: "2026-01-01T00:00:00.000Z", actor: "you", type, payload })}\n`,
  );
}
function card(p: Project, id: string, title: string, extra: object = {}): void {
  seed(p, "node.added", { id, kind: "card", title, ...extra });
}
async function ok(p: Project, args: string[]): Promise<string> {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run.out;
}
/** Every view the map offers: show of each id, search, find, and the server's graph shape. */
async function inAnyView(p: Project, id: string): Promise<boolean> {
  const show = await p.werk(["show", id]);
  const search = await ok(p, ["search"]);
  const find = await ok(p, ["find"]);
  const shape = shapeRead(readMap("test", logOf(p)));
  const lineHas = (text: string) => text.split("\n").some((line) => line.split(/\s+/)[0] === id);
  return show.code === 0 || lineHas(search) || lineHas(find) || shape.nodes.some((node) => node.id === id);
}
function graphHasEdge(p: Project, from: string, to: string): boolean {
  return shapeRead(readMap("test", logOf(p))).edges.some((e) => e.from === from && e.to === to);
}

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const p = freshProject();
  card(p, "root", "Root");
  card(p, "auth", "Auth", { parent: "root" });
  card(p, "login", "Login", { parent: "auth" });
  card(p, "session", "Session", { parent: "auth" });
  card(p, "audit", "Audit", { parent: "root" });
  seed(p, "node.decided", { id: "auth" });
  await ok(p, ["link", "login", "audit", "--type", "depends_on", "--why", "login writes to the audit"]);
  expect(await ok(p, ["show", "login"])).toContain("depends_on      audit");
  expect(graphHasEdge(p, "login", "audit")).toBe(true);

  const before = lines(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  for (const id of ["auth", "login", "session"]) expect(await inAnyView(p, id)).toBe(false);
  const added = lines(p)
    .slice(before)
    .map((l) => JSON.parse(l));
  expect(added).toHaveLength(1);
  expect(added[0].type).toBe("node.removed");
  const removed = await ok(p, ["removed"]);
  expect(removed).toMatch(/auth/);
  expect(removed).toMatch(/login/);
  expect(removed).toMatch(/session/);
  expect(graphHasEdge(p, "login", "audit")).toBe(false);
  expect(await ok(p, ["show", "audit"])).not.toContain("login");

  await ok(p, ["restore", "auth", "--actor", "you"]);
  const auth = await ok(p, ["show", "auth"]);
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
  expect(await ok(p, ["show", "login"])).toMatch(/-> depends_on\s+audit/);
  expect(graphHasEdge(p, "login", "audit")).toBe(true);
  expect(await ok(p, ["removed"])).not.toMatch(/auth/);
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  const p = freshProject();
  card(p, "platform", "Platform");
  card(p, "auth", "Auth", { parent: "platform" });
  card(p, "login", "Login", { parent: "auth" });
  card(p, "session", "Session", { parent: "auth" });

  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect(await inAnyView(p, "auth")).toBe(false);
  const platform = await ok(p, ["show", "platform"]);
  expect(platform).toMatch(/<- refines\s+login/);
  expect(platform).toMatch(/<- refines\s+session/);

  await ok(p, ["restore", "auth", "--actor", "you"]);
  const after = await ok(p, ["show", "platform"]);
  expect(after).toMatch(/<- refines\s+auth/);
  expect(after).not.toMatch(/<- refines\s+login/);
  expect(after).not.toMatch(/<- refines\s+session/);
  const auth = await ok(p, ["show", "auth"]);
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both of its ends are back", async () => {
  const p = freshProject();
  card(p, "root", "Root");
  card(p, "a", "Branch A", { parent: "root" });
  card(p, "b", "Branch B", { parent: "root" });
  card(p, "login", "Login", { parent: "a" });
  card(p, "session", "Session", { parent: "b" });
  await ok(p, ["link", "login", "session", "--type", "depends_on", "--why", "login opens a session"]);

  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const login = await p.werk(["show", "login"]);
  expect(login.code).toBe(0);
  expect(login.out).not.toContain("session");
  expect(graphHasEdge(p, "login", "session")).toBe(false);

  await ok(p, ["restore", "session", "--actor", "you"]);
  expect(await ok(p, ["show", "login"])).toMatch(/-> depends_on\s+session/);
  expect(graphHasEdge(p, "login", "session")).toBe(true);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const p = freshProject();
  card(p, "root", "Root");
  card(p, "login", "Login", { parent: "root" });
  card(p, "billing", "Billing", { parent: "root" });
  seed(p, "node.added", { id: "rfc-6749", kind: "source", title: "RFC 6749", finding: "OAuth 2.0" });
  seed(p, "edge.added", { from: "login", to: "rfc-6749", type: "supported_by" });
  seed(p, "edge.added", { from: "billing", to: "rfc-6749", type: "supported_by" });

  await ok(p, ["remove", "login", "--actor", "you"]);
  const source = await ok(p, ["show", "rfc-6749"]);
  expect(source).toMatch(/<- supported_by\s+billing/);
  expect(source).not.toContain("login");

  const before = lines(p).length;
  const add = await p.werk(["add", "login", "--title", "A new login", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  expect(add.err + add.out).toMatch(/restore #?login/);
  expect(lines(p).length).toBe(before);
  expect(shapeRead(readMap("test", logOf(p))).nodes.some((n) => n.id === "login")).toBe(false);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const p = freshProject();
  card(p, "root", "Root");
  card(p, "login", "Login", { parent: "root" });
  const before = lines(p).length;
  const run = await p.werk(["remove", "login"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toMatch(/refused/);
  expect(await inAnyView(p, "login")).toBe(true);
  expect(lines(p).length).toBe(before);
});

test("08.6 restore refuses without the person's say-so", async () => {
  const p = freshProject();
  card(p, "root", "Root");
  card(p, "login", "Login", { parent: "root" });
  await ok(p, ["remove", "login", "--actor", "you"]);
  const before = lines(p).length;
  const run = await p.werk(["restore", "login"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toMatch(/refused/);
  expect(await inAnyView(p, "login")).toBe(false);
  expect(lines(p).length).toBe(before);
});

test("09.1 an agent lists the index of decided cards", async () => {
  const p = freshProject();
  card(p, "root", "Root");
  for (const [id, title] of [
    ["d1", "Decided one"],
    ["d2", "Decided two"],
    ["d3", "Decided three"],
  ] as const) {
    card(p, id, title, { parent: "root" });
    seed(p, "node.decided", { id });
  }
  card(p, "open1", "Open one", { parent: "root" });
  seed(p, "node.proposed", { id: "ghost1", kind: "card", title: "Ghost one", parent: "root" });
  seed(p, "node.decided", { id: "ghost1" });

  const out = await ok(p, ["search"]);
  const rows = out.trim().split("\n");
  for (const [id, title] of [
    ["d1", "Decided one"],
    ["d2", "Decided two"],
    ["d3", "Decided three"],
  ])
    expect(rows.filter((r) => r.includes(id) && r.includes(title))).toHaveLength(1);
  expect(out).not.toContain("open1");
  expect(out).not.toContain("Open one");
  expect(out).not.toContain("ghost1");
  expect(out).not.toContain("Ghost one");
});

test("09.2 an agent searches with two terms and sees the best match first", async () => {
  const p = freshProject();
  card(p, "root", "Root");
  card(p, "cache-layout", "Cache layout", {
    parent: "root",
    body: "Cache eviction runs on a timer. The eviction policy is LRU.",
  });
  seed(p, "node.decided", { id: "cache-layout" });
  card(p, "eviction-timer", "Eviction timer", { parent: "root", why: "eviction must run", body: "CACHE warmup" });
  card(p, "cache-size", "Cache size", { parent: "root", body: "The cache holds 100 entries." });
  seed(p, "node.decided", { id: "cache-size" });
  card(p, "gone", "Gone card", { parent: "root", body: "cache eviction" });
  await ok(p, ["remove", "gone", "--actor", "you"]);

  const out = await ok(p, ["search", "cache", "eviction"]);
  const rows = out.trim().split("\n");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain("cache-layout");
  expect(rows[0]).toContain("decided");
  expect(rows[0]).toContain("Cache layout");
  expect(rows[1]).toContain("eviction-timer");
  expect(rows[1]).toContain("open");
  expect(rows[1]).toContain("Eviction timer");
  expect(out).not.toContain("Cache size");
  expect(out).not.toContain("gone");
});

test("09.3 an agent finds a card by a word in a rejected option and narrows the search", async () => {
  const p = freshProject();
  card(p, "root", "Root");
  card(p, "parent-topic", "Parent topic", { parent: "root" });
  seed(p, "node.decided", { id: "parent-topic" });
  card(p, "storage-format", "Storage format", { parent: "parent-topic", body: "One JSON line per event." });
  seed(p, "node.decided", { id: "storage-format" });
  seed(p, "node.added", {
    id: "storage-format:opt0",
    kind: "option",
    title: "A database file",
    why_not: "SQLite needs a native build",
  });
  seed(p, "edge.added", { from: "storage-format:opt0", to: "storage-format", type: "alternative_to" });
  card(p, "other-open", "Other open card", { parent: "root", body: "maybe sqlite later" });

  const all = await ok(p, ["search", "sqlite"]);
  expect(all.split("\n").some((r) => r.includes("storage-format") && r.includes("decided"))).toBe(true);
  expect(all).toContain("other-open");

  const under = await ok(p, ["search", "sqlite", "--under", "parent-topic"]);
  expect(under.trim().split("\n")).toHaveLength(1);
  expect(under).toContain("storage-format");

  const decided = await ok(p, ["search", "sqlite", "--status", "decided"]);
  expect(decided.trim().split("\n")).toHaveLength(1);
  expect(decided).toContain("storage-format");
});

test("09.4 an agent finds the open work under one card", async () => {
  const p = freshProject();
  card(p, "root", "Root");
  card(p, "client", "Client", { parent: "root" });
  seed(p, "node.decided", { id: "client" });
  card(p, "routing", "Routing", { parent: "client" });
  card(p, "theme", "Theme", { parent: "client", status: "proto" });
  card(p, "route-guards", "Route guards", { parent: "routing" });
  // Bases elsewhere in the map whose reopens mark cards under Client.
  card(p, "other", "Other tree");
  card(p, "base-inv", "Base invalidated", { parent: "other" });
  seed(p, "node.decided", { id: "base-inv" });
  card(p, "base-post", "Base postponed", { parent: "other" });
  seed(p, "node.decided", { id: "base-post" });
  card(p, "paused-card", "Paused card", { parent: "client" });
  seed(p, "edge.added", { from: "paused-card", to: "base-post", type: "depends_on", why: "needs it" });
  card(p, "stale-card", "Stale card", { parent: "client" });
  seed(p, "edge.added", { from: "stale-card", to: "base-inv", type: "depends_on", why: "needs it" });
  card(p, "postponed-card", "Postponed card", { parent: "client" });
  seed(p, "node.decided", { id: "postponed-card" });
  seed(p, "node.reopened", { id: "postponed-card", reason: "postponed", why: "later" });
  seed(p, "node.reopened", { id: "base-inv", reason: "invalidated", why: "wrong" });
  seed(p, "node.reopened", { id: "base-post", reason: "postponed", why: "later" });
  seed(p, "node.added", { id: "routing:opt0", kind: "option", title: "Hash routing", why_not: "ugly" });
  seed(p, "edge.added", { from: "routing:opt0", to: "routing", type: "alternative_to" });
  seed(p, "node.added", { id: "routing-src", kind: "source", title: "Router docs", finding: "f" });
  seed(p, "edge.added", { from: "routing", to: "routing-src", type: "supported_by" });
  card(p, "billing", "Billing");

  const stale = await ok(p, ["stale"]);
  expect(stale).toContain("stale-card");
  expect(stale).toContain("paused-card");

  const ids = (out: string) =>
    out
      .trim()
      .split("\n")
      .map((r) => r.split(/\s+/)[0]);
  const r = ids(await ok(p, ["find", "routing"]));
  expect(r[0]).toBe("routing");
  expect(r).toContain("route-guards");
  expect(r.indexOf("route-guards")).toBeGreaterThan(0);
  for (const id of ["billing", "routing:opt0", "routing-src"]) expect(r).not.toContain(id);

  const c = ids(await ok(p, ["find", "client"]));
  expect(c).toContain("routing");
  expect(c).toContain("theme");
  expect(c).toContain("route-guards");
  expect(c.indexOf("routing")).toBeLessThan(c.indexOf("route-guards"));
  expect(c.indexOf("theme")).toBeLessThan(c.indexOf("route-guards"));
  for (const id of ["client", "paused-card", "stale-card", "postponed-card"]) expect(c).not.toContain(id);
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const p = freshProject();
  card(p, "tree-a", "Tree A");
  seed(p, "node.decided", { id: "tree-a" });
  card(p, "open-a", "Open A", { parent: "tree-a" });
  card(p, "tree-b", "Tree B");
  seed(p, "node.decided", { id: "tree-b" });
  card(p, "open-b", "Open B", { parent: "tree-b" });
  card(p, "auth-flow", "Auth flow", { parent: "tree-a" });
  seed(p, "node.decided", { id: "auth-flow" });
  await ok(p, ["reopen", "auth-flow", "--reason", "rejected", "--why", "wrong approach"]);

  const out = await ok(p, ["find"]);
  const ids = out
    .trim()
    .split("\n")
    .map((r) => r.split(/\s+/)[0]);
  expect(ids).toContain("open-a");
  expect(ids).toContain("open-b");
  expect(ids).toContain("auth-flow");
  expect(out).not.toMatch(/\sdecided\s/);
  expect(ids).not.toContain("tree-a");
  expect(ids).not.toContain("tree-b");
});

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const p = freshProject();
  card(p, "root", "Root");
  seed(p, "node.decided", { id: "root" });
  card(p, "c1", "Child one", { parent: "root" });
  card(p, "c2", "Child two", { parent: "root", status: "proto" });
  card(p, "g1", "Grandchild", { parent: "c2" });
  seed(p, "node.decided", { id: "g1" });

  const out = await ok(p, ["show", "root"]);
  const rollups = out.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(rollups).toHaveLength(1);
  const line = rollups[0] as string;
  expect(line).toContain("4 cards");
  expect(line).toContain("1 open");
  expect(line).toContain("1 proto");
  expect(line).toContain("2 decided");
  const n = (re: RegExp) => Number(re.exec(line)?.[1] ?? 0);
  expect(n(/(\d+) open/) + n(/(\d+) proto/) + n(/(\d+) decided/)).toBe(n(/(\d+) cards?/));
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const p = freshProject();
  card(p, "parent", "Parent");
  card(p, "child", "Child", { parent: "parent" });
  card(p, "g1", "Grand open", { parent: "child" });
  card(p, "g2", "Grand decided", { parent: "child" });
  seed(p, "node.decided", { id: "g2" });

  const out = await ok(p, ["show", "parent"]);
  const link = out.split("\n").find((l) => /<- refines\s+child/.test(l)) ?? "";
  expect(link).not.toBe("");
  expect(link).toContain("3 cards");
  expect(link).not.toContain("4 cards");
  expect(out.split("\n").find((l) => l.startsWith("subtree:"))).toContain("4 cards");
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const p = freshProject();
  card(p, "root", "Root");
  card(p, "basis", "Basis card", { parent: "root" });
  card(p, "subject", "Subject card", { parent: "root" });
  seed(p, "edge.added", {
    from: "subject",
    to: "basis",
    type: "depends_on",
    why: "the subject reuses the basis format",
  });
  seed(p, "node.added", { id: "subject:opt0", kind: "option", title: "Use XML", why_not: "XML is too verbose" });
  seed(p, "edge.added", { from: "subject:opt0", to: "subject", type: "alternative_to" });
  seed(p, "excerpt.quoted", {
    card: "subject",
    id: "subject-quote",
    title: "we keep one log per conversation",
    conversation: "c1",
    session: "s1",
    message: 2,
    start: 0,
    end: 32,
    speaker: "agent",
    said_at: "2026-01-01T00:00:00.000Z",
  });
  seed(p, "node.proposed", { id: "bench", kind: "source", title: "Benchmark notes", finding: "Writes take 2 ms" });
  seed(p, "edge.added", { from: "subject", to: "bench", type: "supported_by" });

  const out = await ok(p, ["show", "subject"]);
  expect(out).toMatch(/-> depends_on\s+basis/);
  expect(out).toContain("the subject reuses the basis format");
  const at = (word: string) => out.split("\n").findIndex((l) => l.trim() === word);
  const lastLink = Math.max(...out.split("\n").map((l, i) => (/^\s+(->|<-) /.test(l) ? i : -1)));
  expect(at("Options")).toBeGreaterThan(lastLink);
  const opts = out.slice(out.indexOf("\nOptions"));
  expect(opts).toContain("Use XML");
  expect(opts).toContain("XML is too verbose");
  expect(at("Say")).toBeGreaterThan(-1);
  const say = out.slice(out.indexOf("\nSay"));
  expect(say).toContain("agent");
  expect(say).toContain("we keep one log per conversation");
  expect(at("Ev")).toBeGreaterThan(-1);
  const ev = out.slice(out.indexOf("\nEv"));
  expect(ev).toContain("Benchmark notes");
  expect(ev).toContain("Writes take 2 ms");
  const benchLine = ev.split("\n").find((l) => l.includes("Benchmark notes")) ?? "";
  expect(benchLine).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  const p = freshProject();
  card(p, "root", "Root");
  card(p, "subject", "Subject card", { parent: "root" });
  seed(p, "excerpt.quoted", {
    card: "subject",
    id: "subject-quote",
    title: "one log per conversation",
    conversation: "c1",
    session: "s1",
    message: 1,
    start: 0,
    end: 24,
    speaker: "you",
    said_at: "2026-01-01T00:00:00.000Z",
  });
  seed(p, "node.added", { id: "bench", kind: "source", title: "Benchmark notes", finding: "fast" });
  seed(p, "edge.added", { from: "subject", to: "bench", type: "supported_by" });

  const out = await ok(p, ["show", "subject"]);
  const heads = out.split("\n").map((l) => l.trim());
  expect(heads).toContain("Say");
  expect(heads).toContain("Ev");
  expect(heads).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  const p = freshProject();
  card(p, "root", "Root card title");
  card(p, "second", "Second card", { parent: "root" });

  const out = await ok(p, ["show"]);
  expect(out).toContain("Root card title");
  expect(out).toMatch(/^subtree: 2 cards/m);
  expect(out).toMatch(/<- refines\s+second\s+Second card\s+\(1 card, 1 open\)/);
});

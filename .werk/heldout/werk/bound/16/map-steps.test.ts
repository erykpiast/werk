// Held-out steps 08.x (remove and restore), 09.x (search and find) and 11.x (show) at the command line.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { head, isGhost, linkLines, type MapProject, mapProject } from "./map-helpers.ts";

const card = (id: string, title: string, extra: object = {}) => ({ id, kind: "card", title, ...extra });

/** Starts `werk serve` on the project and gives its address. */
async function serve(m: MapProject): Promise<string> {
  const proc = m.p.start([process.execPath, join(import.meta.dir, "..", "src", "cli.ts"), "serve", "--port", "0"]);
  const reader = proc.stdout.getReader();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`werk serve ended: ${out}`);
    out += new TextDecoder().decode(value);
    const found = /http:\/\/\S+/.exec(out);
    if (found !== null) return found[0].replace(/\/map$/, "");
  }
}

/** Every command-line view of the map, joined: show of the root, search, find, stale. */
async function views(m: MapProject, root: string): Promise<string> {
  const parts = [
    (await m.w("show", root)).out,
    (await m.w("search")).out,
    (await m.w("search", "login")).out,
    (await m.w("search", "session")).out,
    (await m.w("find")).out,
    (await m.w("stale")).out,
  ];
  return parts.join("\n");
}

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const m = mapProject();
  m.seed("node.added", card("root", "Root", { status: "decided" }));
  m.seed("node.added", card("auth", "Auth", { status: "decided", parent: "root" }));
  m.seed("node.added", card("login", "Login form", { parent: "auth" }));
  m.seed("node.added", card("session", "Session store", { parent: "auth" }));
  m.seed("node.added", card("audit", "Audit trail", { parent: "root" }));
  m.seed("edge.added", { from: "login", to: "audit", type: "depends_on", why: "a login writes an audit line" });
  const url = await serve(m);
  const before = m.lines().length;

  await m.ok("remove", "auth", "--actor", "you");

  const cli = await views(m, "root");
  for (const id of ["auth", "login", "session"]) {
    expect((await m.w("show", id)).code).not.toBe(0);
    expect(cli).not.toMatch(new RegExp(`\\b${id}\\b`));
  }
  const graph = await (await fetch(`${url}/api/graph?shape=1`)).text();
  for (const id of ["auth", "login", "session"]) expect(graph).not.toContain(`"${id}"`);
  for (const id of ["auth", "login", "session"]) expect((await fetch(`${url}/api/card/${id}`)).status).toBe(404);

  const added = m.events().slice(before);
  expect(added.length).toBe(1);
  expect(added[0]?.type).toBe("node.removed");
  const removed = await m.ok("removed");
  expect(removed.out).toContain("auth");
  expect(removed.out).toContain("login");
  expect(removed.out).toContain("session");
  const audit = await m.ok("show", "audit");
  expect(audit.out).not.toContain("login");

  await m.ok("restore", "auth", "--actor", "you");
  const auth = await m.ok("show", "auth");
  expect(linkLines(auth.out).some((l) => l.includes("<- refines") && l.includes("login"))).toBe(true);
  expect(linkLines(auth.out).some((l) => l.includes("<- refines") && l.includes("session"))).toBe(true);
  const audit2 = await m.ok("show", "audit");
  expect(linkLines(audit2.out).some((l) => l.includes("depends_on") && l.includes("login"))).toBe(true);
  const none = await m.ok("removed");
  expect(none.out).not.toContain("auth");
  expect(none.out).not.toContain("login");
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  const m = mapProject();
  m.seed("node.added", card("platform", "Platform", { status: "decided" }));
  m.seed("node.added", card("auth", "Auth", { status: "decided", parent: "platform" }));
  m.seed("node.added", card("login", "Login form", { parent: "auth" }));
  m.seed("node.added", card("session", "Session store", { parent: "auth" }));

  await m.ok("remove", "auth", "--actor", "you", "--reparent");
  expect((await m.w("show", "auth")).code).not.toBe(0);
  const platform = await m.ok("show", "platform");
  const children = linkLines(platform.out).filter((l) => l.includes("<- refines"));
  expect(children.some((l) => l.includes("login"))).toBe(true);
  expect(children.some((l) => l.includes("session"))).toBe(true);
  expect((await m.ok("show", "login")).out).toContain("parent: platform");

  await m.ok("restore", "auth", "--actor", "you");
  const auth = await m.ok("show", "auth");
  expect(auth.out).toContain("parent: platform");
  const p2 = linkLines((await m.ok("show", "platform")).out).filter((l) => l.includes("<- refines"));
  expect(p2.some((l) => l.includes("auth"))).toBe(true);
  expect(p2.some((l) => l.includes("login") || l.includes("session"))).toBe(false);
  const a2 = linkLines(auth.out).filter((l) => l.includes("<- refines"));
  expect(a2.some((l) => l.includes("login"))).toBe(true);
  expect(a2.some((l) => l.includes("session"))).toBe(true);
});

test("08.3 a link waits until both of its ends are back", async () => {
  const m = mapProject();
  m.seed("node.added", card("a", "Branch A"));
  m.seed("node.added", card("b", "Branch B"));
  m.seed("node.added", card("login", "Login form", { parent: "a" }));
  m.seed("node.added", card("session", "Session store", { parent: "b" }));
  m.seed("edge.added", { from: "login", to: "session", type: "depends_on", why: "a login opens a session" });

  await m.ok("remove", "login", "--actor", "you");
  await m.ok("remove", "session", "--actor", "you");
  await m.ok("restore", "login", "--actor", "you");
  const login = await m.ok("show", "login");
  expect(login.out).not.toContain("session");
  await m.ok("restore", "session", "--actor", "you");
  const again = await m.ok("show", "login");
  expect(linkLines(again.out).some((l) => l.includes("depends_on") && l.includes("session"))).toBe(true);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const m = mapProject();
  m.seed("node.added", card("login", "Login form"));
  m.seed("node.added", card("billing", "Billing"));
  m.seed("node.added", {
    id: "rfc-6749",
    kind: "source",
    title: "RFC 6749",
    url: "https://www.rfc-editor.org/rfc/rfc6749",
  });
  m.seed("edge.added", { from: "login", to: "rfc-6749", type: "supported_by" });
  m.seed("edge.added", { from: "billing", to: "rfc-6749", type: "supported_by" });

  await m.ok("remove", "login", "--actor", "you");
  const src = await m.ok("show", "rfc-6749");
  expect(linkLines(src.out).some((l) => l.includes("supported_by") && l.includes("billing"))).toBe(true);

  const before = m.lines().length;
  const add = await m.w("add", "login", "--title", "A new login");
  expect(add.code).not.toBe(0);
  expect(add.err).toContain("restore");
  expect(add.err).toContain("login");
  expect(m.lines().length).toBe(before);
  expect((await m.w("show", "login")).code).not.toBe(0);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const m = mapProject();
  m.seed("node.added", card("login", "Login form"));
  const before = m.lines().length;
  const run = await m.w("remove", "login");
  expect(run.code).not.toBe(0);
  expect((await m.w("show", "login")).code).toBe(0);
  expect(m.lines().length).toBe(before);
});

test("08.6 restore refuses without the person's say-so", async () => {
  const m = mapProject();
  m.seed("node.added", card("login", "Login form"));
  await m.ok("remove", "login", "--actor", "you");
  const before = m.lines().length;
  const run = await m.w("restore", "login");
  expect(run.code).not.toBe(0);
  expect((await m.w("show", "login")).code).not.toBe(0);
  expect(m.lines().length).toBe(before);
});

test("09.1 an agent lists the index of decided cards", async () => {
  const m = mapProject();
  m.seed("node.added", card("alpha", "Alpha rule", { status: "decided" }));
  m.seed("node.added", card("beta", "Beta rule", { status: "decided" }));
  m.seed("node.added", card("gamma", "Gamma rule", { status: "decided" }));
  m.seed("node.added", card("delta", "Delta question"));
  // A ghost that reached decided while it was a ghost.
  await m.ok("add", "ghosty", "--title", "Ghost rule", "--parent", "alpha");
  await m.ok("edit", "ghosty", "--who", "you");
  await m.ok("edit", "ghosty", "--unchallenged", "nothing else was on the table");
  await m.ok("edit", "ghosty", "--no-basis", "a first rule");
  await m.ok("kill", "ghosty", "--revisit");
  await m.ok("status", "ghosty", "decided");
  expect(head((await m.ok("show", "ghosty")).out)).toContain("[decided]");

  const run = await m.ok("search");
  const lines = run.out.split("\n").filter(Boolean);
  for (const [id, title] of [
    ["alpha", "Alpha rule"],
    ["beta", "Beta rule"],
    ["gamma", "Gamma rule"],
  ])
    expect(lines.filter((l) => l.includes(id) && l.includes(title)).length).toBe(1);
  expect(run.out).not.toContain("delta");
  expect(run.out).not.toContain("Delta question");
  expect(run.out).not.toContain("ghosty");
  expect(run.out).not.toContain("Ghost rule");
});

test("09.2 an agent searches with two terms and sees the best match first", async () => {
  const m = mapProject();
  m.seed(
    "node.added",
    card("cache-layout", "Cache layout", { status: "decided", body: "Cache eviction follows the eviction policy." }),
  );
  m.seed(
    "node.added",
    card("eviction-timer", "Eviction timer", { why: "eviction runs on a timer", body: "CACHE warmup first." }),
  );
  m.seed("node.added", card("cache-size", "Cache size", { status: "decided", body: "The cache holds 100 entries." }));
  m.seed("node.added", card("old-cache", "Old cache eviction", { body: "cache eviction by age" }));
  await m.ok("remove", "old-cache", "--actor", "you");

  const run = await m.ok("search", "cache", "eviction");
  const lines = run.out.split("\n").filter(Boolean);
  expect(lines.length).toBe(2);
  expect(lines[0]).toContain("cache-layout");
  expect(lines[0]).toContain("decided");
  expect(lines[0]).toContain("Cache layout");
  expect(lines[1]).toContain("eviction-timer");
  expect(lines[1]).toContain("open");
  expect(lines[1]).toContain("Eviction timer");
  expect(run.out).not.toContain("cache-size");
  expect(run.out).not.toContain("old-cache");
});

test("09.3 an agent finds a card by a word in a rejected option and narrows the search", async () => {
  const m = mapProject();
  m.seed("node.added", card("parent-topic", "Parent topic", { status: "decided" }));
  m.seed("node.added", card("storage-format", "Storage format", { status: "decided", parent: "parent-topic" }));
  m.seed("node.added", {
    id: "storage-format:opt0",
    kind: "option",
    title: "A database file",
    why_not: "SQLite needs a native build",
  });
  m.seed("edge.added", { from: "storage-format:opt0", to: "storage-format", type: "alternative_to" });
  m.seed("node.added", card("elsewhere", "Embedded store", { body: "Try sqlite here." }));

  const all = await m.ok("search", "sqlite");
  const lines = all.out.split("\n").filter(Boolean);
  expect(lines.some((l) => l.includes("storage-format") && l.includes("decided"))).toBe(true);
  expect(lines.some((l) => l.includes("elsewhere"))).toBe(true);

  const under = await m.ok("search", "sqlite", "--under", "parent-topic");
  const u = under.out.split("\n").filter(Boolean);
  expect(u.length).toBe(1);
  expect(u[0]).toContain("Storage format");

  const decided = await m.ok("search", "sqlite", "--status", "decided");
  const d = decided.out.split("\n").filter(Boolean);
  expect(d.length).toBe(1);
  expect(d[0]).toContain("Storage format");
});

test("09.4 an agent finds the open work under one card", async () => {
  const m = mapProject();
  m.seed("node.added", card("client", "Client", { status: "decided" }));
  m.seed("node.added", card("routing", "Routing", { parent: "client" }));
  m.seed("node.added", card("theme", "Theme", { status: "proto", parent: "client" }));
  m.seed("node.added", card("route-guards", "Route guards", { parent: "routing" }));
  m.seed("node.added", card("upstream-p", "Upstream to postpone", { status: "decided" }));
  m.seed("node.added", card("upstream-s", "Upstream to invalidate", { status: "decided" }));
  m.seed("node.added", card("paused-card", "Paused card", { parent: "client" }));
  m.seed("node.added", card("stale-card", "Stale card", { parent: "client" }));
  m.seed("node.added", card("postponed-card", "Postponed card", { status: "decided", parent: "client" }));
  m.seed("edge.added", { from: "paused-card", to: "upstream-p", type: "depends_on", why: "w" });
  m.seed("edge.added", { from: "stale-card", to: "upstream-s", type: "depends_on", why: "w" });
  m.seed("node.added", { id: "routing:opt0", kind: "option", title: "Hash routing", why_not: "ugly addresses" });
  m.seed("edge.added", { from: "routing:opt0", to: "routing", type: "alternative_to" });
  m.seed("node.added", { id: "router-docs", kind: "source", title: "Router docs", finding: "history API" });
  m.seed("edge.added", { from: "routing", to: "router-docs", type: "supported_by" });
  m.seed("node.added", card("billing", "Billing"));
  await m.ok("reopen", "upstream-p", "--reason", "postponed");
  await m.ok("reopen", "upstream-s", "--reason", "invalidated");
  await m.ok("reopen", "postponed-card", "--reason", "postponed");
  const stale = (await m.ok("stale")).out;
  expect(stale).toContain("paused-card");
  expect(stale).toContain("stale-card");

  const r = await m.ok("find", "routing");
  const ids = r.out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split(/\s+/)[0]);
  expect(ids[0]).toBe("routing");
  expect(ids.indexOf("route-guards")).toBeGreaterThan(0);
  for (const not of ["billing", "routing:opt0", "router-docs"]) expect(ids).not.toContain(not);

  const c = await m.ok("find", "client");
  const cids = c.out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split(/\s+/)[0]);
  expect(cids.indexOf("routing")).toBeGreaterThanOrEqual(0);
  expect(cids.indexOf("theme")).toBeGreaterThanOrEqual(0);
  expect(cids.indexOf("routing")).toBeLessThan(cids.indexOf("route-guards"));
  expect(cids.indexOf("theme")).toBeLessThan(cids.indexOf("route-guards"));
  for (const not of ["client", "paused-card", "stale-card", "postponed-card"]) expect(cids).not.toContain(not);
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const m = mapProject();
  m.seed("node.added", card("tree-a", "Tree A", { status: "decided" }));
  m.seed("node.added", card("open-a", "Open in A", { parent: "tree-a" }));
  m.seed("node.added", card("tree-b", "Tree B", { status: "decided" }));
  m.seed("node.added", card("open-b", "Open in B", { parent: "tree-b" }));
  m.seed("node.added", card("auth-flow", "Auth flow", { status: "decided", parent: "tree-a" }));
  await m.ok("reopen", "auth-flow", "--reason", "rejected");

  const run = await m.ok("find");
  const lines = run.out.split("\n").filter(Boolean);
  expect(lines.some((l) => l.includes("open-a"))).toBe(true);
  expect(lines.some((l) => l.includes("open-b"))).toBe(true);
  expect(lines.some((l) => l.includes("Auth flow"))).toBe(true);
  expect(lines.some((l) => /\bdecided\b/.test(l))).toBe(false);
  expect(run.out).not.toContain("tree-a");
  expect(run.out).not.toContain("tree-b");
});

const rollupOf = (out: string) => out.split("\n").find((l) => l.startsWith("subtree:")) ?? "";
const count = (line: string, word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(line)?.[1] ?? 0);

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const m = mapProject();
  m.seed("node.added", card("top", "Top", { status: "decided" }));
  m.seed("node.added", card("kid-open", "Open kid", { parent: "top" }));
  m.seed("node.added", card("kid-proto", "Proto kid", { status: "proto", parent: "top" }));
  m.seed("node.added", card("grand", "Grandchild", { status: "decided", parent: "kid-open" }));
  const run = await m.ok("show", "top");
  const rollups = run.out.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(rollups.length).toBe(1);
  const line = rollups[0] ?? "";
  expect(count(line, "cards?")).toBe(4);
  expect(count(line, "open")).toBe(1);
  expect(count(line, "proto")).toBe(1);
  expect(count(line, "decided")).toBe(2);
  expect(count(line, "open") + count(line, "proto") + count(line, "decided")).toBe(count(line, "cards?"));
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const m = mapProject();
  m.seed("node.added", card("parent", "Parent"));
  m.seed("node.added", card("child", "Child", { parent: "parent" }));
  m.seed("node.added", card("g-open", "Open grandchild", { parent: "child" }));
  m.seed("node.added", card("g-decided", "Decided grandchild", { status: "decided", parent: "child" }));
  const run = await m.ok("show", "parent");
  const link = linkLines(run.out).find((l) => l.includes("<- refines") && l.includes("child"));
  expect(link).toBeDefined();
  expect(link).toContain("3 cards");
  expect(count(rollupOf(run.out), "cards?")).toBe(4);
});

/** A chat log of one spoken message, and a quote of it for the card. */
async function excerptFor(m: MapProject, cardId: string): Promise<string> {
  mkdirSync(join(m.p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(m.p.dir, ".werk", "chats", "talk.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "2026-01-01T10:00:00Z", session: "s1", kind: "spoken", text: "keep the log append-only, always" })}\n`,
  );
  const run = await m.ok("quote", cardId, "talk", "keep the log append-only");
  return run.out.split(":").slice(0, 2).join(":");
}

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const m = mapProject();
  m.seed("node.added", card("base", "Base"));
  m.seed("node.added", card("store", "Store"));
  m.seed("edge.added", {
    from: "store",
    to: "base",
    type: "depends_on",
    why: "the store takes its format from the base",
  });
  m.seed("node.added", { id: "store:opt0", kind: "option", title: "A database", why_not: "it needs a server" });
  m.seed("edge.added", { from: "store:opt0", to: "store", type: "alternative_to" });
  await excerptFor(m, "store");
  await m.ok("add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "appends are fast");
  await m.ok("link", "store", "bench", "--type", "supported_by");

  const out = (await m.ok("show", "store")).out;
  const lines = out.split("\n");
  const dep = lines.findIndex((l) => l.includes("depends_on") && l.includes("base"));
  expect(dep).toBeGreaterThanOrEqual(0);
  expect(lines[dep + 1]).toContain("why: the store takes its format from the base");
  const lastLink = Math.max(...lines.map((l, i) => (/^\s+(->|<-)\s/.test(l) ? i : -1)));
  const options = lines.indexOf("Options");
  expect(options).toBeGreaterThan(lastLink);
  expect(lines.slice(options).join("\n")).toContain("A database");
  expect(lines.slice(options).join("\n")).toContain("it needs a server");
  const say = lines.indexOf("Say");
  expect(say).toBeGreaterThan(lastLink);
  const sayText = lines.slice(say).join("\n");
  expect(sayText).toContain("person");
  expect(sayText).toContain("keep the log append-only");
  const ev = lines.indexOf("Ev");
  expect(ev).toBeGreaterThan(lastLink);
  const evLines = lines.slice(ev);
  const srcLine = evLines.find((l) => l.includes("Benchmark notes"));
  expect(srcLine).toContain("proposed");
  expect(evLines.join("\n")).toContain("appends are fast");
});

test("11.4 a card with no options prints no Options section", async () => {
  const m = mapProject();
  m.seed("node.added", card("store", "Store"));
  await excerptFor(m, "store");
  await m.ok("add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "appends are fast");
  await m.ok("link", "store", "bench", "--type", "supported_by");
  const lines = (await m.ok("show", "store")).out.split("\n");
  expect(lines).toContain("Say");
  expect(lines).toContain("Ev");
  expect(lines).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  const m = mapProject();
  m.seed("node.added", card("root", "The root card"));
  m.seed("node.added", card("second", "Second card", { parent: "root" }));
  const out = (await m.ok("show")).out;
  expect(out).toContain("The root card");
  expect(rollupOf(out)).toContain("2 cards");
  const link = linkLines(out).find((l) => l.includes("<- refines") && l.includes("second"));
  expect(link).toContain("1 card");
  expect(isGhost(out)).toBe(false);
});

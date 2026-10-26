// Held-out steps 08 (remove and restore), 09 (search and find) and 11 (show).
import { expect, test } from "bun:test";
import { type P, proj } from "./h.ts";

type Extra = Record<string, unknown>;
/** A real card, seeded as the person's. */
function card(p: P, id: string, title: string, parent?: string, status = "open", extra: Extra = {}): void {
  const s = status === "decided" ? "open" : status;
  p.seed("node.added", { id, kind: "card", title, ...(parent ? { parent } : {}), status: s, ...extra });
  if (status === "decided") p.seed("node.decided", { id });
}
const dep = (p: P, from: string, to: string, why = "needs it") =>
  p.seed("edge.added", { from, to, type: "depends_on", why });
const lines = (out: string) => out.split("\n").filter((l) => l.trim() !== "");
const ids = (out: string) => lines(out).map((l) => l.trim().split(/\s+/)[0]);

/** Every CLI view of the map: show of each id, the index, the find list. */
async function views(p: P, ...shown: string[]): Promise<string> {
  const parts = [await p.w("search"), await p.w("find"), await p.w("search", "--status", "open")];
  for (const id of shown) parts.push(await p.w("show", id));
  return parts.map((r) => r.out + r.err).join("\n");
}

test("08.1", async () => {
  const p = proj();
  card(p, "root", "Root", undefined, "decided");
  card(p, "auth", "Auth", "root", "decided");
  card(p, "login", "Login", "auth");
  card(p, "session", "Session", "auth");
  card(p, "audit", "Audit", "root", "decided");
  dep(p, "login", "audit", "login writes to audit");
  const before = p.log().length;
  await p.ok("remove", "auth", "--actor", "you");
  for (const id of ["auth", "login", "session"]) expect((await p.w("show", id)).code).not.toBe(0);
  const v = await views(p, "root", "audit");
  for (const t of ["Auth", "Login", "Session"]) expect(v).not.toContain(t);
  expect(p.log().length).toBe(before + 1);
  expect(p.events().at(-1)?.type).toBe("node.removed");
  const removed = await p.ok("removed");
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect(await p.ok("show", "audit")).not.toContain("login");
  await p.ok("restore", "auth", "--actor", "you");
  const auth = await p.ok("show", "auth");
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
  expect(await p.ok("show", "audit")).toMatch(/<- depends_on\s+login/);
  const after = await p.ok("removed");
  expect(after).not.toContain("auth");
  expect(after).not.toContain("login");
});

test("08.2", async () => {
  const p = proj();
  card(p, "platform", "Platform", undefined, "decided");
  card(p, "auth", "Auth", "platform", "decided");
  card(p, "login", "Login", "auth");
  card(p, "session", "Session", "auth");
  await p.ok("remove", "auth", "--actor", "you", "--reparent");
  expect((await p.w("show", "auth")).code).not.toBe(0);
  const plat = await p.ok("show", "platform");
  expect(plat).not.toMatch(/refines\s+auth/);
  expect(plat).toMatch(/<- refines\s+login/);
  expect(plat).toMatch(/<- refines\s+session/);
  await p.ok("restore", "auth", "--actor", "you");
  const plat2 = await p.ok("show", "platform");
  expect(plat2).toMatch(/<- refines\s+auth/);
  expect(plat2).not.toMatch(/refines\s+login/);
  expect(plat2).not.toMatch(/refines\s+session/);
  const auth = await p.ok("show", "auth");
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
});

test("08.3", async () => {
  const p = proj();
  card(p, "root", "Root", undefined, "decided");
  card(p, "a", "Branch A", "root", "decided");
  card(p, "b", "Branch B", "root", "decided");
  card(p, "session", "Session", "b", "decided");
  card(p, "login", "Login", "a");
  dep(p, "login", "session", "login opens a session");
  await p.ok("remove", "login", "--actor", "you");
  await p.ok("remove", "session", "--actor", "you");
  await p.ok("restore", "login", "--actor", "you");
  const login = await p.ok("show", "login");
  expect(login).not.toContain("session");
  expect(await p.ok("show", "b")).not.toContain("session");
  await p.ok("restore", "session", "--actor", "you");
  expect(await p.ok("show", "login")).toMatch(/-> depends_on\s+session/);
});

test("08.4", async () => {
  const p = proj();
  card(p, "root", "Root", undefined, "decided");
  card(p, "login", "Login", "root");
  card(p, "billing", "Billing", "root");
  p.seed("node.added", { id: "rfc-6749", kind: "source", title: "OAuth 2.0 RFC 6749", status: "open" });
  p.seed("edge.added", { from: "login", to: "rfc-6749", type: "supported_by" });
  p.seed("edge.added", { from: "billing", to: "rfc-6749", type: "supported_by" });
  await p.ok("remove", "login", "--actor", "you");
  const src = await p.ok("show", "rfc-6749");
  expect(src).toMatch(/<- supported_by\s+billing/);
  expect(await p.ok("show", "billing")).toContain("rfc-6749");
  const before = p.log().length;
  const add = await p.w("add", "login", "--title", "A new login", "--parent", "root");
  expect(add.code).not.toBe(0);
  expect(add.out + add.err).toMatch(/restore/);
  expect(add.out + add.err).toContain("login");
  expect(p.log().length).toBe(before);
  expect((await p.w("show", "login")).code).not.toBe(0);
  expect(await p.ok("show", "root")).not.toContain("A new login");
});

test("08.5", async () => {
  const p = proj();
  card(p, "root", "Root", undefined, "decided");
  card(p, "login", "Login", "root");
  const before = p.log().length;
  const r = await p.w("remove", "login");
  expect(r.code).not.toBe(0);
  expect(await p.ok("show", "login")).toContain("Login");
  expect(await p.ok("show", "root")).toMatch(/<- refines\s+login/);
  expect(p.log().length).toBe(before);
});

test("08.6", async () => {
  const p = proj();
  card(p, "root", "Root", undefined, "decided");
  card(p, "login", "Login", "root");
  await p.ok("remove", "login", "--actor", "you");
  const before = p.log().length;
  const r = await p.w("restore", "login");
  expect(r.code).not.toBe(0);
  expect((await p.w("show", "login")).code).not.toBe(0);
  expect(await p.ok("show", "root")).not.toContain("login");
  expect(p.log().length).toBe(before);
});

test("09.1", async () => {
  const p = proj();
  card(p, "root", "Root card", undefined, "decided");
  card(p, "d1", "Decided one", "root", "decided");
  card(p, "d2", "Decided two", "root", "decided");
  card(p, "o1", "Open one", "root");
  p.seed("node.proposed", { id: "g1", kind: "card", title: "Ghost one", parent: "root", status: "open" });
  p.events(); // the ghost is decided while it is a ghost
  p.seed("node.decided", { id: "g1" });
  const out = await p.ok("search");
  const l = lines(out);
  expect(l.length).toBe(3);
  for (const [id, t] of [
    ["root", "Root card"],
    ["d1", "Decided one"],
    ["d2", "Decided two"],
  ])
    expect(l.some((x) => x.includes(id as string) && x.includes(t as string))).toBe(true);
  expect(out).not.toContain("Open one");
  expect(out).not.toContain("Ghost one");
});

test("09.2", async () => {
  const p = proj();
  card(p, "root", "Root", undefined, "decided");
  card(p, "layout", "Cache layout", "root", "decided", { body: "Cache eviction runs hourly. The eviction policy is LRU." });
  card(p, "timer", "Eviction timer", "root", "open", { why: "eviction must be timed", body: "CACHE warmup first." });
  card(p, "size", "Cache size", "root", "decided", { body: "The cache holds 1 GB." });
  card(p, "gone", "Gone card", "root", "open", { body: "cache eviction elsewhere" });
  await p.ok("remove", "gone", "--actor", "you");
  const out = await p.ok("search", "cache", "eviction");
  const l = lines(out);
  expect(l.length).toBe(2);
  expect(l[0]).toContain("layout");
  expect(l[0]).toContain("decided");
  expect(l[0]).toContain("Cache layout");
  expect(l[1]).toContain("timer");
  expect(l[1]).toContain("open");
  expect(l[1]).toContain("Eviction timer");
  expect(out).not.toContain("Cache size");
  expect(out).not.toContain("Gone card");
});

test("09.3", async () => {
  const p = proj();
  card(p, "root", "Root", undefined, "decided");
  card(p, "parent", "Parent topic", "root", "decided");
  card(p, "storage", "Storage format", "parent", "decided");
  p.seed("node.added", { id: "storage:opt0", kind: "option", title: "A database file", why_not: "SQLite needs a native build", status: "open" });
  p.seed("edge.added", { from: "storage:opt0", to: "storage", type: "alternative_to" });
  card(p, "other", "Other work", "root", "open", { body: "Try sqlite here." });
  const all = await p.ok("search", "sqlite");
  expect(lines(all).some((l) => l.includes("storage") && l.includes("decided") && l.includes("Storage format"))).toBe(true);
  expect(all).toContain("Other work");
  const under = await p.ok("search", "sqlite", "--under", "parent");
  expect(ids(under)).toEqual(["storage"]);
  const dec = await p.ok("search", "sqlite", "--status", "decided");
  expect(ids(dec)).toEqual(["storage"]);
});

test("09.4", async () => {
  const p = proj();
  card(p, "client", "Client", undefined, "decided");
  card(p, "routing", "Routing", "client");
  card(p, "theme", "Theme", "client", "proto");
  card(p, "guards", "Route guards", "routing");
  // Postponed: a decided card reopened as postponed. Paused: a card that depends on it.
  card(p, "later", "Later card", "client", "decided");
  card(p, "paused", "Paused card", "client");
  dep(p, "paused", "later");
  p.seed("node.reopened", { id: "later", reason: "postponed", why: "not now" });
  // Stale: a card whose basis, in another tree, is reopened as invalidated.
  card(p, "upstream", "Upstream", undefined, "decided");
  card(p, "stale", "Stale card", "client");
  dep(p, "stale", "upstream");
  p.seed("node.reopened", { id: "upstream", reason: "invalidated", why: "changed" });
  p.seed("node.added", { id: "routing:opt0", kind: "option", title: "Hash routes", why_not: "ugly", status: "open" });
  p.seed("edge.added", { from: "routing:opt0", to: "routing", type: "alternative_to" });
  p.seed("node.added", { id: "router-doc", kind: "source", title: "Router docs", status: "open" });
  p.seed("edge.added", { from: "routing", to: "router-doc", type: "supported_by" });
  card(p, "broot", "Billing root", undefined, "decided");
  card(p, "billing", "Billing", "broot");
  const marks = await p.ok("stale");
  const r = ids(await p.ok("find", "routing"));
  expect(r[0]).toBe("routing");
  expect(r).toContain("guards");
  expect(r).not.toContain("billing");
  expect(r).not.toContain("routing:opt0");
  expect(r).not.toContain("router-doc");
  const c = ids(await p.ok("find", "client"));
  expect(c.indexOf("routing")).toBeGreaterThanOrEqual(0);
  expect(c.indexOf("theme")).toBeGreaterThanOrEqual(0);
  expect(c.indexOf("routing")).toBeLessThan(c.indexOf("guards"));
  expect(c.indexOf("theme")).toBeLessThan(c.indexOf("guards"));
  expect(c).not.toContain("client");
  expect(marks).toContain("paused");
  expect(marks).toContain("stale");
  expect(c).not.toContain("paused");
  expect(c).not.toContain("stale");
  expect(c).not.toContain("later");
});

test("09.5", async () => {
  const p = proj();
  card(p, "t1", "Tree one", undefined, "decided");
  card(p, "t1open", "Open in one", "t1");
  card(p, "t2", "Tree two", undefined, "decided");
  card(p, "t2open", "Open in two", "t2");
  card(p, "authflow", "Auth flow", "t1", "decided");
  p.seed("node.reopened", { id: "authflow", reason: "rejected", why: "wrong" });
  const out = await p.ok("find");
  const r = ids(out);
  expect(r).toContain("t1open");
  expect(r).toContain("t2open");
  expect(out).toContain("Auth flow");
  expect(r).not.toContain("t1");
  expect(r).not.toContain("t2");
  expect(out).not.toMatch(/\sdecided\s/);
});

const rollup = (out: string) => lines(out).filter((l) => l.startsWith("subtree:"));

test("11.1", async () => {
  const p = proj();
  card(p, "root", "Root", undefined, "decided");
  card(p, "a", "Child A", "root");
  card(p, "b", "Child B", "root", "proto");
  card(p, "g", "Grandchild", "a", "decided");
  const r = rollup(await p.ok("show", "root"));
  expect(r.length).toBe(1);
  const line = r[0] as string;
  expect(line).toMatch(/\b4 cards\b/);
  expect(line).toMatch(/\b1 open\b/);
  expect(line).toMatch(/\b1 proto\b/);
  expect(line).toMatch(/\b2 decided\b/);
  const n = (re: RegExp) => Number(re.exec(line)?.[1] ?? 0);
  expect(n(/(\d+) open/) + n(/(\d+) proto/) + n(/(\d+) decided/)).toBe(n(/(\d+) cards?/));
});

test("11.2", async () => {
  const p = proj();
  card(p, "parent", "Parent", undefined, "open");
  card(p, "child", "Child", "parent");
  card(p, "g1", "Grand one", "child");
  card(p, "g2", "Grand two", "child", "decided");
  const out = await p.ok("show", "parent");
  const link = lines(out).find((l) => /<- refines\s+child/.test(l));
  expect(link).toBeDefined();
  expect(link).toMatch(/\b3 cards\b/);
  expect(rollup(out)[0]).toMatch(/\b4 cards\b/);
});

function excerpt(p: P, id: string, card: string, words: string) {
  p.seed("excerpt.quoted", {
    id,
    card,
    title: words,
    conversation: "c1",
    session: "s1",
    message: 1,
    start: 0,
    end: words.length,
    speaker: "person",
    said_at: "2026-10-01T00:00:00.000Z",
  });
}

test("11.3", async () => {
  const p = proj();
  card(p, "root", "Root", undefined, "decided");
  card(p, "base", "Base card", "root", "decided");
  card(p, "c", "The card", "root");
  dep(p, "c", "base", "the card takes the format from base");
  p.seed("node.added", { id: "c:opt0", kind: "option", title: "Use a queue", why_not: "too slow to drain", status: "open" });
  p.seed("edge.added", { from: "c:opt0", to: "c", type: "alternative_to" });
  excerpt(p, "c-say", "c", "we keep one log");
  await p.ok("add", "bench", "--kind", "source", "--title", "Bench notes", "--finding", "writes take 2 ms");
  await p.ok("link", "c", "bench", "--type", "supported_by");
  const out = await p.ok("show", "c");
  const l = out.split("\n");
  expect(out).toMatch(/depends_on\s+base.*/);
  expect(out).toContain("the card takes the format from base");
  const lastLink = l.findLastIndex((x) => /^\s+(->|<-) /.test(x));
  const opt = l.indexOf("Options");
  expect(opt).toBeGreaterThan(lastLink);
  expect(out).toContain("Use a queue");
  expect(out).toContain("too slow to drain");
  expect(l).toContain("Say");
  expect(out).toContain("person");
  expect(out).toContain('"we keep one log"');
  expect(l).toContain("Ev");
  expect(out).toContain("Bench notes");
  expect(out).toContain("writes take 2 ms");
  expect(l.slice(l.indexOf("Ev")).find((x) => x.includes("Bench notes"))).toContain("proposed");
});

test("11.4", async () => {
  const p = proj();
  card(p, "root", "Root", undefined, "decided");
  card(p, "c", "The card", "root");
  excerpt(p, "c-say", "c", "we keep one log");
  p.seed("node.added", { id: "src", kind: "source", title: "A source", finding: "found it", status: "open" });
  p.seed("edge.added", { from: "c", to: "src", type: "supported_by" });
  const l = (await p.ok("show", "c")).split("\n");
  expect(l).toContain("Say");
  expect(l).toContain("Ev");
  expect(l).not.toContain("Options");
});

test("11.5", async () => {
  const p = proj();
  card(p, "root", "Root title", undefined, "decided");
  card(p, "second", "Second card", "root");
  const out = await p.ok("show");
  expect(out).toContain("Root title");
  expect(rollup(out).length).toBe(1);
  const link = lines(out).find((l) => /<- refines\s+second/.test(l));
  expect(link).toBeDefined();
  expect(link).toMatch(/\b1 card\b/);
});

import { expect, test } from "bun:test";
import { card, events, lines, ok, type Project, seed, w, withRoot } from "./lib.ts";

const dep = (p: Project, from: string, to: string) => seed(p, "edge.added", { from, to, type: "depends_on", why: "needs it" });
const reopen = (p: Project, id: string, reason: string) => seed(p, "node.reopened", { id, reason, why: "because" });

test("09.1 search with no term lists decided cards only", async () => {
  const p = withRoot();
  card(p, "d1", { title: "Decided one" });
  card(p, "d2", { title: "Decided two" });
  card(p, "op", { title: "Open one", status: "open" });
  seed(p, "node.proposed", { id: "gh", kind: "card", title: "Ghost decided", parent: "root", status: "decided" });
  const out = (await ok(p, "search")).out;
  const ls = out.split("\n").filter(Boolean);
  // root is a decided card as well: three decided cards besides root, one line each with id and title
  for (const [id, t] of [["d1", "Decided one"], ["d2", "Decided two"]]) expect(ls.some((l) => l.includes(id) && l.includes(t))).toBe(true);
  expect(out).not.toContain("op");
  expect(out).not.toContain("Open one");
  expect(out).not.toContain("gh");
  expect(out).not.toContain("Ghost decided");
});

test("09.1b three decided cards in total (no root decided)", async () => {
  const p = withRoot();
  // root is decided in withRoot; the step counts three decided cards, so make root open
  const q = (await import("./lib.ts")).freshProject();
  card(q, "root", { title: "Root", parent: undefined, status: "open" });
  card(q, "d1", { title: "Decided one" });
  card(q, "d2", { title: "Decided two" });
  card(q, "d3", { title: "Decided three" });
  card(q, "op", { title: "Open one", status: "open" });
  seed(q, "node.proposed", { id: "gh", kind: "card", title: "Ghost decided", parent: "root", status: "decided" });
  const ls = (await ok(q, "search")).out.split("\n").filter(Boolean);
  expect(ls.length).toBe(3);
  expect(ls.join("\n")).not.toContain("gh");
  void p;
});

test("09.2 search with two terms, best match first", async () => {
  const p = withRoot();
  card(p, "cache-layout", { title: "Cache layout", body: "Cache eviction\n\neviction policy" });
  card(p, "evt", { title: "Eviction timer", status: "open", why: "eviction", body: "CACHE warmup" });
  card(p, "csize", { title: "Cache size", body: "cache" });
  card(p, "gone", { title: "g", body: "cache eviction" });
  await ok(p, "remove", "gone", "--actor", "you");
  const out = (await ok(p, "search", "cache", "eviction")).out.split("\n").filter(Boolean);
  expect(out.length).toBe(2);
  expect(out[0]).toMatch(/cache-layout\s+decided\s+Cache layout/);
  expect(out[1]).toMatch(/evt\s+open\s+Eviction timer/);
});

test("09.3 search finds a card by a word in a rejected option; narrows by --under and --status", async () => {
  const p = withRoot();
  card(p, "parent", { title: "Parent topic" });
  card(p, "storage", { title: "Storage format", parent: "parent" });
  seed(p, "node.added", { id: "storage:opt0", kind: "option", title: "SQLite", why_not: "SQLite needs a native build" });
  seed(p, "edge.added", { from: "storage:opt0", to: "storage", type: "alternative_to" });
  card(p, "outside", { title: "Outside", status: "open", body: "we could use sqlite here" });
  const a = (await ok(p, "search", "sqlite")).out;
  expect(a).toMatch(/storage\s+decided\s+Storage format/);
  expect(a).toMatch(/outside\s+open/);
  const b = (await ok(p, "search", "sqlite", "--under", "parent")).out;
  expect(b).toContain("storage");
  expect(b).not.toContain("outside");
  const c = (await ok(p, "search", "sqlite", "--status", "decided")).out;
  expect(c).toContain("storage");
  expect(c).not.toContain("outside");
});

test("09.4 find lists open work under a card", async () => {
  const p = withRoot();
  card(p, "client", { title: "Client" });
  card(p, "a1", { title: "A1" });
  card(p, "a2", { title: "A2" });
  card(p, "routing", { title: "Routing", parent: "client", status: "open" });
  card(p, "theme", { title: "Theme", parent: "client", status: "proto" });
  card(p, "guards", { title: "Route guards", parent: "routing", status: "open" });
  card(p, "paused", { title: "Paused card", parent: "client", status: "open" });
  card(p, "stale", { title: "Stale card", parent: "client", status: "open" });
  card(p, "postponed", { title: "Postponed card", parent: "client" });
  dep(p, "paused", "a1");
  dep(p, "stale", "a2");
  seed(p, "node.added", { id: "routing:opt0", kind: "option", title: "OptX", why_not: "no" });
  seed(p, "edge.added", { from: "routing:opt0", to: "routing", type: "alternative_to" });
  seed(p, "node.added", { id: "src", kind: "source", title: "SrcX" });
  seed(p, "edge.added", { from: "routing", to: "src", type: "supported_by" });
  card(p, "billing", { title: "Billing", status: "open" });
  reopen(p, "a1", "postponed");
  reopen(p, "a2", "rejected");
  reopen(p, "postponed", "postponed");
  const r = (await ok(p, "find", "routing")).out;
  expect(r.indexOf("Routing")).toBeGreaterThanOrEqual(0);
  expect(r.indexOf("Routing")).toBeLessThan(r.indexOf("Route guards"));
  expect(r).not.toContain("Billing");
  expect(r).not.toContain("OptX");
  expect(r).not.toContain("SrcX");
  const c = (await ok(p, "find", "client")).out;
  expect(c.indexOf("Routing")).toBeLessThan(c.indexOf("Route guards"));
  expect(c.indexOf("Theme")).toBeLessThan(c.indexOf("Route guards"));
  expect(c).not.toMatch(/\bClient\b/);
  for (const t of ["Paused card", "Stale card", "Postponed card"]) expect(c).not.toContain(t);
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const p = withRoot();
  card(p, "how", { title: "How", parent: undefined });
  card(p, "r1", { title: "Root work", status: "open" });
  card(p, "h1", { title: "How work", status: "open", parent: "how" });
  card(p, "auth", { title: "Auth flow" });
  reopen(p, "auth", "rejected");
  const out = (await ok(p, "find")).out;
  expect(out).toContain("Root work");
  expect(out).toContain("How work");
  expect(out).toContain("Auth flow");
  expect(out).not.toMatch(/decided/);
});

test("66.4 find lists the open cards it can work on in a subtree", async () => {
  const p = withRoot();
  card(p, "storage", { title: "Storage" });
  for (const id of ["cache", "index", "backup", "quota"]) card(p, id, { title: id, parent: "storage", status: "open" });
  card(p, "pa", { title: "pa" });
  card(p, "pb", { title: "pb" });
  dep(p, "backup", "pa");
  dep(p, "quota", "pb");
  card(p, "outside", { title: "outside", status: "open" });
  reopen(p, "pa", "postponed");
  reopen(p, "pb", "rejected");
  const out = (await ok(p, "find", "storage")).out;
  expect(out).toContain("cache");
  expect(out).toContain("index");
  expect(out).not.toContain("backup");
  expect(out).not.toContain("quota");
  expect(out).not.toContain("outside");
});

test("11.1 / 11.2 rollup counts", async () => {
  const p = withRoot();
  card(p, "c1", { title: "C1", status: "open" });
  card(p, "c2", { title: "C2", status: "proto" });
  card(p, "g", { title: "G", parent: "c1" });
  const out = (await ok(p, "show", "root")).out;
  expect(out).toMatch(/subtree: 4 cards, 1 open, 1 proto, 2 decided/);
  const q = withRoot();
  card(q, "parent", { title: "Parent" });
  card(q, "child", { title: "Child", parent: "parent" });
  card(q, "g1", { title: "G1", parent: "child", status: "open" });
  card(q, "g2", { title: "G2", parent: "child" });
  const s = (await ok(q, "show", "parent")).out;
  expect(s).toMatch(/subtree: 4 cards/);
  expect(s).toMatch(/<- refines\s+child\s+Child\s+\(3 cards/);
});

test("11.3 card prints options, excerpts, proposed source words", async () => {
  const p = withRoot();
  card(p, "basis", { title: "Basis" });
  card(p, "c", { title: "The card" });
  dep(p, "c", "basis");
  seed(p, "node.added", { id: "c:opt0", kind: "option", title: "Option title", why_not: "option why-not" });
  seed(p, "edge.added", { from: "c:opt0", to: "c", type: "alternative_to" });
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", "k.jsonl"), `${JSON.stringify({ speaker: "person", at: "t", session: "s", kind: "spoken", text: "exact verbatim words" })}\n`);
  await ok(p, "quote", "c", "k", "exact verbatim words");
  await ok(p, "accept", "c:ex0", "--actor", "you");
  await ok(p, "add", "src", "--kind", "source", "--title", "Source title", "--finding", "Source finding");
  await ok(p, "link", "c", "src", "--type", "supported_by");
  const out = (await ok(p, "show", "c")).out;
  expect(out).toMatch(/depends_on\s+basis/);
  expect(out).toContain("why: needs it");
  expect(out.indexOf("Options")).toBeGreaterThan(out.indexOf("depends_on"));
  expect(out).toContain("Option title");
  expect(out).toContain("why not: option why-not");
  expect(out).toContain("Say");
  expect(out).toContain("person");
  expect(out).toContain("exact verbatim words");
  expect(out).toContain("Ev");
  expect(out).toContain("Source title");
  expect(out).toContain("finding: Source finding");
  expect(out).toMatch(/src\s+Source title\s+proposed/);
});

test("11.4 no options, no Options section", async () => {
  const p = withRoot();
  card(p, "c", { title: "C" });
  seed(p, "node.added", { id: "src", kind: "source", title: "Src", finding: "f" });
  seed(p, "edge.added", { from: "c", to: "src", type: "supported_by" });
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", "k.jsonl"), `${JSON.stringify({ speaker: "person", at: "t", session: "s", kind: "spoken", text: "said words" })}\n`);
  await ok(p, "quote", "c", "k", "said words");
  await ok(p, "accept", "c:ex0", "--actor", "you");
  const out = (await ok(p, "show", "c")).out;
  expect(out).toContain("Say");
  expect(out).toContain("Ev");
  expect(out).not.toContain("Options");
});

test("11.5 show with no id prints root with rollup and incoming refines", async () => {
  const p = withRoot();
  card(p, "second", { title: "Second card" });
  const out = (await ok(p, "show")).out;
  expect(out).toContain("Root");
  expect(out).toMatch(/subtree: 2 cards/);
  expect(out).toMatch(/<- refines\s+second\s+Second card\s+\(1 card/);
});

test("68.1 say writes a note event and show prints it", async () => {
  const p = withRoot();
  card(p, "werk-chat", { title: "The composer sends a live agent turn" });
  const n = lines(p).length;
  const r = await w(p, "say", "#werk-chat", "The reply streams over SSE");
  expect(r.code).toBe(0);
  const ev = events(p).slice(n);
  expect(ev.length).toBe(1);
  expect(ev[0]!.type).toBe("note.added");
  expect(ev[0]!.payload.id).toBe("werk-chat");
  expect((await ok(p, "show", "#werk-chat")).out).toContain("The reply streams over SSE");
});

test("68.2 inbox shows a group for the card with the agent's notes in order", async () => {
  const p = withRoot();
  card(p, "werk-chat", { title: "Chat" });
  for (const t of ["first", "second", "third"]) await ok(p, "say", "werk-chat", t);
  const out = (await ok(p, "inbox")).out;
  expect(out).toContain("#werk-chat");
  expect(out.indexOf("first")).toBeGreaterThanOrEqual(0);
  expect(out.indexOf("first")).toBeLessThan(out.indexOf("second"));
  expect(out.indexOf("second")).toBeLessThan(out.indexOf("third"));
});

test("68.3 inbox groups notes by card", async () => {
  const p = withRoot();
  card(p, "werk-chat", { title: "Chat" });
  card(p, "visual", { title: "Visual" });
  await ok(p, "say", "werk-chat", "chat one");
  await ok(p, "say", "visual", "visual one");
  await ok(p, "say", "werk-chat", "chat two");
  const out = (await ok(p, "inbox")).out;
  expect(out.indexOf("chat one")).toBeGreaterThanOrEqual(0);
  // grouped: chat one then chat two, then visual one
  expect(out.indexOf("chat two")).toBeLessThan(out.indexOf("visual one"));
  expect(out.indexOf("chat one")).toBeLessThan(out.indexOf("chat two"));
});

test("68.4 note on a ghost card appears in the inbox", async () => {
  const p = withRoot();
  card(p, "visual", { title: "Visual" });
  seed(p, "node.proposed", { id: "werk-pane", kind: "card", title: "Pane", parent: "root" }, "agent");
  seed(p, "edge.added", { from: "visual", to: "werk-pane", type: "depends_on", why: "needs the pane" });
  const r = await w(p, "say", "werk-pane", "Describe the pane here");
  expect(r.code).toBe(0);
  const out = (await ok(p, "inbox")).out;
  expect(out).toContain("#werk-pane");
  expect(out).toContain("Describe the pane here");
});

test("68.5 note on unknown card fails, changes nothing", async () => {
  const p = withRoot();
  card(p, "werk-chat", { title: "Chat" });
  const n = lines(p).length;
  const r = await w(p, "say", "#no-such-card", "lost note");
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no-such-card");
  expect(lines(p).length).toBe(n);
  expect((await ok(p, "inbox")).out).not.toContain("lost note");
});

test("10.2 inbox since and cap (person's notes)", async () => {
  const p = withRoot();
  card(p, "auth-login", { title: "Login" });
  for (const t of ["first", "second", "third", "fourth"]) seed(p, "note.added", { id: "auth-login", text: t }, "you");
  const all = (await ok(p, "inbox")).out;
  const pos = [...all.matchAll(/^\[(\d+)\] #(\S+)/gm)];
  expect(pos.length).toBe(4);
  expect(pos.every((m) => m[2] === "auth-login")).toBe(true);
  expect(all.indexOf("first")).toBeLessThan(all.indexOf("second"));
  expect(all.indexOf("third")).toBeLessThan(all.indexOf("fourth"));
  const first = pos[0]![1]!;
  const since = (await ok(p, "inbox", "--since", first)).out;
  expect(since).not.toContain("first");
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(t);
  const capped = (await ok(p, "inbox", "--since", first, "-n", "2")).out;
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
});

test("10.5 say on an excerpt succeeds and shows on its thread", async () => {
  const p = withRoot();
  card(p, "c", { title: "C" });
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", "k.jsonl"), `${JSON.stringify({ speaker: "person", at: "t", session: "s", kind: "spoken", text: "an rfc quote" })}\n`);
  await ok(p, "quote", "c", "k", "an rfc quote");
  await ok(p, "accept", "c:ex0", "--actor", "you");
  const r = await w(p, "say", "c:ex0", "This quote supports the retry decision");
  expect(r.code).toBe(0);
  expect((await ok(p, "show", "c:ex0")).out).toContain("This quote supports the retry decision");
});

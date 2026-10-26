// Held-out tests for steps 09.1-09.5 and 11.1-11.5: search, find and show at the command line.
import { expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

type E = { type: string; actor?: string; payload: Record<string, unknown> };

function seeded(events: E[]): Project {
  const project = freshProject();
  const text = events
    .map((e, i) => JSON.stringify({ seq: i + 1, at: "2026-10-01T09:00:00Z", actor: e.actor ?? "you", type: e.type, payload: e.payload }))
    .join("\n");
  appendFileSync(join(project.dir, ".werk", "log.jsonl"), `${text}\n`);
  return project;
}
const card = (id: string, title: string, extra: Record<string, unknown> = {}): E => ({
  type: "node.added",
  payload: { id, kind: "card", title, ...extra },
});
const edge = (from: string, to: string, type: string, why?: string): E => ({
  type: "edge.added",
  payload: { from, to, type, ...(why && { why }) },
});

async function ok(project: Project, args: string[]) {
  const run = await project.werk(args);
  expect(run.err).not.toContain("set aside");
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run.out;
}
const ids = (out: string) => out.split("\n").filter(Boolean).map((l) => l.split(/\s+/)[0]);

test("09.1 search with no term lists the decided cards only", async () => {
  const p = seeded([
    card("root", "Shop", { status: "decided" }),
    card("pay", "Payments are by card", { status: "decided", parent: "root" }),
    card("ship", "Shipping is flat rate", { status: "decided", parent: "root" }),
    card("tax", "Tax is open question", { status: "open", parent: "root" }),
    { type: "node.proposed", actor: "agent", payload: { id: "gho", kind: "card", title: "Ghost idea", status: "decided", parent: "root" } },
  ]);
  const out = await ok(p, ["search"]);
  const lines = out.split("\n").filter(Boolean);
  expect(lines).toHaveLength(3);
  expect(out).toContain("root");
  expect(out).toContain("Shop");
  expect(out).toContain("pay");
  expect(out).toContain("Payments are by card");
  expect(out).toContain("ship");
  expect(out).toContain("Shipping is flat rate");
  expect(out).not.toContain("tax");
  expect(out).not.toContain("gho");
});

test("09.2 search with two terms ranks the best match first", async () => {
  const p = seeded([
    card("root", "Root", { status: "decided" }),
    card("layout", "Cache layout", { status: "decided", parent: "root", body: "Cache eviction uses an eviction policy." }),
    card("timer", "Eviction timer", { status: "open", parent: "root", why: "eviction must run", body: "CACHE warmup first." }),
    card("size", "Cache size", { status: "decided", parent: "root", body: "The cache is small." }),
    card("gone", "Gone card", { status: "decided", parent: "root", body: "cache eviction" }),
    { type: "node.removed", payload: { id: "gone" } },
  ]);
  const out = await ok(p, ["search", "cache", "eviction"]);
  const lines = out.split("\n").filter(Boolean);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/^layout\s+decided\s+Cache layout$/);
  expect(lines[1]).toMatch(/^timer\s+open\s+Eviction timer$/);
  expect(out).not.toContain("Cache size");
  expect(out).not.toContain("gone");
});

test("09.3 search finds a word in a rejected option and narrows by subtree and status", async () => {
  const p = seeded([
    card("root", "Root", { status: "decided" }),
    card("parent", "Parent topic", { status: "decided", parent: "root" }),
    card("storage", "Storage format", { status: "decided", parent: "parent" }),
    { type: "node.added", payload: { id: "storage:opt0", kind: "option", title: "Embedded DB", why_not: "SQLite needs a native build" } },
    edge("storage:opt0", "storage", "alternative_to"),
    card("other", "Other work", { status: "open", parent: "root", body: "maybe sqlite here" }),
  ]);
  const all = await ok(p, ["search", "sqlite"]);
  expect(all).toMatch(/^storage\s+decided\s+Storage format$/m);
  expect(all).toMatch(/^other\s+open\s+Other work$/m);
  expect(ids(await ok(p, ["search", "sqlite", "--under", "parent"]))).toEqual(["storage"]);
  expect(ids(await ok(p, ["search", "sqlite", "--status", "decided"]))).toEqual(["storage"]);
});

function findMap(): Project {
  return seeded([
    card("root", "Root", { status: "decided" }),
    card("up", "Upstream", { status: "decided", parent: "root" }),
    card("up-post", "Upstream postponed", { status: "decided", parent: "up" }),
    card("up-rej", "Upstream rejected", { status: "decided", parent: "up" }),
    card("client", "Client", { status: "decided", parent: "root" }),
    card("routing", "Routing", { status: "open", parent: "client" }),
    card("theme", "Theme", { status: "proto", parent: "client" }),
    card("guards", "Route guards", { status: "open", parent: "routing" }),
    card("c-paused", "Paused work", { status: "open", parent: "client" }),
    edge("c-paused", "up-post", "depends_on", "needs it"),
    card("c-stale", "Stale work", { status: "open", parent: "client" }),
    edge("c-stale", "up-rej", "depends_on", "needs it"),
    card("c-post", "Postponed work", { status: "decided", parent: "client" }),
    { type: "node.reopened", payload: { id: "up-post", reason: "postponed" } },
    { type: "node.reopened", payload: { id: "up-rej", reason: "rejected" } },
    { type: "node.reopened", payload: { id: "c-post", reason: "postponed" } },
    { type: "node.added", payload: { id: "routing:opt0", kind: "option", title: "Hash routes", why_not: "ugly" } },
    edge("routing:opt0", "routing", "alternative_to"),
    { type: "node.added", payload: { id: "src1", kind: "source", title: "Router doc", finding: "works" } },
    edge("routing", "src1", "supported_by"),
    card("billing", "Billing", { status: "open", parent: "root" }),
  ]);
}

test("09.4 find lists the open work under one card", async () => {
  const p = findMap();
  const stale = await ok(p, ["stale"]);
  expect(stale).toContain("c-paused");
  expect(stale).toContain("c-stale");
  const r = ids(await ok(p, ["find", "routing"]));
  expect(r[0]).toBe("routing");
  expect(r).toContain("guards");
  expect(r.indexOf("guards")).toBeGreaterThan(0);
  expect(r).not.toContain("billing");
  expect(r).not.toContain("routing:opt0");
  expect(r).not.toContain("src1");
  const c = ids(await ok(p, ["find", "client"]));
  expect(c).toContain("routing");
  expect(c).toContain("theme");
  expect(c.indexOf("routing")).toBeLessThan(c.indexOf("guards"));
  expect(c.indexOf("theme")).toBeLessThan(c.indexOf("guards"));
  expect(c).not.toContain("client");
  expect(c).not.toContain("c-paused");
  expect(c).not.toContain("c-stale");
  expect(c).not.toContain("c-post");
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const p = seeded([
    card("t1", "Tree one", { status: "decided" }),
    card("o1", "Open one", { status: "open", parent: "t1" }),
    card("t2", "Tree two", { status: "decided" }),
    card("o2", "Open two", { status: "open", parent: "t2" }),
    card("auth", "Auth flow", { status: "decided", parent: "t2" }),
    { type: "node.reopened", payload: { id: "auth", reason: "rejected" } },
  ]);
  const out = ids(await ok(p, ["find"]));
  expect(out).toContain("o1");
  expect(out).toContain("o2");
  expect(out).toContain("auth");
  expect(out).not.toContain("t1");
  expect(out).not.toContain("t2");
});

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const p = seeded([
    card("root", "Root", { status: "decided" }),
    card("a", "Child A", { status: "open", parent: "root" }),
    card("b", "Child B", { status: "proto", parent: "root" }),
    card("g", "Grand", { status: "decided", parent: "b" }),
  ]);
  const out = await ok(p, ["show", "root"]);
  const rollups = out.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(rollups).toHaveLength(1);
  const line = rollups[0] ?? "";
  expect(line).toContain("4 cards");
  expect(line).toContain("1 open");
  expect(line).toContain("1 proto");
  expect(line).toContain("2 decided");
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const p = seeded([
    card("parent", "Parent", { status: "decided" }),
    card("child", "Child", { status: "decided", parent: "parent" }),
    card("g1", "G one", { status: "open", parent: "child" }),
    card("g2", "G two", { status: "decided", parent: "child" }),
  ]);
  const out = await ok(p, ["show", "parent"]);
  const link = out.split("\n").find((l) => l.includes("<- refines") && l.includes("child"));
  expect(link).toBeDefined();
  expect(link).toContain("3 cards");
  expect(out).toMatch(/^subtree: 4 cards/m);
});

function proofMap(withOption: boolean): Project {
  return seeded([
    card("root", "Root", { status: "decided" }),
    card("base", "Base card", { status: "decided", parent: "root" }),
    card("c", "The card", { status: "open", parent: "root" }),
    edge("c", "base", "depends_on", "takes the base storage"),
    ...(withOption
      ? [
          { type: "node.added", payload: { id: "c:opt0", kind: "option", title: "Other way", why_not: "too slow" } },
          edge("c:opt0", "c", "alternative_to"),
        ]
      : []),
    {
      type: "excerpt.quoted",
      payload: {
        id: "ex1", card: "c", title: "keep one log", conversation: "conv1", session: "s1",
        message: 2, start: 0, end: 12, speaker: "person", said_at: "2026-10-01T09:00:00Z",
      },
    },
    { type: "node.proposed", actor: "agent", payload: { id: "src", kind: "source", title: "Bench notes", finding: "logs are fast" } },
    edge("c", "src", "supported_by"),
  ]);
}

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const out = await ok(proofMap(true), ["show", "c"]);
  expect(out).toMatch(/depends_on\s+base.*\n\s+why: takes the base storage/);
  const lines = out.split("\n");
  const lastLink = lines.findLastIndex((l) => /^\s+(->|<-)/.test(l));
  const opt = lines.indexOf("Options");
  expect(opt).toBeGreaterThan(lastLink);
  expect(out).toContain("Other way");
  expect(out).toContain("why not: too slow");
  expect(lines).toContain("Say");
  expect(out).toContain('person: "keep one log"');
  expect(lines).toContain("Ev");
  expect(out).toContain("Bench notes");
  expect(out).toContain("finding: logs are fast");
  expect(lines.find((l) => l.includes("Bench notes") && !l.includes("->") && !l.includes("<-"))).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  const out = await ok(proofMap(false), ["show", "c"]);
  const lines = out.split("\n");
  expect(lines).toContain("Say");
  expect(lines).toContain("Ev");
  expect(lines).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  const p = seeded([card("root", "The root title", { status: "decided" }), card("second", "Second", { status: "open", parent: "root" })]);
  const out = await ok(p, ["show"]);
  expect(out).toContain("The root title");
  expect(out).toMatch(/^subtree: 2 cards/m);
  expect(out).toMatch(/<- refines\s+second\s+Second\s+\(1 card, 1 open\)/);
});

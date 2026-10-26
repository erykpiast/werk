import { appendFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { werkHarness } from "./h.ts";

const { project, werk, must, decide, real } = werkHarness();

const lines = (out: string) => out.split("\n").filter((l) => l !== "");
const append = (event: Record<string, unknown>) =>
  appendFileSync(project().logPath, `${JSON.stringify(event)}\n`);

test("09.1 search with no term lists the decided cards only", async () => {
  await decide("d1", { title: "First decided" });
  await decide("d2", { title: "Second decided" });
  await decide("d3", { title: "Third decided" });
  await real("o1", { title: "Open one" });
  // A ghost whose status is decided: a hand-written proposal, since add refuses decided.
  append({ type: "node.proposed", id: "g1", kind: "card", title: "Ghost decided", status: "decided" });
  const r = await werk("search");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(3);
  for (const [id, title] of [["d1", "First decided"], ["d2", "Second decided"], ["d3", "Third decided"]]) {
    expect(out.some((l) => l.includes(id as string) && l.includes(title as string))).toBe(true);
  }
  expect(r.stdout).not.toContain("Open one");
  expect(r.stdout).not.toContain("Ghost decided");
});

test("09.2 search with two terms puts the best match first", async () => {
  await decide("cl", { title: "Cache layout", body: "Cache eviction.\n\nThe eviction policy is LRU." });
  await must("add", "et", "--title", "Eviction timer", "--why", "eviction", "--body", "CACHE warmup");
  await must("accept", "et", "--actor", "you");
  await decide("cs", { title: "Cache size" });
  await real("gone", { title: "Gone", body: "cache eviction" });
  await must("remove", "gone", "--actor", "you");
  const r = await werk("search", "cache", "eviction");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(2);
  expect(out[0]).toContain("cl");
  expect(out[0]).toContain("decided");
  expect(out[0]).toContain("Cache layout");
  expect(out[1]).toContain("et");
  expect(out[1]).toContain("open");
  expect(out[1]).toContain("Eviction timer");
  expect(r.stdout).not.toContain("Cache size");
  expect(r.stdout).not.toContain("Gone");
});

test("09.3 search finds a card by a rejected option's why-not and narrows", async () => {
  await decide("parent-topic", { title: "Parent topic" });
  await decide("storage", { title: "Storage format", parent: "parent-topic" });
  await must("add", "storage:opt0", "--kind", "option", "--title", "SQLite", "--why", "SQLite needs a native build");
  await must("accept", "storage:opt0", "--actor", "you");
  await must("link", "storage:opt0", "storage", "--type", "alternative_to");
  await real("outside", { title: "Outside open", body: "we may use sqlite later" });
  const all = await werk("search", "sqlite");
  expect(all.stdout).toMatch(/storage.*decided.*Storage format/);
  expect(all.stdout).toMatch(/outside.*open.*Outside open/);
  const under = await werk("search", "sqlite", "--under", "parent-topic");
  expect(lines(under.stdout)).toHaveLength(1);
  expect(under.stdout).toContain("Storage format");
  const dec = await werk("search", "sqlite", "--status", "decided");
  expect(lines(dec.stdout)).toHaveLength(1);
  expect(dec.stdout).toContain("Storage format");
});

test("09.4 find lists the open work under one card", async () => {
  await decide("client", { title: "Client" });
  await real("routing", { title: "Routing", parent: "client" });
  await must("add", "theme", "--title", "Theme", "--parent", "client", "--status", "proto");
  await must("accept", "theme", "--actor", "you");
  await real("guards", { title: "Route guards", parent: "routing" });
  // The paused, stale and postponed cards.
  await decide("basis-p", { title: "Basis P" });
  await decide("basis-s", { title: "Basis S" });
  await real("paused-card", { title: "Paused card", parent: "client" });
  await real("stale-card", { title: "Stale card", parent: "client" });
  await must("link", "paused-card", "basis-p", "--type", "depends_on", "--why", "w");
  await must("link", "stale-card", "basis-s", "--type", "depends_on", "--why", "w");
  await decide("post-card", { title: "Postponed card", parent: "client" });
  await must("reopen", "basis-p", "--reason", "postponed");
  await must("reopen", "basis-s", "--reason", "invalidated");
  await must("reopen", "post-card", "--reason", "postponed");
  // An option and a source on Routing.
  await must("add", "routing:opt0", "--kind", "option", "--title", "Option card", "--why", "no");
  await must("accept", "routing:opt0", "--actor", "you");
  await must("link", "routing:opt0", "routing", "--type", "alternative_to");
  await must("add", "src1", "--kind", "source", "--title", "Source card");
  await must("accept", "src1", "--actor", "you");
  await must("link", "routing", "src1", "--type", "supported_by");
  await real("billing", { title: "Billing" });

  const rt = await werk("find", "routing");
  const rtOut = lines(rt.stdout);
  expect(rtOut[0]).toContain("Routing");
  expect(rtOut[1]).toContain("Route guards");
  for (const x of ["Billing", "Option card", "Source card"]) expect(rt.stdout).not.toContain(x);

  const cl = await werk("find", "client");
  const clOut = lines(cl.stdout);
  const idx = (t: string) => clOut.findIndex((l) => l.includes(t));
  expect(idx("Routing")).toBeGreaterThanOrEqual(0);
  expect(idx("Theme")).toBeGreaterThanOrEqual(0);
  expect(idx("Route guards")).toBeGreaterThan(Math.max(idx("Routing"), idx("Theme")));
  expect(cl.stdout).not.toMatch(/\[decided\]\s+Client/);
  expect(cl.stdout).not.toContain("Paused card");
  expect(cl.stdout).not.toContain("Stale card");
  expect(cl.stdout).not.toContain("Postponed card");
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  await real("tree-a", { title: "Tree A" });
  await real("tree-b", { title: "Tree B" });
  await decide("auth-flow", { title: "Auth flow" });
  await must("reopen", "auth-flow", "--reason", "rejected");
  const r = await werk("find");
  expect(r.stdout).toContain("Tree A");
  expect(r.stdout).toContain("Tree B");
  expect(r.stdout).toContain("Auth flow");
  expect(r.stdout).not.toContain("[decided]");
});

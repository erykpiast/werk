import { appendFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { makeCard, useWerk, type Werk } from "./support.ts";

const w = useWerk();
const lines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");
const raw = (t: Werk, events: object[]) =>
  appendFileSync(t.project.logPath, events.map((e) => `${JSON.stringify(e)}\n`).join(""));

describe("06 excerpts", () => {
  // The command line has no verb that quotes an excerpt. A spoken message is quoted by a verb
  // that takes a conversation ref; the test tries the verb a quote would use.
  test("06.1 a new excerpt stages as a ghost", async () => {
    const t = w();
    await makeCard(t, "auth", { decided: true });
    const r = await t.run("add", "ex1", "--kind", "excerpt", "--title", "We use passkeys", "--parent", "auth");
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe("proposed");
    expect((await t.run("show", "auth")).stdout).toMatch(/supported_by\s+ex1.*\[proposed\].*\[held\]/);
  });

  test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
    const t = w();
    await makeCard(t, "auth", { decided: true });
    const r = await t.run("add", "ex1", "--kind", "excerpt", "--title", "We use passkeys");
    expect(r.code, r.stderr).toBe(0);
    await t.ok("link", "auth", "ex1", "--type", "supported_by");
    await t.ok("accept", "ex1", "--actor", "you");
    const shown = (await t.run("show", "auth")).stdout;
    expect(shown).toMatch(/supported_by\s+ex1/);
    expect(shown).not.toContain("[held]");
  });
});

describe("09 search and find", () => {
  test("09.1 search with no term lists the decided cards", async () => {
    const t = w();
    for (const id of ["d1", "d2", "d3"]) await makeCard(t, id, { decided: true });
    await makeCard(t, "o1");
    await makeCard(t, "g1", { decided: true, ghost: true });
    const r = await t.run("search");
    expect(r.code, r.stderr).toBe(0);
    expect(lines(r.stdout)).toHaveLength(3);
    expect(r.stdout).not.toContain("o1");
    expect(r.stdout).not.toContain("g1");
  });

  test("09.2 search with two terms ranks by hits", async () => {
    const t = w();
    await makeCard(t, "cache-layout", { decided: true, title: "Cache layout", body: "Cache eviction\n\neviction policy" });
    await makeCard(t, "eviction-timer", { title: "Eviction timer", why: "eviction", body: "CACHE warmup" });
    await makeCard(t, "cache-size", { decided: true, title: "Cache size", why: "cache" });
    await makeCard(t, "gone", { title: "Gone", body: "cache eviction" });
    await t.ok("remove", "gone");
    const r = await t.run("search", "cache", "eviction");
    expect(r.code, r.stderr).toBe(0);
    const out = lines(r.stdout);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("cache-layout");
    expect(out[0]).toContain("decided");
    expect(out[1]).toContain("eviction-timer");
    expect(out[1]).toContain("open");
  });

  test("09.3 search finds a word in a rejected option and narrows", async () => {
    const t = w();
    await makeCard(t, "parent-topic", { decided: true });
    await makeCard(t, "storage", { decided: true, parent: "parent-topic" });
    await t.ok("add", "storage:opt0", "--kind", "option", "--title", "Embedded db", "--why", "SQLite needs a native build");
    await t.ok("link", "storage:opt0", "storage", "--type", "alternative_to");
    await makeCard(t, "elsewhere", { body: "sqlite" });
    const all = await t.run("search", "sqlite");
    expect(all.code, all.stderr).toBe(0);
    expect(all.stdout).toContain("storage");
    expect(all.stdout).toContain("elsewhere");
    const under = await t.run("search", "sqlite", "--under", "parent-topic");
    expect(under.stdout).toContain("storage");
    expect(under.stdout).not.toContain("elsewhere");
    const decided = await t.run("search", "sqlite", "--status", "decided");
    expect(decided.stdout).toContain("storage");
    expect(decided.stdout).not.toContain("elsewhere");
  });

  test("09.4 find lists the open work under one card", async () => {
    const t = w();
    await makeCard(t, "client", { decided: true });
    await makeCard(t, "routing", { parent: "client" });
    await makeCard(t, "theme", { parent: "client" });
    await t.ok("edit", "theme", "--who", "prototype");
    await makeCard(t, "route-guards", { parent: "routing" });
    await makeCard(t, "billing");
    const r = await t.run("find", "routing");
    expect(r.code, r.stderr).toBe(0);
    const out = lines(r.stdout);
    expect(out[0]).toContain("routing");
    expect(out[1]).toContain("route-guards");
    expect(r.stdout).not.toContain("billing");
    const c = await t.run("find", "client");
    expect(c.stdout).not.toMatch(/\bclient\b/);
    expect(c.stdout.indexOf("route-guards")).toBeGreaterThan(c.stdout.indexOf("theme"));
  });

  test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
    const t = w();
    await makeCard(t, "tree-a");
    await makeCard(t, "tree-b");
    await makeCard(t, "auth-flow", { decided: true });
    const re = await t.run("reopen", "auth-flow", "--reason", "rejected");
    expect(re.code, re.stderr).toBe(0);
    const r = await t.run("find");
    expect(r.code, r.stderr).toBe(0);
    for (const id of ["tree-a", "tree-b", "auth-flow"]) expect(r.stdout).toContain(id);
  });
});

describe("11 show", () => {
  async function tree(t: Werk) {
    await makeCard(t, "root", { decided: true });
    await makeCard(t, "c1", { parent: "root" });
    await makeCard(t, "c2", { parent: "root" });
    await t.ok("edit", "c2", "--who", "prototype");
    await t.ok("add", "gc", "--title", "Grandchild", "--why", "w");
    await t.ok("edit", "gc", "--who", "me", "--no-basis", "x");
    await t.ok("kill", "gc", "--revisit");
    await t.ok("accept", "gc", "--actor", "you");
    await t.ok("status", "gc", "decided");
    await t.ok("link", "gc", "c1", "--type", "refines");
  }

  test("11.1 the rollup counts the card and its refines subtree", async () => {
    const t = w();
    await tree(t);
    const out = (await t.run("show", "root")).stdout;
    expect(out).toMatch(/4 cards/);
    expect(out).toMatch(/1 open/);
    expect(out).toMatch(/1 proto/);
    expect(out).toMatch(/2 decided/);
  });

  test("11.2 each incoming refines link shows the child's own rollup", async () => {
    const t = w();
    await makeCard(t, "parent", { decided: true });
    await makeCard(t, "child", { parent: "parent" });
    await makeCard(t, "g1", { parent: "child" });
    await makeCard(t, "g2", { parent: "child", decided: true });
    const out = (await t.run("show", "parent")).stdout;
    const link = out.split("\n").find((l) => /<- refines\s+child/.test(l)) ?? "";
    expect(link).toMatch(/3 cards/);
    expect(out).toMatch(/4 cards/);
  });

  test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
    const t = w();
    await makeCard(t, "base", { decided: true });
    await makeCard(t, "card");
    await t.ok("link", "card", "base", "--type", "depends_on", "--why", "needs the base");
    await t.ok("add", "card:opt0", "--kind", "option", "--title", "Option title", "--why", "Option why-not");
    await t.ok("link", "card:opt0", "card", "--type", "alternative_to");
    await t.ok("add", "src1", "--kind", "source", "--title", "Source title", "--why", "Source finding");
    await t.ok("link", "card", "src1", "--type", "supported_by");
    raw(t, [
      { type: "node.proposed", id: "ex1", kind: "excerpt", title: "Exact words said", status: "open", why: "you" },
      { type: "node.accepted", id: "ex1", actor: "you" },
      { type: "edge.added", from: "card", to: "ex1", link: "supported_by" },
    ]);
    const out = (await t.run("show", "card")).stdout;
    expect(out).toContain("needs the base");
    expect(out).toMatch(/Options[\s\S]*Option title[\s\S]*Option why-not/);
    expect(out).toMatch(/Say[\s\S]*Exact words said/);
    expect(out).toMatch(/Ev[\s\S]*Source title[\s\S]*Source finding[\s\S]*proposed/);
  });

  test("11.4 a card with no options prints no Options section", async () => {
    const t = w();
    await makeCard(t, "card");
    await t.ok("add", "src1", "--kind", "source", "--title", "Source title", "--why", "Source finding");
    await t.ok("link", "card", "src1", "--type", "supported_by");
    raw(t, [
      { type: "node.proposed", id: "ex1", kind: "excerpt", title: "Exact words said", status: "open" },
      { type: "edge.added", from: "card", to: "ex1", link: "supported_by" },
    ]);
    const out = (await t.run("show", "card")).stdout;
    expect(out).toMatch(/\bSay\b/);
    expect(out).toMatch(/\bEv\b/);
    expect(out).not.toMatch(/\bOptions\b/);
  });

  test("11.5 show with no id prints the root card", async () => {
    const t = w();
    await makeCard(t, "root", { title: "Root card" });
    await makeCard(t, "second", { parent: "root" });
    const r = await t.run("show");
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("Root card");
    expect(r.stdout).toMatch(/1 cards?/);
    expect(r.stdout).toMatch(/<- refines\s+second/);
  });
});

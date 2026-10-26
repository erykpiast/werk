// Held-out steps 66.1-66.5: remove, restore and find on a branch of the map, at the command line.
import { expect, test } from "bun:test";
import { card, lines, link, ok, withMap } from "./c-helpers.ts";

const storage = () => [card("root", "Root"), card("storage", "Storage", "root")] as const;

test("66.1 an agent removes a bad branch and the log keeps its history", async () => {
  const p = withMap([
    ...storage(),
    card("cache", "Cache", "storage"),
    card("index", "Index", "storage"),
    card("eviction", "Eviction", "cache"),
  ]);
  const before = lines(p);
  // The agent removes "Cache": a remove needs the person's claim, so the agent passes it.
  await ok(p, ["remove", "cache", "--actor", "you"]);

  // Then showing "Cache" reports it as removed
  const cache = await p.werk(["show", "cache"]);
  expect(cache.out + cache.err).toContain("removed");
  // And showing "Eviction" reports it as removed
  const eviction = await p.werk(["show", "eviction"]);
  expect(eviction.out + eviction.err).toContain("removed");
  const shown = (await ok(p, ["show", "storage"])).out;
  expect(shown).not.toMatch(/refines\s+cache\s/);
  expect(shown).not.toMatch(/refines\s+eviction\s/);
  expect(shown).toMatch(/<- refines\s+index\s+Index/);
  expect((await ok(p, ["removed"])).out).toContain("cache");
  const after = lines(p);
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after).toHaveLength(before.length + 1);
});

test("66.2 a restore brings back a removed card, its subtree and its links", async () => {
  const p = withMap([
    ...storage(),
    card("cache", "Cache", "storage"),
    card("eviction", "Eviction", "cache"),
    card("memory", "Memory budget", "root"),
    link("cache", "memory", "depends_on", "the cache fits the memory budget"),
  ]);
  await ok(p, ["remove", "cache", "--actor", "you"]);
  await ok(p, ["restore", "cache", "--actor", "you"]);

  const cache = await p.werk(["show", "cache"]);
  expect(cache.code).toBe(0);
  expect(cache.out + cache.err).not.toContain("removed");
  expect((await ok(p, ["show", "storage"])).out).toMatch(/<- refines\s+cache\s+Cache/);
  expect(cache.out).toMatch(/<- refines\s+eviction\s+Eviction/);
  expect(cache.out).toMatch(/-> depends_on\s+memory\s+Memory budget/);
  expect((await ok(p, ["removed"])).out).not.toContain("cache");
});

test("66.3 a remove with the lift option keeps the good children", async () => {
  const p = withMap([
    ...storage(),
    card("bad", "Bad layer", "storage"),
    card("write", "Write path", "bad"),
    card("read", "Read path", "bad"),
  ]);
  await ok(p, ["remove", "bad", "--actor", "you", "--reparent"]);

  const bad = await p.werk(["show", "bad"]);
  expect(bad.out + bad.err).toContain("removed");
  const shown = (await ok(p, ["show", "storage"])).out;
  expect(shown).toMatch(/<- refines\s+write\s+Write path/);
  expect(shown).toMatch(/<- refines\s+read\s+Read path/);
  for (const id of ["write", "read"]) {
    const run = await p.werk(["show", id]);
    expect(run.code).toBe(0);
    expect(run.out + run.err).not.toContain("removed");
  }
});

test("66.4 find lists the open cards an agent can work on in a subtree", async () => {
  const p = withMap([
    ...storage(),
    card("cache", "Cache", "storage"),
    card("index", "Index", "storage"),
    card("backup", "Backup", "storage"),
    card("quota", "Quota", "storage"),
    card("later", "Later engine", "root"),
    ["node.decided", { id: "later" }],
    card("wrong", "Wrong store", "root"),
    ["node.decided", { id: "wrong" }],
    link("backup", "later", "depends_on", "backup runs on the engine"),
    link("quota", "wrong", "depends_on", "quota counts the store"),
    card("outside", "Outside work", "root"),
  ]);
  await ok(p, ["reopen", "later", "--reason", "postponed", "--why", "waits a quarter"]);
  await ok(p, ["reopen", "wrong", "--reason", "rejected", "--why", "the store is wrong"]);

  const found = (await ok(p, ["find", "storage"])).out;
  expect(found).toMatch(/^cache\s/m);
  expect(found).toMatch(/^index\s/m);
  expect(found).not.toMatch(/^backup\s/m);
  expect(found).not.toMatch(/^quota\s/m);
  expect(found).not.toMatch(/^outside\s/m);
});

test("66.5 a removed branch drops out of find and comes back after a restore", async () => {
  const p = withMap([...storage(), card("cache", "Cache", "storage"), card("index", "Index", "storage")]);
  await ok(p, ["remove", "cache", "--actor", "you"]);
  const found = (await ok(p, ["find", "storage"])).out;
  expect(found).toMatch(/^index\s/m);
  expect(found).not.toMatch(/^cache\s/m);
  await ok(p, ["restore", "cache", "--actor", "you"]);
  const again = (await ok(p, ["find", "storage"])).out;
  expect(again).toMatch(/^index\s/m);
  expect(again).toMatch(/^cache\s/m);
});

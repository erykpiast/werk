import { expect, test } from "bun:test";
import { card, childrenOf, decided, lines, link, ok, seeded, werk } from "./c-helpers.ts";

const T = 60_000;

/** The ids that `werk find` lists, in order. */
const found = (out: string) =>
  out
    .split("\n")
    .filter((l) => /^\S+\s{2}/.test(l))
    .map((l) => l.split(/\s+/)[0]);

const showText = async (p: Parameters<typeof werk>[0], id: string) => {
  const run = await werk(p, "show", id);
  return { code: run.code, text: `${run.out}${run.err}` };
};

test(
  "66.1 an agent removes a bad branch and the log keeps its history",
  async () => {
    const p = seeded([
      decided("root", "Root"),
      decided("storage", "Storage", "root"),
      card("cache", "Cache", "storage"),
      card("index", "Index", "storage"),
      card("eviction", "Eviction", "cache"),
    ]);
    const before = lines(p);
    await ok(p, "remove", "cache", "--actor", "you");
    const after = lines(p);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.length).toBe(before.length + 1);
    expect(childrenOf(p, "storage")).toEqual(["index"]);
    const storage = await ok(p, "show", "storage");
    expect(storage).not.toContain("Cache");
    expect(storage).toContain("index");
    expect(await ok(p, "removed")).toContain("cache");
    const cache = await showText(p, "cache");
    const eviction = await showText(p, "eviction");
    expect(cache.text, "show cache").toContain("removed");
    expect(eviction.text, "show eviction").toContain("removed");
  },
  T,
);

test(
  "66.2 a restore brings back a removed card, its subtree and its links",
  async () => {
    const p = seeded([
      decided("root", "Root"),
      decided("storage", "Storage", "root"),
      decided("memory-budget", "Memory budget", "root"),
      card("cache", "Cache", "storage"),
      card("eviction", "Eviction", "cache"),
      link("cache", "memory-budget", "depends_on", "the cache fits the budget"),
    ]);
    await ok(p, "remove", "cache", "--actor", "you");
    await ok(p, "restore", "cache", "--actor", "you");
    const show = await ok(p, "show", "cache");
    expect(show).not.toContain("removed");
    expect(childrenOf(p, "storage")).toEqual(["cache"]);
    expect(childrenOf(p, "cache")).toEqual(["eviction"]);
    expect(show).toMatch(/depends_on\s+memory-budget/);
    expect(await ok(p, "removed")).not.toContain("cache");
  },
  T,
);

test(
  "66.3 remove with reparent keeps the good children",
  async () => {
    const p = seeded([
      decided("root", "Root"),
      decided("storage", "Storage", "root"),
      card("bad-layer", "Bad layer", "storage"),
      card("write-path", "Write path", "bad-layer"),
      card("read-path", "Read path", "bad-layer"),
    ]);
    await ok(p, "remove", "bad-layer", "--actor", "you", "--reparent");
    expect(childrenOf(p, "storage")).toEqual(["read-path", "write-path"]);
    for (const id of ["write-path", "read-path"]) {
      const s = await showText(p, id);
      expect(s.code).toBe(0);
      expect(s.text).not.toContain("removed");
    }
    const bad = await showText(p, "bad-layer");
    expect(bad.text, "show bad-layer").toContain("removed");
  },
  T,
);

test(
  "66.4 find lists the open cards an agent can work on in a subtree",
  async () => {
    const p = seeded([
      decided("root", "Root"),
      decided("storage", "Storage", "root"),
      decided("engine", "Engine", "root"),
      decided("format", "Format", "root"),
      card("elsewhere", "Elsewhere", "root"),
      card("cache", "Cache", "storage"),
      card("index", "Index", "storage"),
      card("backup", "Backup", "storage"),
      card("quota", "Quota", "storage"),
      link("backup", "engine", "depends_on", "w"),
      link("quota", "format", "depends_on", "w"),
    ]);
    await ok(p, "reopen", "engine", "--reason", "postponed");
    await ok(p, "reopen", "format", "--reason", "rejected");
    const ids = found(await ok(p, "find", "storage"));
    expect(ids).toContain("cache");
    expect(ids).toContain("index");
    expect(ids).not.toContain("backup");
    expect(ids).not.toContain("quota");
    expect(ids).not.toContain("elsewhere");
  },
  T,
);

test(
  "66.5 a removed branch drops out of find and comes back after a restore",
  async () => {
    const p = seeded([
      decided("root", "Root"),
      decided("storage", "Storage", "root"),
      card("cache", "Cache", "storage"),
      card("index", "Index", "storage"),
    ]);
    await ok(p, "remove", "cache", "--actor", "you");
    let ids = found(await ok(p, "find", "storage"));
    expect(ids).toContain("index");
    expect(ids).not.toContain("cache");
    await ok(p, "restore", "cache", "--actor", "you");
    ids = found(await ok(p, "find", "storage"));
    expect(ids).toContain("index");
    expect(ids).toContain("cache");
  },
  T,
);

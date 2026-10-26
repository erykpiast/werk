import { expect, test } from "bun:test";
import { card, lines, link, ok, reopen, withMap } from "./helpers.ts";

const O = { status: "open" };
const D = { status: "decided" };

test("66.1 an agent removes a bad branch and the log keeps its history", async () => {
  const p = withMap([
    card("root", "Root"),
    card("storage", "Storage", "root"),
    card("cache", "Cache", "storage"),
    card("index", "Index", "storage"),
    card("eviction", "Eviction", "cache"),
  ]);
  const before = lines(p);
  // The agent removes: the remove verb needs --actor you, the person's claim (#werk remove help).
  const rm = await p.werk(["remove", "cache", "--actor", "you"]);
  expect(rm.code).toBe(0);
  const cache = await p.werk(["show", "cache"]);
  expect(`${cache.out}${cache.err}`).toContain("removed");
  const ev = await p.werk(["show", "eviction"]);
  expect(`${ev.out}${ev.err}`).toContain("removed");
  const storage = (await ok(p, ["show", "storage"])).out;
  expect(storage).not.toContain("cache");
  expect(storage).not.toContain("eviction");
  expect(storage).toContain("index");
  expect((await ok(p, ["removed"])).out).toContain("cache");
  const after = lines(p);
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after).toHaveLength(before.length + 1);
});

test("66.2 a restore brings back the subtree with its links", async () => {
  const p = withMap([
    card("root", "Root"),
    card("storage", "Storage", "root"),
    card("cache", "Cache", "storage"),
    card("eviction", "Eviction", "cache"),
    card("budget", "Memory budget", "root"),
    link("cache", "budget", "depends_on", "Cache size comes from the budget"),
  ]);
  await ok(p, ["remove", "cache", "--actor", "you"]);
  await ok(p, ["restore", "cache", "--actor", "you"]);
  const cache = await ok(p, ["show", "cache"]);
  expect(`${cache.out}${cache.err}`).not.toContain("removed");
  expect(cache.out).toContain("parent: storage");
  expect((await ok(p, ["show", "eviction"])).out).toContain("parent: cache");
  expect(cache.out).toContain("depends_on      budget");
  expect((await ok(p, ["removed"])).out).not.toContain("cache");
});

test("66.3 remove with reparent keeps the good children", async () => {
  const p = withMap([
    card("root", "Root"),
    card("storage", "Storage", "root"),
    card("bad", "Bad layer", "storage"),
    card("write", "Write path", "bad"),
    card("read", "Read path", "bad"),
  ]);
  await ok(p, ["remove", "bad", "--actor", "you", "--reparent"]);
  const bad = await p.werk(["show", "bad"]);
  expect(`${bad.out}${bad.err}`).toContain("removed");
  for (const id of ["write", "read"]) {
    const r = await ok(p, ["show", id]);
    expect(r.out).toContain("parent: storage");
    expect(`${r.out}${r.err}`).not.toContain("removed");
  }
});

test("66.4 find lists the workable open cards in a subtree", async () => {
  const p = withMap([
    card("root", "Root", undefined, D),
    card("storage", "Storage", "root", D),
    card("cache", "Cache", "storage", O),
    card("index", "Index", "storage", O),
    card("backup", "Backup", "storage", O),
    card("quota", "Quota", "storage", O),
    card("pp", "Postponed basis", "root", D),
    card("rj", "Rejected basis", "root", D),
    link("backup", "pp", "depends_on", "needs it"),
    link("quota", "rj", "depends_on", "needs it"),
    card("elsewhere", "Elsewhere", "root", O),
    reopen("pp", "postponed"),
    reopen("rj", "rejected"),
  ]);
  const out = (await ok(p, ["find", "storage"])).out;
  expect(out).toContain("Cache");
  expect(out).toContain("Index");
  expect(out).not.toContain("Backup");
  expect(out).not.toContain("Quota");
  expect(out).not.toContain("Elsewhere");
});

test("66.5 a removed branch drops out of find and comes back after a restore", async () => {
  const p = withMap([
    card("root", "Root", undefined, D),
    card("storage", "Storage", "root", D),
    card("cache", "Cache", "storage", O),
    card("index", "Index", "storage", O),
  ]);
  await ok(p, ["remove", "cache", "--actor", "you"]);
  const a = (await ok(p, ["find", "storage"])).out;
  expect(a).toContain("Index");
  expect(a).not.toContain("Cache");
  await ok(p, ["restore", "cache", "--actor", "you"]);
  const b = (await ok(p, ["find", "storage"])).out;
  expect(b).toContain("Index");
  expect(b).toContain("Cache");
});

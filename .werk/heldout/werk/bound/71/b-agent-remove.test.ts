import { expect, test } from "bun:test";
import { card, childrenIn, ids, lines, link, ok, withMap } from "./b-helpers.ts";

const T = 60_000;

/** `show` of a card reports it as removed: the output says "removed". */
async function showSaysRemoved(p: ReturnType<typeof withMap>, id: string) {
  const r = await p.werk(["show", id]);
  return { text: `${r.out}${r.err}`, removed: /removed/i.test(`${r.out}${r.err}`) };
}

test(
  "66.1",
  async () => {
    const p = withMap([
      card("storage", "Storage", undefined, "decided"),
      card("cache", "Cache", "storage"),
      card("index", "Index", "storage"),
      card("eviction", "Eviction", "cache"),
    ]);
    const before = lines(p);
    await ok(p, ["remove", "cache", "--actor", "you"]);
    // the other checks first, so one failing check does not hide the rest
    const storage = childrenIn((await ok(p, ["show", "storage"])).out);
    expect(storage).not.toContain("cache");
    expect(storage).not.toContain("eviction");
    expect(storage).toContain("index");
    expect((await ok(p, ["removed"])).out).toContain("cache: removed");
    const after = lines(p);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after).toHaveLength(before.length + 1);
    const cache = await showSaysRemoved(p, "cache");
    const eviction = await showSaysRemoved(p, "eviction");
    expect(cache.text).toMatch(/removed/i);
    expect(eviction.text).toMatch(/removed/i);
  },
  T,
);

test(
  "66.2",
  async () => {
    const p = withMap([
      card("root", "Root", undefined, "decided"),
      card("storage", "Storage", "root"),
      card("cache", "Cache", "storage"),
      card("eviction", "Eviction", "cache"),
      card("memory-budget", "Memory budget", "root"),
      link("cache", "memory-budget", "depends_on", "The cache fits the memory budget"),
    ]);
    await ok(p, ["remove", "cache", "--actor", "you"]);
    await ok(p, ["restore", "cache", "--actor", "you"]);
    const cache = await p.werk(["show", "cache"]);
    expect(cache.code).toBe(0);
    expect(`${cache.out}${cache.err}`).not.toMatch(/removed/i);
    expect(childrenIn((await ok(p, ["show", "storage"])).out)).toContain("cache");
    expect(childrenIn(cache.out)).toContain("eviction");
    expect(cache.out).toMatch(/-> depends_on\s+memory-budget/);
    expect((await ok(p, ["removed"])).out).not.toContain("cache");
  },
  T,
);

test(
  "66.3",
  async () => {
    const p = withMap([
      card("storage", "Storage", undefined, "decided"),
      card("bad-layer", "Bad layer", "storage"),
      card("write-path", "Write path", "bad-layer"),
      card("read-path", "Read path", "bad-layer"),
    ]);
    await ok(p, ["remove", "bad-layer", "--actor", "you", "--reparent"]);
    expect(childrenIn((await ok(p, ["show", "storage"])).out).sort()).toEqual(["read-path", "write-path"]);
    for (const id of ["write-path", "read-path"]) {
      const r = await ok(p, ["show", id]);
      expect(r.out).toContain("parent: storage");
      expect(`${r.out}${r.err}`).not.toMatch(/removed/i);
    }
    const bad = await showSaysRemoved(p, "bad-layer");
    expect(bad.text).toMatch(/removed/i);
  },
  T,
);

test(
  "66.4",
  async () => {
    const p = withMap([
      card("root", "Root", undefined, "decided"),
      card("storage", "Storage", "root", "decided"),
      card("cache", "Cache", "storage"),
      card("index", "Index", "storage"),
      card("backup", "Backup", "storage"),
      card("quota", "Quota", "storage"),
      card("ops", "Ops", "root", "decided"),
      card("schedule", "Schedule", "ops", "decided"),
      card("limits", "Limits", "ops", "decided"),
      card("outside", "Outside work", "ops"),
      link("backup", "schedule", "depends_on", "Backup runs on the schedule"),
      link("quota", "limits", "depends_on", "Quota uses the limits"),
      ["node.reopened", { id: "schedule", reason: "postponed" }],
      ["node.reopened", { id: "limits", reason: "rejected" }],
    ]);
    expect((await ok(p, ["show", "backup"])).out).toContain("paused");
    expect((await ok(p, ["show", "quota"])).out).toContain("stale");
    const found = ids((await ok(p, ["find", "storage"])).out);
    expect(found).toContain("cache");
    expect(found).toContain("index");
    for (const x of ["backup", "quota", "outside"]) expect(found).not.toContain(x);
  },
  T,
);

test(
  "66.5",
  async () => {
    const p = withMap([
      card("storage", "Storage", undefined, "decided"),
      card("cache", "Cache", "storage"),
      card("index", "Index", "storage"),
    ]);
    await ok(p, ["remove", "cache", "--actor", "you"]);
    const first = ids((await ok(p, ["find", "storage"])).out);
    expect(first).toContain("index");
    expect(first).not.toContain("cache");
    await ok(p, ["restore", "cache", "--actor", "you"]);
    const again = ids((await ok(p, ["find", "storage"])).out);
    expect(again).toContain("cache");
    expect(again).toContain("index");
  },
  T,
);

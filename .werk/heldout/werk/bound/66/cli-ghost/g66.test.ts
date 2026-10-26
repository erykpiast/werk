import { expect, test } from "bun:test";
import type { Project } from "../../src/test/project.ts";
import { card, lines, ok, seed, w, withRoot } from "./helpers.ts";

/** Show of a removed card: the command fails and the message says the card is removed. */
async function reportsRemoved(p: Project, id: string) {
  const run = await w(p, "show", id);
  expect(run.code).not.toBe(0);
  expect(`${run.out}${run.err}`).toMatch(/removed/);
}

test("66.1 an agent removes a bad branch and the log keeps its history", async () => {
  const p = withRoot();
  card(p, "storage", "Storage");
  card(p, "cache", "Cache", "storage");
  card(p, "index", "Index", "storage");
  card(p, "eviction", "Eviction", "cache");
  const before = lines(p);
  await ok(p, "remove", "cache", "--actor", "you");
  const storage = (await ok(p, "show", "storage")).out;
  expect(storage).not.toMatch(/refines +cache /);
  expect(storage).not.toContain("eviction");
  expect(storage).toMatch(/<- refines +index {2}Index/);
  expect((await ok(p, "removed")).out).toContain("cache");
  const after = lines(p);
  expect(after).toHaveLength(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  await reportsRemoved(p, "cache");
  await reportsRemoved(p, "eviction");
});

test("66.2 a person restores a removed card and its subtree with their links", async () => {
  const p = withRoot();
  card(p, "storage", "Storage");
  card(p, "cache", "Cache", "storage");
  card(p, "eviction", "Eviction", "cache");
  card(p, "memory", "Memory budget");
  seed(p, "edge.added", { from: "cache", to: "memory", type: "depends_on", why: "the cache fits the memory budget" });
  await ok(p, "remove", "cache", "--actor", "you");
  await ok(p, "restore", "cache", "--actor", "you");
  const cache = await w(p, "show", "cache");
  expect(cache.code).toBe(0);
  expect(cache.out.split("\n")[0]).not.toContain("removed");
  expect((await ok(p, "show", "storage")).out).toMatch(/<- refines +cache {2}Cache/);
  expect(cache.out).toMatch(/<- refines +eviction {2}Eviction/);
  expect(cache.out).toMatch(/-> depends_on +memory {2}Memory budget/);
  expect((await ok(p, "removed")).out).not.toContain("cache");
});

test("66.3 an agent removes a bad parent but keeps its good children", async () => {
  const p = withRoot();
  card(p, "storage", "Storage");
  card(p, "bad", "Bad layer", "storage");
  card(p, "write", "Write path", "bad");
  card(p, "read", "Read path", "bad");
  await ok(p, "remove", "bad", "--actor", "you", "--reparent");
  const storage = (await ok(p, "show", "storage")).out;
  expect(storage).toMatch(/<- refines +write {2}Write path/);
  expect(storage).toMatch(/<- refines +read {2}Read path/);
  for (const id of ["write", "read"]) {
    const run = await w(p, "show", id);
    expect(run.code).toBe(0);
    expect(run.out).not.toContain("removed");
  }
  await reportsRemoved(p, "bad");
});

test("66.4 an agent finds the open cards it can work on in a subtree", async () => {
  const p = withRoot();
  card(p, "storage", "Storage");
  for (const [id, title] of [
    ["cache", "Cache"],
    ["index", "Index"],
    ["backup", "Backup"],
    ["quota", "Quota"],
  ] as const)
    card(p, id, title, "storage");
  card(p, "schedule", "Backup schedule", "root", "decided");
  card(p, "limits", "Disk limits", "root", "decided");
  seed(p, "edge.added", { from: "backup", to: "schedule", type: "depends_on", why: "backups follow the schedule" });
  seed(p, "edge.added", { from: "quota", to: "limits", type: "depends_on", why: "quotas follow the disk limits" });
  await ok(p, "reopen", "schedule", "--reason", "postponed", "--why", "later");
  await ok(p, "reopen", "limits", "--reason", "rejected", "--why", "wrong");
  card(p, "outside", "Outside work");
  const out = (await ok(p, "find", "storage")).out;
  expect(out).toMatch(/\bcache\b/);
  expect(out).toMatch(/\bindex\b/);
  expect(out).not.toMatch(/\bbackup\b/);
  expect(out).not.toMatch(/\bquota\b/);
  expect(out).not.toMatch(/\boutside\b/);
});

test("66.5 a removed branch drops out of the find result and comes back after a restore", async () => {
  const p = withRoot();
  card(p, "storage", "Storage");
  card(p, "cache", "Cache", "storage");
  card(p, "index", "Index", "storage");
  await ok(p, "remove", "cache", "--actor", "you");
  const out = (await ok(p, "find", "storage")).out;
  expect(out).toMatch(/\bindex\b/);
  expect(out).not.toMatch(/\bcache\b/);
  await ok(p, "restore", "cache", "--actor", "you");
  const again = (await ok(p, "find", "storage")).out;
  expect(again).toMatch(/\bindex\b/);
  expect(again).toMatch(/\bcache\b/);
});

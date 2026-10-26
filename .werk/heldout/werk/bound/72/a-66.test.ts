import { expect, test } from "bun:test";
import { children, project, real, seed, show } from "./a-helpers.ts";

const shownRemoved = async (p: ReturnType<typeof project>, id: string) => {
  const s = await show(p, id);
  return `${s.out}${s.err}`;
};

test("66.1 an agent removes a bad branch and the log keeps its history", async () => {
  const p = project();
  await real(p, "root", "Root");
  await real(p, "storage", "Storage", "root");
  await real(p, "cache", "Cache", "storage");
  await real(p, "index", "Index", "storage");
  await real(p, "eviction", "Eviction", "cache");
  const before = p.lines();
  expect((await p.werk(["remove", "cache", "--actor", "you"])).code).toBe(0);
  const st = await show(p, "storage");
  expect(children(st.out)).toEqual(["index"]);
  const removed = await p.werk(["removed"]);
  expect(removed.out).toContain("cache");
  const after = p.lines();
  expect(after).toHaveLength(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  expect(await shownRemoved(p, "cache")).toMatch(/removed/);
  expect(await shownRemoved(p, "eviction")).toMatch(/removed/);
});

test("66.2 a person restores a removed card and its subtree with their links", async () => {
  const p = project();
  await real(p, "root", "Root");
  await real(p, "storage", "Storage", "root");
  await real(p, "budget", "Memory budget", "root");
  await real(p, "cache", "Cache", "storage");
  await real(p, "eviction", "Eviction", "cache");
  expect(
    (await p.werk(["link", "cache", "budget", "--type", "depends_on", "--why", "the cache fits the budget"])).code,
  ).toBe(0);
  expect((await p.werk(["remove", "cache", "--actor", "you"])).code).toBe(0);
  expect((await p.werk(["restore", "cache", "--actor", "you"])).code).toBe(0);
  const c = await show(p, "cache");
  expect(c.code).toBe(0);
  expect(`${c.out}${c.err}`).not.toMatch(/removed/);
  expect(children((await show(p, "storage")).out)).toEqual(["cache"]);
  expect(children(c.out)).toEqual(["eviction"]);
  expect(c.out).toMatch(/-> depends_on\s+budget\s+Memory budget/);
  expect((await p.werk(["removed"])).out).not.toContain("cache");
});

test("66.3 an agent removes a bad parent but keeps its good children", async () => {
  const p = project();
  await real(p, "root", "Root");
  await real(p, "storage", "Storage", "root");
  await real(p, "bad", "Bad layer", "storage");
  await real(p, "write", "Write path", "bad");
  await real(p, "read", "Read path", "bad");
  expect((await p.werk(["remove", "bad", "--actor", "you", "--reparent"])).code).toBe(0);
  expect(children((await show(p, "storage")).out).sort()).toEqual(["read", "write"]);
  for (const id of ["write", "read"]) {
    const s = await show(p, id);
    expect(s.code).toBe(0);
    expect(`${s.out}${s.err}`).not.toMatch(/removed/);
  }
  expect(await shownRemoved(p, "bad")).toMatch(/removed/);
});

test("66.4 an agent finds the open cards it can work on in a subtree", async () => {
  const p = project();
  seed(p, "root", { title: "Root", status: "decided", who: "you" });
  seed(p, "storage", { title: "Storage", parent: "root", status: "decided", who: "you" });
  seed(p, "engine", { title: "Engine", parent: "root", status: "decided", who: "you" });
  seed(p, "vendor", { title: "Vendor", parent: "root", status: "decided", who: "you" });
  for (const [id, title] of [
    ["cache", "Cache"],
    ["index", "Index"],
    ["backup", "Backup"],
    ["quota", "Quota"],
  ] as const)
    seed(p, id, { title, parent: "storage", status: "open" });
  seed(p, "elsewhere", { title: "Elsewhere", parent: "root", status: "open" });
  expect(
    (await p.werk(["link", "backup", "engine", "--type", "depends_on", "--why", "backups run on the engine"])).code,
  ).toBe(0);
  expect(
    (await p.werk(["link", "quota", "vendor", "--type", "depends_on", "--why", "quotas come from the vendor"])).code,
  ).toBe(0);
  expect((await p.werk(["reopen", "engine", "--reason", "postponed", "--why", "next quarter"])).code).toBe(0);
  expect((await p.werk(["reopen", "vendor", "--reason", "rejected", "--why", "vendor dropped"])).code).toBe(0);
  const find = await p.werk(["find", "storage"]);
  expect(find.code).toBe(0);
  expect(find.out).toMatch(/\bcache\b/);
  expect(find.out).toMatch(/\bindex\b/);
  expect(find.out).not.toMatch(/\bbackup\b/);
  expect(find.out).not.toMatch(/\bquota\b/);
  expect(find.out).not.toMatch(/\belsewhere\b/);
});

test("66.5 a removed branch drops out of the find result and comes back after a restore", async () => {
  const p = project();
  seed(p, "root", { title: "Root", status: "decided", who: "you" });
  seed(p, "storage", { title: "Storage", parent: "root", status: "decided", who: "you" });
  seed(p, "cache", { title: "Cache", parent: "storage", status: "open" });
  seed(p, "index", { title: "Index", parent: "storage", status: "open" });
  expect((await p.werk(["remove", "cache", "--actor", "you"])).code).toBe(0);
  const f1 = await p.werk(["find", "storage"]);
  expect(f1.out).toMatch(/\bindex\b/);
  expect(f1.out).not.toMatch(/\bcache\b/);
  expect((await p.werk(["restore", "cache", "--actor", "you"])).code).toBe(0);
  const f2 = await p.werk(["find", "storage"]);
  expect(f2.out).toMatch(/\bindex\b/);
  expect(f2.out).toMatch(/\bcache\b/);
});

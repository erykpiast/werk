// Held-out steps 66.1-66.5: remove, restore and find. The remove and the restore run with the
// person's claim, the only form the command line takes.
import { expect, test } from "bun:test";
import { make, type P } from "./lib.ts";

function card(p: P, id: string, title: string, parent: string, status = "decided"): void {
  p.card(id, { title, parent, status, who: "me" });
}
function storage(p: P): void {
  p.card("root", { title: "Root", status: "decided", who: "me" });
  card(p, "storage", "Storage", "root");
}
const show = (p: P, id: string) => p.w("show", id);
/** The ids of the cards that refine `id`, as show lists them. */
async function children(p: P, id: string): Promise<string[]> {
  const out = (await show(p, id)).out;
  return [...out.matchAll(/^\s+<- refines\s+(\S+)/gm)].map((m) => m[1] as string);
}

test("66.1 an agent removes a bad branch and the log keeps its history", async () => {
  const p = make();
  storage(p);
  card(p, "cache", "Cache", "storage");
  card(p, "index", "Index", "storage");
  card(p, "eviction", "Eviction", "cache");
  const before = p.lines();
  expect((await p.w("remove", "cache", "--actor", "you")).code).toBe(0);
  const c = await show(p, "cache");
  expect(c.out + c.err).toMatch(/removed/);
  const e = await show(p, "eviction");
  expect(e.out + e.err).toMatch(/removed/);
  const kids = await children(p, "storage");
  expect(kids).not.toContain("cache");
  expect(kids).not.toContain("eviction");
  expect(kids).toContain("index");
  expect((await p.w("removed")).out).toContain("cache");
  const after = p.lines();
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after.length).toBe(before.length + 1);
});

test("66.2 a person restores a removed card and its subtree with their links", async () => {
  const p = make();
  storage(p);
  card(p, "budget", "Memory budget", "root");
  card(p, "cache", "Cache", "storage");
  card(p, "eviction", "Eviction", "cache");
  p.seed("edge.added", { from: "cache", to: "budget", type: "depends_on", why: "It fits the budget" });
  expect((await p.w("remove", "cache", "--actor", "you")).code).toBe(0);
  expect((await p.w("restore", "cache", "--actor", "you")).code).toBe(0);
  const c = await show(p, "cache");
  expect(c.code).toBe(0);
  expect(c.out + c.err).not.toMatch(/removed/);
  expect(await children(p, "storage")).toContain("cache");
  expect(await children(p, "cache")).toContain("eviction");
  expect(c.out).toMatch(/-> depends_on\s+budget/);
  expect((await p.w("removed")).out).not.toContain("cache");
});

test("66.3 an agent removes a bad parent but keeps its good children", async () => {
  const p = make();
  storage(p);
  card(p, "bad", "Bad layer", "storage");
  card(p, "write", "Write path", "bad");
  card(p, "read", "Read path", "bad");
  expect((await p.w("remove", "bad", "--actor", "you", "--reparent")).code).toBe(0);
  const b = await show(p, "bad");
  expect(b.out + b.err).toMatch(/removed/);
  const kids = await children(p, "storage");
  expect(kids).toContain("write");
  expect(kids).toContain("read");
  for (const id of ["write", "read"]) {
    const r = await show(p, id);
    expect(r.code).toBe(0);
    expect(r.out + r.err).not.toMatch(/removed/);
  }
});

test("66.4 an agent finds the open cards it can work on in a subtree", async () => {
  const p = make();
  storage(p);
  card(p, "pp", "Postponed basis", "root");
  card(p, "rj", "Rejected basis", "root");
  card(p, "cache", "Cache", "storage", "open");
  card(p, "index", "Index", "storage", "open");
  card(p, "backup", "Backup", "storage", "open");
  card(p, "quota", "Quota", "storage", "open");
  card(p, "outside", "Outside", "root", "open");
  p.seed("edge.added", { from: "backup", to: "pp", type: "depends_on", why: "x" });
  p.seed("edge.added", { from: "quota", to: "rj", type: "depends_on", why: "x" });
  expect((await p.w("reopen", "pp", "--reason", "postponed", "--why", "later")).code).toBe(0);
  expect((await p.w("reopen", "rj", "--reason", "rejected", "--why", "wrong")).code).toBe(0);
  const out = (await p.w("find", "storage")).out;
  expect(out).toMatch(/\bcache\b/);
  expect(out).toMatch(/\bindex\b/);
  expect(out).not.toMatch(/\bbackup\b/);
  expect(out).not.toMatch(/\bquota\b/);
  expect(out).not.toMatch(/\boutside\b/);
});

test("66.5 a removed branch drops out of the find result and comes back after a restore", async () => {
  const p = make();
  storage(p);
  card(p, "cache", "Cache", "storage", "open");
  card(p, "index", "Index", "storage", "open");
  expect((await p.w("remove", "cache", "--actor", "you")).code).toBe(0);
  let out = (await p.w("find", "storage")).out;
  expect(out).toMatch(/\bindex\b/);
  expect(out).not.toMatch(/\bcache\b/);
  expect((await p.w("restore", "cache", "--actor", "you")).code).toBe(0);
  out = (await p.w("find", "storage")).out;
  expect(out).toMatch(/\bindex\b/);
  expect(out).toMatch(/\bcache\b/);
});

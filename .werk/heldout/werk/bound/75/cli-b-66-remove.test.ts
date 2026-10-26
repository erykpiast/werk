import { expect, test } from "bun:test";
import type { Project } from "../src/test/project.ts";
import { card, decided, dep, lines, ok, withMap } from "./cli-b-helpers.ts";

const refinesRows = (out: string) =>
  out
    .split("\n")
    .filter((l) => l.startsWith("  <- refines"))
    .map((l) => l.trim().split(/\s+/)[2]);
const showAll = async (p: Project, id: string) => {
  const r = await p.werk(["show", id]);
  return { code: r.code, text: `${r.out}${r.err}` };
};

test("66.1", async () => {
  const p = withMap([
    card("storage", "Storage"),
    card("cache", "Cache", { parent: "storage" }),
    card("index", "Index", { parent: "storage" }),
    card("eviction", "Eviction", { parent: "cache" }),
  ]);
  const before = lines(p);
  await ok(p, ["remove", "cache", "--actor", "you"]);
  const c = await showAll(p, "cache");
  const e = await showAll(p, "eviction");
  console.log(c, e);
  expect(c.text).toContain("removed");
  expect(e.text).toContain("removed");
  const rows = refinesRows((await ok(p, ["show", "storage"])).out);
  expect(rows).not.toContain("cache");
  expect(rows).not.toContain("eviction");
  expect(rows).toContain("index");
  const removed = (await ok(p, ["removed"])).out;
  console.log(removed);
  expect(removed).toMatch(/^cache: removed/m);
  const after = lines(p);
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after).toHaveLength(before.length + 1);
});

test("66.2", async () => {
  const p = withMap([
    card("storage", "Storage"),
    card("cache", "Cache", { parent: "storage" }),
    card("eviction", "Eviction", { parent: "cache" }),
    ...decided("memory", "Memory budget"),
    dep("cache", "memory"),
  ]);
  await ok(p, ["remove", "cache", "--actor", "you"]);
  await ok(p, ["restore", "cache", "--actor", "you"]);
  const c = await showAll(p, "cache");
  console.log(c.text);
  expect(c.code).toBe(0);
  expect(c.text).not.toContain("removed");
  expect(refinesRows((await ok(p, ["show", "storage"])).out)).toContain("cache");
  expect(refinesRows(c.text)).toContain("eviction");
  expect(c.text).toContain("  -> depends_on      memory  Memory budget\n");
  const removed = (await ok(p, ["removed"])).out;
  expect(removed).not.toContain("cache");
});

test("66.3", async () => {
  const p = withMap([
    card("storage", "Storage"),
    card("bad", "Bad layer", { parent: "storage" }),
    card("write", "Write path", { parent: "bad" }),
    card("read", "Read path", { parent: "bad" }),
  ]);
  await ok(p, ["remove", "bad", "--reparent", "--actor", "you"]);
  const b = await showAll(p, "bad");
  console.log(b);
  expect(b.text).toContain("removed");
  const rows = refinesRows((await ok(p, ["show", "storage"])).out);
  expect(rows).toContain("write");
  expect(rows).toContain("read");
  for (const id of ["write", "read"]) {
    const s = await showAll(p, id);
    expect(s.code).toBe(0);
    expect(s.text).not.toContain("removed");
    expect(s.text).toContain("parent: storage  Storage");
  }
});

test("66.4", async () => {
  const p = withMap([
    ...decided("storage", "Storage"),
    card("cache", "Cache", { parent: "storage" }),
    card("index", "Index", { parent: "storage" }),
    card("backup", "Backup", { parent: "storage" }),
    card("quota", "Quota", { parent: "storage" }),
    ...decided("pp", "Postponed basis"),
    ...decided("rr", "Rejected basis"),
    card("outside", "Outside open"),
    dep("backup", "pp"),
    dep("quota", "rr"),
    ["node.reopened", { id: "pp", reason: "postponed" }],
    ["node.reopened", { id: "rr", reason: "rejected" }],
  ]);
  const out = (await ok(p, ["find", "storage"])).out;
  console.log(out);
  const ids = out.trimEnd().split("\n").map((l) => l.split("  ")[0]);
  expect(ids).toContain("cache");
  expect(ids).toContain("index");
  for (const gone of ["backup", "quota", "outside"]) expect(ids).not.toContain(gone);
});

test("66.5", async () => {
  const p = withMap([
    ...decided("storage", "Storage"),
    card("cache", "Cache", { parent: "storage" }),
    card("index", "Index", { parent: "storage" }),
  ]);
  await ok(p, ["remove", "cache", "--actor", "you"]);
  const ids = (out: string) => out.trimEnd().split("\n").map((l) => l.split("  ")[0]);
  const first = ids((await ok(p, ["find", "storage"])).out);
  expect(first).toContain("index");
  expect(first).not.toContain("cache");
  await ok(p, ["restore", "cache", "--actor", "you"]);
  const second = ids((await ok(p, ["find", "storage"])).out);
  expect(second).toContain("index");
  expect(second).toContain("cache");
});

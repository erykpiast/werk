import { expect, test } from "bun:test";
import type { Project } from "../src/test/project.ts";
import { fresh, ok, seed } from "./cli-helpers.ts";

const dec = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.added",
  payload: { id, kind: "card", title: `Card ${id}`, parent: "root", status: "decided", who: "me", ...extra },
});
const dep = (from: string, to: string) => ({
  type: "edge.added",
  payload: { from, to, type: "depends_on", why: `${from} uses ${to}` },
});
const facts = (id: string) => [
  { type: "node.edited", payload: { id, no_basis: "none", unchallenged: "none" } },
  { type: "kill.added", payload: { id, criterion: { form: "revisit" } } },
];
const open = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.added",
  payload: { id, kind: "card", title: `Card ${id}`, parent: "root", ...extra },
});

async function stale(p: Project, ...a: string[]) {
  return (await ok(p, ["stale", ...a])).out;
}
const ids = (out: string) => out.split("\n").filter(Boolean);

test("65.1 rejected reopen marks next hop only", async () => {
  const p = fresh([dec("a"), dec("b"), dec("c"), dep("b", "a"), dep("c", "b"), ...facts("a")]);
  await ok(p, ["reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong"]);
  const out = await stale(p);
  const bLine = ids(out).findIndex((l) => /#?\bb\b/.test(l));
  expect(bLine).toBeGreaterThanOrEqual(0);
  expect(out).toMatch(/\bb\b/);
  expect(out).toMatch(/\ba\b/);
  expect(out).toMatch(/depends_on/);
  expect(out).toMatch(/rejected/);
  expect(out).not.toMatch(/(^|\s)#?c\s/m);
  const c = (await ok(p, ["show", "c"])).out;
  expect(c).not.toMatch(/stale|paused/i);
  const b = (await ok(p, ["show", "b"])).out;
  expect(b).toMatch(/stale/i);
});

test("65.2 postponed pauses every downstream card", async () => {
  const p = fresh([
    open("a", { status: "decided", who: "me" }),
    dec("b"),
    dec("c"),
    dec("d"),
    dep("b", "a"),
    dep("c", "b"),
    dep("d", "c"),
    ...facts("a"),
  ]);
  await ok(p, ["reopen", "a", "--reason", "postponed", "--why", "the engine build waits for next quarter"]);
  for (const id of ["b", "c", "d"]) expect((await ok(p, ["show", id])).out).toMatch(/paused/i);
  expect((await ok(p, ["show", "d"])).out).toContain("[decided]");
  const out = await stale(p);
  const dl = ids(out).find((l) => /\bd\b/.test(l)) ?? "";
  expect(out).toMatch(/paused/);
  expect(out).toMatch(/\bd\b/);
  expect(out).toContain("postponed");
  expect(out).toMatch(/\ba\b/);
  expect(dl).not.toBe("");
  for (const id of ["b", "c", "d"]) expect((await ok(p, ["show", id])).out).not.toMatch(/stale/i);
  expect(out).not.toMatch(/\bstale\b/);
});

test("65.3 stale wins over paused", async () => {
  const p = fresh([
    dec("a"),
    dec("b"),
    dec("c", { parent: "b" }),
    dep("c", "a"),
    ...facts("a"),
    ...facts("b"),
  ]);
  await ok(p, ["reopen", "a", "--reason", "postponed"]);
  await ok(p, ["reopen", "b", "--reason", "rejected"]);
  const c = (await ok(p, ["show", "c"])).out;
  expect(c.split("\n")[0]).toMatch(/stale/);
  expect(c.split("\n")[0]).not.toMatch(/paused/);
  const out = await stale(p);
  const line = out.split("\n").find((l) => /\bc\b/.test(l) && l.includes("[")) ?? out;
  expect(out).toMatch(/\bc\b/);
  expect(out).toMatch(/rejected/);
  expect(out).toMatch(/\bb\b/);
  expect(line).toBeTruthy();
});

test("65.4 rederive clears one card", async () => {
  const p = fresh([dec("a"), dec("b"), dec("c"), dep("b", "a"), dep("c", "a"), ...facts("a")]);
  await ok(p, ["reopen", "a", "--reason", "rejected"]);
  const before = await stale(p);
  expect(before).toMatch(/\bb\b/);
  expect(before).toMatch(/\bc\b/);
  await ok(p, ["rederive", "b", "--confirm", "a"]);
  const out = await stale(p);
  expect(out).not.toMatch(/(^|[\s#])b\s/m);
  expect(out).toMatch(/\bc\b/);
  expect(out).toMatch(/rejected/);
  expect((await ok(p, ["show", "b"])).out).not.toMatch(/stale/i);
});

test("65.5 deciding a postponed card clears paused", async () => {
  const p = fresh([dec("a"), dec("b"), dec("c"), dep("b", "a"), dep("c", "b"), ...facts("a")]);
  await ok(p, ["reopen", "a", "--reason", "postponed"]);
  expect((await ok(p, ["show", "b"])).out).toMatch(/paused/i);
  expect((await ok(p, ["show", "c"])).out).toMatch(/paused/i);
  await ok(p, ["status", "a", "decided"]);
  for (const id of ["b", "c"]) expect((await ok(p, ["show", id])).out).not.toMatch(/paused/i);
  const out = await stale(p);
  expect(out).not.toMatch(/\bb\b/);
  expect(out).not.toMatch(/\bc\b/);
  expect((await ok(p, ["show", "c"])).out).toContain("[decided]");
});

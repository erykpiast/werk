import { expect, test } from "bun:test";
import { card, ok, seed, withRoot } from "./h.ts";

const edge = (from: string, to: string, type: string, why?: string) => ({
  type: "edge.added",
  payload: { from, to, type, ...(why ? { why } : {}) },
});
const dec = (id: string, extra: Record<string, unknown> = {}) => card(id, id.toUpperCase(), { status: "decided", parent: "root", ...extra });
const head = (out: string) => out.split("\n")[0];

test("65.1 rejected reopen marks only the next hop", async () => {
  const p = withRoot();
  seed(p, [dec("a"), dec("b"), dec("c"), edge("b", "a", "depends_on", "uses a"), edge("c", "b", "depends_on", "uses b")]);
  await ok(p, "reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong");
  const st = (await ok(p, "stale")).out;
  expect(st).toMatch(/\bb\b/);
  expect(st).toContain("rejected");
  expect(st).toContain("#a");
  expect(st).toContain("depends_on");
  expect(st).not.toMatch(/(^|\s)#?c\s+C/m);
  const c = (await ok(p, "show", "c")).out;
  expect(c).not.toMatch(/stale|paused/i);
  const b = (await ok(p, "show", "b")).out;
  expect(b).toMatch(/stale/i);
});

test("65.2 postponed reopen pauses every downstream card", async () => {
  const p = withRoot();
  seed(p, [
    dec("a"),
    card("b", "B", { parent: "root" }),
    card("c", "C", { parent: "root" }),
    dec("d"),
    edge("b", "a", "depends_on", "x"),
    edge("c", "b", "depends_on", "x"),
    edge("d", "c", "depends_on", "x"),
  ]);
  await ok(p, "reopen", "a", "--reason", "postponed", "--why", "the engine build waits for next quarter");
  for (const id of ["b", "c", "d"]) expect((await ok(p, "show", id)).out).toMatch(/paused/i);
  expect(head((await ok(p, "show", "d")).out)).toContain("[decided]");
  const st = (await ok(p, "stale")).out;
  expect(st).toMatch(/d[^\n]*paused|paused[^\n]*\bd\b|PAUSED[^\n]*#d/i);
  expect(st).toContain("#a");
  expect(st).toContain("postponed");
  for (const id of ["b", "c", "d"]) expect((await ok(p, "show", id)).out).not.toMatch(/\bstale\b/i);
});

test("65.3 stale wins over paused", async () => {
  const p = withRoot();
  seed(p, [dec("a"), dec("b"), card("c", "C", { status: "decided", parent: "b" }), edge("c", "a", "depends_on", "x")]);
  await ok(p, "reopen", "a", "--reason", "postponed");
  await ok(p, "reopen", "b", "--reason", "rejected");
  const c = (await ok(p, "show", "c")).out;
  expect(head(c)).toMatch(/stale/);
  expect(head(c)).not.toMatch(/paused/);
  const st = (await ok(p, "stale")).out;
  expect(st).toMatch(/^stale\s+c\b/m);
  expect(st).not.toMatch(/^paused\s+c\b/m);
  expect(st).toMatch(/from #b, rejected/);
});

test("65.4 rederive clears one card only", async () => {
  const p = withRoot();
  seed(p, [dec("a"), dec("b"), dec("c"), edge("b", "a", "depends_on", "uses a"), edge("c", "a", "depends_on", "uses a")]);
  await ok(p, "reopen", "a", "--reason", "rejected", "--why", "bad");
  const st0 = (await ok(p, "stale")).out;
  expect(st0).toMatch(/\bb\b/);
  expect(st0).toMatch(/\bc\b/);
  await ok(p, "rederive", "b", "--confirm", "a");
  const st = (await ok(p, "stale")).out;
  expect(st).not.toMatch(/^\S*\s*#?b\b/m);
  expect(st).toMatch(/\bc\b/);
  expect(st).toContain("rejected");
  expect(st).toContain("#a");
  expect((await ok(p, "show", "b")).out).not.toMatch(/stale/i);
});

test("65.5 deciding a postponed card again clears paused marks", async () => {
  const p = withRoot();
  seed(p, [
    card("a", "A", { status: "decided", who: "me", no_basis: "top", parent: "root" }),
    { type: "kill.added", payload: { id: "a", criterion: { form: "revisit" } } },
    { type: "node.added", payload: { id: "a:opt", kind: "option", title: "Alt", why_not: "slow" } },
    edge("a:opt", "a", "alternative_to"),
    card("b", "B", { status: "decided", parent: "root" }),
    card("c", "C", { status: "proto", parent: "root" }),
    edge("b", "a", "depends_on", "x"),
    edge("c", "b", "depends_on", "x"),
  ]);
  await ok(p, "reopen", "a", "--reason", "postponed", "--why", "later");
  for (const id of ["b", "c"]) expect((await ok(p, "show", id)).out).toMatch(/paused/i);
  await ok(p, "status", "a", "decided");
  for (const id of ["b", "c"]) expect((await ok(p, "show", id)).out).not.toMatch(/paused/i);
  const st = (await ok(p, "stale")).out;
  expect(st).not.toMatch(/\bb\b/);
  expect(st).not.toMatch(/\bc\b/);
  expect(head((await ok(p, "show", "c")).out)).toContain("[proto]");
});

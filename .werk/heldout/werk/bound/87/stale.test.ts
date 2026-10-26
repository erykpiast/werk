import { expect, test } from "bun:test";
import { card, ok, type Project, seed, w, withRoot } from "./lib.ts";

const dep = (p: Project, from: string, to: string) => seed(p, "edge.added", { from, to, type: "depends_on", why: `${from} takes from ${to}` });
/** A decided card with every fact so that it can be decided again. */
function full(p: Project, id: string, parent: string | undefined = "root") {
  card(p, id, { title: id.toUpperCase(), parent });
  seed(p, "kill.added", { id, criterion: { form: "revisit" } });
}
const mk = (ids: string[]) => {
  const p = withRoot();
  for (const id of ids) full(p, id);
  return p;
};

test("65.1 rejected reopen marks only the next hop stale", async () => {
  const p = mk(["a", "b", "c"]);
  dep(p, "b", "a");
  dep(p, "c", "b");
  await ok(p, "reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong");
  const st = (await ok(p, "stale")).out;
  expect(st).toMatch(/\bb\b/);
  expect(st).toContain("a");
  expect(st).toContain("rejected");
  expect(st).toContain("depends_on");
  const lines = st.split("\n").filter((l) => /^\S*\s*(#?c)\b/.test(l));
  expect(lines.length).toBe(0);
  const c = (await ok(p, "show", "c")).out;
  expect(c).not.toMatch(/stale|paused|waiting/i);
});

test("65.2 postponed reopen pauses every downstream card, keeps status", async () => {
  const p = mk(["a", "b", "c", "d"]);
  dep(p, "b", "a");
  dep(p, "c", "b");
  dep(p, "d", "c");
  await ok(p, "reopen", "a", "--reason", "postponed", "--why", "the engine build waits for next quarter");
  for (const id of ["b", "c", "d"]) expect((await ok(p, "show", id)).out).toMatch(/paused/i);
  expect((await ok(p, "show", "d")).out).toContain("[decided]");
  const st = (await ok(p, "stale", "d")).out;
  expect(st).toMatch(/paused/i);
  expect(st).toContain("postponed");
  expect(st).toContain("a");
  const stale = (await ok(p, "stale", "--kind", "stale")).out;
  expect(stale).not.toMatch(/[bcd]\b.*stale/);
  for (const id of ["b", "c", "d"]) expect((await ok(p, "show", id)).out).not.toMatch(/\bstale\b/i);
});

test("65.3 stale wins over paused", async () => {
  const p = mk(["a", "b"]);
  full(p, "c", "b");
  dep(p, "c", "a");
  await ok(p, "reopen", "a", "--reason", "postponed", "--why", "later");
  await ok(p, "reopen", "b", "--reason", "rejected", "--why", "nope");
  const c = (await ok(p, "show", "c")).out;
  expect(c.split("\n")[0]).toMatch(/stale/i);
  expect(c.split("\n")[0]).not.toMatch(/paused/i);
  const st = (await ok(p, "stale", "c")).out;
  expect(st).toMatch(/stale/i);
  expect(st).not.toMatch(/paused/i);
  expect(st).toContain("b");
  expect(st).toContain("rejected");
});

test("65.4 rederive clears one card", async () => {
  const p = mk(["a", "b", "c"]);
  dep(p, "b", "a");
  dep(p, "c", "a");
  await ok(p, "reopen", "a", "--reason", "rejected", "--why", "bad");
  const before = (await ok(p, "stale")).out;
  expect(before).toMatch(/\bb\b/);
  expect(before).toMatch(/\bc\b/);
  const r = await w(p, "rederive", "b", "--confirm", "a");
  expect(r.code, r.err).toBe(0);
  const after = (await ok(p, "stale")).out;
  expect(after).not.toMatch(/^\s*\S*\s*b\b/m);
  expect(after).toMatch(/\bc\b/);
  expect(after).toContain("rejected");
  expect((await ok(p, "show", "b")).out).not.toMatch(/stale/i);
});

test("65.5 deciding a postponed card again clears the paused marks", async () => {
  const p = mk(["a", "b", "c"]);
  dep(p, "b", "a");
  dep(p, "c", "b");
  await ok(p, "reopen", "a", "--reason", "postponed", "--why", "later");
  expect((await ok(p, "show", "b")).out).toMatch(/paused/i);
  expect((await ok(p, "show", "c")).out).toMatch(/paused/i);
  const d = await w(p, "status", "a", "decided");
  expect(d.code, d.err).toBe(0);
  for (const id of ["b", "c"]) expect((await ok(p, "show", id)).out).not.toMatch(/paused/i);
  const st = (await ok(p, "stale")).out;
  expect(st).not.toMatch(/\b[bc]\b/);
  expect((await ok(p, "show", "c")).out).toContain("[decided]");
});

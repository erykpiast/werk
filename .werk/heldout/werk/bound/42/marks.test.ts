import { expect, test } from "bun:test";
import { mk } from "./h.ts";

const first = (s: string) => s.split("\n")[0] ?? "";
const staleLine = (s: string, id: string) => s.split("\n").find((l) => new RegExp(`^(stale|paused|waiting)\\s+${id}\\s`).test(l));

function abc(h: ReturnType<typeof mk>, ids = ["a", "b", "c"]) {
  for (const id of ids) {
    h.real(id, id.toUpperCase());
    h.decide(id);
  }
}

test("[65.1] rejected reopen marks only the next hop stale", async () => {
  const h = mk();
  abc(h);
  h.edge("b", "a", "depends_on", "b needs a");
  h.edge("c", "b", "depends_on", "c needs b");
  const r = await h.w("reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong");
  expect(r.code).toBe(0);
  const s = await h.out("stale");
  console.log(s);
  expect(s).toMatch(/\bb\b/);
  expect(s).toMatch(/\bstale\b/);
  expect(s).toContain("rejected");
  const sb = await h.out("show", "b");
  console.log(sb);
  expect(s).toContain("depends_on");
  expect(s).toMatch(/#?a\b/);
  expect(s.split("\n").some((l) => /^\s*c\b/.test(l))).toBe(false);
  const c = first(await h.out("show", "c"));
  expect(c).not.toMatch(/stale|paused/);
  expect(first(await h.out("show", "b"))).toContain("stale");
});

test("[65.2] postponed reopen pauses every card downstream", async () => {
  const h = mk();
  abc(h, ["a", "b", "c", "d"]);
  h.edge("b", "a", "depends_on", "x");
  h.edge("c", "b", "depends_on", "x");
  h.edge("d", "c", "depends_on", "x");
  await h.w("reopen", "a", "--reason", "postponed", "--why", "the engine build waits for next quarter");
  for (const id of ["b", "c", "d"]) expect(first(await h.out("show", id))).toContain("paused");
  expect(first(await h.out("show", "d"))).toContain("[decided]");
  const s = await h.out("stale");
  console.log(s);
  const d = staleLine(s, "d");
  expect(d).toBeTruthy();
  expect(s).toContain("postponed");
  for (const id of ["b", "c", "d"]) expect(first(await h.out("show", id))).not.toMatch(/\bstale\b/);
  const sd = await h.out("stale", "d");
  expect(sd).toMatch(/paused/);
  expect(sd).toMatch(/\ba\b/);
});

test("[65.3] stale wins over paused", async () => {
  const h = mk();
  abc(h);
  h.edge("c", "a", "depends_on", "x");
  h.edge("c", "b", "refines");
  await h.w("reopen", "a", "--reason", "postponed", "--why", "later");
  await h.w("reopen", "b", "--reason", "rejected", "--why", "wrong");
  const c = first(await h.out("show", "c"));
  expect(c).toContain("stale");
  expect(c).not.toContain("paused");
  const s = await h.out("stale");
  console.log(s);
  const sc = await h.out("stale", "c");
  console.log(sc);
  expect(sc).toContain("rejected");
  expect(sc).toMatch(/\bb\b/);
});

test("[65.4] rederive clears one card", async () => {
  const h = mk();
  abc(h);
  h.edge("b", "a", "depends_on", "x");
  h.edge("c", "a", "depends_on", "x");
  await h.w("reopen", "a", "--reason", "rejected", "--why", "wrong");
  const s0 = await h.out("stale");
  expect(staleLine(s0, "b")).toBeTruthy();
  expect(staleLine(s0, "c")).toBeTruthy();
  const r = await h.w("rederive", "b", "--confirm", "a");
  console.log(r.out + r.err);
  expect(r.code).toBe(0);
  const s1 = await h.out("stale");
  console.log(s1);
  expect(staleLine(s1, "b")).toBeFalsy();
  expect(staleLine(s1, "c")).toBeTruthy();
  expect(s1).toContain("rejected");
  expect(first(await h.out("show", "b"))).not.toContain("stale");
});

test("[65.5] deciding a postponed card again clears pauses", async () => {
  const h = mk();
  h.real("x", "X basis");
  h.decide("x");
  h.real("a", "A", undefined, { who: "you" });
  h.edge("a", "x", "depends_on", "uses x");
  h.seed("node.added", { id: "a:opt0", kind: "option", title: "Alt", why_not: "lost" });
  h.edge("a:opt0", "a", "alternative_to");
  h.seed("kill.added", { id: "a", criterion: { form: "revisit" } });
  h.decide("a");
  h.real("b", "B");
  h.decide("b");
  h.real("c", "C");
  h.decide("c");
  h.edge("b", "a", "depends_on", "x");
  h.edge("c", "b", "depends_on", "x");
  await h.w("reopen", "a", "--reason", "postponed", "--why", "later");
  expect(first(await h.out("show", "b"))).toContain("paused");
  expect(first(await h.out("show", "c"))).toContain("paused");
  const d = await h.w("status", "a", "decided");
  console.log(d.out + d.err);
  expect(d.code).toBe(0);
  expect(first(await h.out("show", "b"))).not.toContain("paused");
  expect(first(await h.out("show", "c"))).not.toContain("paused");
  const s = await h.out("stale");
  console.log(s);
  expect(staleLine(s, "b")).toBeFalsy();
  expect(staleLine(s, "c")).toBeFalsy();
  expect(first(await h.out("show", "c"))).toContain("[decided]");
});

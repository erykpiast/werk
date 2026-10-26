import { afterEach, expect, test } from "bun:test";
import { head } from "./b-helpers.ts";
import { cleanupAll, type P, project } from "./cli.ts";

afterEach(cleanupAll);

/** A decided card that passes the decide check again: who, an option, a kill criterion. */
function card(p: P, id: string, title: string) {
  p.card(id, title, { parent: "root", status: "decided", who: "you" });
  p.seed("node.added", { id: `${id}:opt0`, kind: "option", title: `Not ${title}`, why_not: "worse" });
  p.seed("edge.added", { from: `${id}:opt0`, to: id, type: "alternative_to" });
  p.seed("kill.added", { id, criterion: { form: "revisit" } });
  p.seed("node.edited", { id, no_basis: "a root decision" });
}
const dep = (p: P, from: string, to: string) =>
  p.seed("edge.added", { from, to, type: "depends_on", why: `${from} uses ${to}` });

/** The stale list as entries: kind, id, and the cause line under it. */
function staleList(p: P) {
  const lines = p.werk("stale").out.split("\n");
  const out: { kind: string; id: string; cause: string }[] = [];
  lines.forEach((l, i) => {
    const m = /^(stale|paused|waiting)\s+(\S+)/.exec(l);
    if (m) out.push({ kind: m[1] as string, id: m[2] as string, cause: lines[i + 1] ?? "" });
  });
  return out;
}

test("65.1 a rejected reopen marks only the next hop", () => {
  const p = project();
  p.card("root", "Root");
  card(p, "a", "Card A");
  card(p, "b", "Card B");
  card(p, "c", "Card C");
  dep(p, "b", "a");
  dep(p, "c", "b");
  expect(p.werk("reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong").code).toBe(0);
  const list = staleList(p);
  const b = list.find((e) => e.id === "b");
  expect(b?.kind).toBe("stale");
  expect(b?.cause).toContain("#a");
  expect(b?.cause).toContain("rejected");
  // The step asks the entry to name the depends_on link; the show of b names it.
  expect(p.werk("stale").out + p.werk("show", "b").out).toMatch(/b -> a depends_on/);
  expect(p.werk("stale").out).toMatch(/depends_on/);
  expect(list.find((e) => e.id === "c")).toBeUndefined();
  expect(head(p, "c")).not.toMatch(/stale|paused/);
});

test("65.2 a postponed reopen pauses every downstream card", () => {
  const p = project();
  p.card("root", "Root");
  card(p, "a", "Card A");
  card(p, "b", "Card B");
  card(p, "c", "Card C");
  card(p, "d", "Card D");
  dep(p, "b", "a");
  dep(p, "c", "b");
  dep(p, "d", "c");
  expect(p.werk("reopen", "a", "--reason", "postponed", "--why", "the engine build waits for next quarter").code).toBe(
    0,
  );
  for (const id of ["b", "c", "d"]) expect(head(p, id)).toContain("paused");
  expect(head(p, "d")).toContain("[decided]");
  const d = staleList(p).find((e) => e.id === "d");
  expect(d?.kind).toBe("paused");
  expect(d?.cause).toContain("#a");
  expect(d?.cause).toContain("postponed");
  for (const id of ["a", "b", "c", "d"]) expect(head(p, id)).not.toMatch(/\bstale\b/);
});

test("65.3 stale wins over paused on the same card", () => {
  const p = project();
  p.card("root", "Root");
  card(p, "a", "Card A");
  card(p, "b", "Card B");
  p.card("c", "Card C", { parent: "b", status: "decided" });
  dep(p, "c", "a");
  expect(p.werk("reopen", "a", "--reason", "postponed", "--why", "later").code).toBe(0);
  expect(p.werk("reopen", "b", "--reason", "rejected", "--why", "wrong").code).toBe(0);
  expect(head(p, "c")).toMatch(/\bstale\b/);
  expect(head(p, "c")).not.toMatch(/paused/);
  const c = staleList(p).filter((e) => e.id === "c");
  expect(c.length).toBeGreaterThan(0);
  expect(c[0]?.kind).toBe("stale");
  expect(c[0]?.cause).toContain("#b");
  expect(c[0]?.cause).toContain("rejected");
});

test("65.4 rederive clears one card and leaves the others", () => {
  const p = project();
  p.card("root", "Root");
  card(p, "a", "Card A");
  card(p, "b", "Card B");
  card(p, "c", "Card C");
  dep(p, "b", "a");
  dep(p, "c", "a");
  expect(p.werk("reopen", "a", "--reason", "rejected", "--why", "wrong").code).toBe(0);
  expect(
    staleList(p)
      .map((e) => e.id)
      .sort(),
  ).toEqual(["b", "c"]);
  const r = p.werk("rederive", "b", "--confirm", "a");
  expect({ code: r.code, out: r.all }).toEqual({ code: 0, out: expect.any(String) });
  const list = staleList(p);
  expect(list.find((e) => e.id === "b")).toBeUndefined();
  const c = list.find((e) => e.id === "c");
  expect(c?.kind).toBe("stale");
  expect(c?.cause).toContain("#a");
  expect(c?.cause).toContain("rejected");
  expect(head(p, "b")).not.toMatch(/stale/);
});

test("65.5 deciding a postponed card again clears paused marks", () => {
  const p = project();
  p.card("root", "Root");
  card(p, "a", "Card A");
  card(p, "b", "Card B");
  card(p, "c", "Card C");
  dep(p, "b", "a");
  dep(p, "c", "b");
  const statusBefore = /\[(\w+)\]/.exec(head(p, "c"))?.[1];
  expect(p.werk("reopen", "a", "--reason", "postponed", "--why", "later").code).toBe(0);
  expect(head(p, "b")).toContain("paused");
  expect(head(p, "c")).toContain("paused");
  const r = p.werk("status", "a", "decided");
  expect(r.code).toBe(0);
  expect(head(p, "b")).not.toContain("paused");
  expect(head(p, "c")).not.toContain("paused");
  const ids = staleList(p).map((e) => e.id);
  expect(ids).not.toContain("b");
  expect(ids).not.toContain("c");
  expect(/\[(\w+)\]/.exec(head(p, "c"))?.[1]).toBe(statusBefore);
});

import { expect, test } from "bun:test";
import { all, card, events, freshProject, logLines, root, seed, w } from "./helpers.ts";

const dec = { status: "decided", who: "me" };
type P = ReturnType<typeof freshProject>;
const dep = (p: P, from: string, to: string) => seed(p, "edge.added", { from, to, type: "depends_on", why: "takes it" });
const full = (p: P, id: string, extra: Record<string, unknown> = {}) => {
  card(p, id, { title: id, ...dec, ...extra });
  seed(p, "node.edited", { id, no_basis: "none" });
  seed(p, "kill.added", { id, criterion: { form: "revisit" } });
};

test("[64.1] a card that lacks a kill criterion stays open, and the printed command fixes it", async () => {
  const p = freshProject();
  root(p);
  full(p, "base");
  card(p, "c", { title: "C", status: "open", who: "me" });
  dep(p, "c", "base");
  seed(p, "node.added", { id: "c:opt0", kind: "option", title: "Alt", why_not: "slow" });
  seed(p, "edge.added", { from: "c:opt0", to: "c", type: "alternative_to" });
  const n = logLines(p).length;
  const r = await w(p, "status", "c", "decided");
  expect(r.code).not.toBe(0);
  expect(all(r)).toContain("kill criterion");
  expect(all(r)).toContain("werk kill c ");
  expect(all(await w(p, "show", "c"))).toContain("[open]");
  expect(logLines(p).length).toBe(n);
  const fix = await w(p, "kill", "c", "--revisit");
  expect(fix.code, all(fix)).toBe(0);
  const r2 = await w(p, "status", "c", "decided");
  expect(r2.code, all(r2)).toBe(0);
  expect(all(await w(p, "show", "c"))).toContain("[decided]");
});

test("[64.2] a card that lacks several facts reports each with its own command", async () => {
  const p = freshProject();
  root(p);
  full(p, "base");
  card(p, "c", { title: "C", body: "text", status: "open" });
  const r = await w(p, "status", "c", "decided");
  expect(r.code).not.toBe(0);
  const o = all(r);
  for (const t of ["who:", "basis:", "option:", "kill criterion:"]) expect(o).toContain(t);
  for (const t of ["werk edit c --who", "werk link c <card> --type depends_on", "werk add c:opt0 --kind option", "werk kill c "])
    expect(o).toContain(t);
  expect(all(await w(p, "show", "c"))).toContain("[open]");
  expect((await w(p, "edit", "c", "--who", "you")).code).toBe(0);
  expect((await w(p, "link", "c", "base", "--type", "depends_on", "--why", "uses base")).code).toBe(0);
  expect((await w(p, "add", "c:opt0", "--kind", "option", "--title", "Alt", "--why_not", "slow")).code).toBe(0);
  expect((await w(p, "accept", "c:opt0", "--actor", "you")).code).toBe(0);
  expect((await w(p, "link", "c:opt0", "c", "--type", "alternative_to")).code).toBe(0);
  expect((await w(p, "kill", "c", "--revisit")).code).toBe(0);
  const d = await w(p, "status", "c", "decided");
  expect(d.code, all(d)).toBe(0);
  expect(all(await w(p, "show", "c"))).toContain("[decided]");
});

test("[64.3] a ghost card obeys the same check through its held edges", async () => {
  const p = freshProject();
  root(p);
  full(p, "base");
  const ghost = async (id: string, withBasis: boolean) => {
    await w(p, "add", id, "--title", id);
    await w(p, "edit", id, "--who", "you");
    if (withBasis) await w(p, "link", id, "base", "--type", "depends_on", "--why", "takes base");
    await w(p, "add", `${id}:opt0`, "--kind", "option", "--title", "Alt", "--why_not", "slow");
    await w(p, "link", `${id}:opt0`, id, "--type", "alternative_to");
    await w(p, "kill", id, "--revisit");
  };
  await ghost("g1", true);
  await ghost("g2", false);
  const a = await w(p, "status", "g1", "decided");
  expect(a.code, all(a)).toBe(0);
  expect(all(await w(p, "show", "g1"))).toContain("[decided]");
  const b = await w(p, "status", "g2", "decided");
  expect(b.code).not.toBe(0);
  expect(all(b)).toContain("basis");
  expect(all(b)).toContain("werk link g2 <card> --type depends_on");
  expect(all(await w(p, "show", "g2"))).not.toContain("[decided]");
});

async function decidedCard(p: P) {
  root(p);
  full(p, "base");
  card(p, "c", { title: "C", body: "Old body.", ...dec });
  dep(p, "c", "base");
  seed(p, "node.added", { id: "c:opt0", kind: "option", title: "Alt", why_not: "slow" });
  seed(p, "edge.added", { from: "c:opt0", to: "c", type: "alternative_to" });
  seed(p, "kill.added", { id: "c", criterion: { form: "revisit" } });
}

test("[64.4] an amend that removes a required fact is refused and the card stays the same", async () => {
  const p = freshProject();
  await decidedCard(p);
  const before = all(await w(p, "show", "c"));
  const n = logLines(p).length;
  const r = await w(p, "unlink", "c", "base", "--type", "depends_on");
  expect(r.code).not.toBe(0);
  expect(all(r)).toContain("basis");
  expect(all(r)).toContain("werk link c <card> --type depends_on");
  expect(all(await w(p, "show", "c"))).toBe(before);
  expect(logLines(p).length).toBe(n);
});

test("[64.5] an amend that keeps every fact succeeds, and card text is not checked", async () => {
  const p = freshProject();
  await decidedCard(p);
  const n = logLines(p).length;
  const pr = await w(p, "propose", "c", "--ops", JSON.stringify([{ tag: "elaborated", old: "Old body.", new: "One short sentence." }]));
  expect(pr.code, all(pr)).toBe(0);
  const a = await w(p, "accept", "c", "--actor", "you");
  expect(a.code, all(a)).toBe(0);
  const s = all(await w(p, "show", "c"));
  expect(s).toContain("[decided]");
  expect(s).toContain("One short sentence.");
  const types = events(p).slice(n).map((e) => e.type);
  expect(types).toContain("node.reopened");
  expect(types).toContain("node.decided");
});

// ---- stale and paused (65)
function chain3(p: P) {
  root(p);
  for (const id of ["a", "b", "c"]) full(p, id);
  dep(p, "b", "a");
  dep(p, "c", "b");
}

test("[65.1] a rejected reopen marks only the next hop as stale", async () => {
  const p = freshProject();
  chain3(p);
  const r = await w(p, "reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong");
  expect(r.code, all(r)).toBe(0);
  const s = all(await w(p, "stale"));
  expect(s).toMatch(/b/);
  expect(s).toContain("a");
  expect(s).toContain("depends_on");
  expect(s).toContain("rejected");
  const lines = s.split("\n").filter((l) => /^\s*#?c\b|\bc\s+C\b/.test(l));
  expect(lines.length).toBe(0);
  const c = all(await w(p, "show", "c"));
  expect(c).not.toMatch(/stale|paused/i);
});

test("[65.2] a postponed reopen pauses every downstream card and keeps their status", async () => {
  const p = freshProject();
  root(p);
  for (const id of ["a", "b", "c", "d"]) full(p, id);
  dep(p, "b", "a");
  dep(p, "c", "b");
  dep(p, "d", "c");
  await w(p, "reopen", "a", "--reason", "postponed", "--why", "the engine build waits for next quarter");
  for (const id of ["b", "c", "d"]) expect(all(await w(p, "show", id))).toMatch(/paused/i);
  expect(all(await w(p, "show", "d"))).toContain("[decided]");
  const s = all(await w(p, "stale"));
  expect(s).toMatch(/d[\s\S]*paused|paused[\s\S]*d/);
  expect(s).toContain("postponed");
  const st = all(await w(p, "stale", "--kind", "stale"));
  expect(st).not.toMatch(/\bb\b|\bc\b|\bd\b/);
  for (const id of ["b", "c", "d"]) expect(all(await w(p, "show", id))).not.toMatch(/\bstale\b/i);
});

test("[65.3] stale wins when a postponement and a rejection reach the same card", async () => {
  const p = freshProject();
  root(p);
  for (const id of ["a", "b"]) full(p, id);
  full(p, "c", { parent: "b" });
  dep(p, "c", "a");
  await w(p, "reopen", "a", "--reason", "postponed");
  await w(p, "reopen", "b", "--reason", "rejected");
  const c = all(await w(p, "show", "c"));
  expect(c.split("\n")[0]).toMatch(/stale/i);
  expect(c.split("\n")[0]).not.toMatch(/paused/i);
  const s = all(await w(p, "stale"));
  const rows = s.split("\n").filter((l) => /^(stale|paused)\s+c\b/.test(l));
  expect(rows.length).toBe(1);
  expect(rows[0]).toMatch(/^stale/);
  expect(s).toContain("from #b, rejected");
});

test("[65.4] rederive clears the mark on one card and leaves the others", async () => {
  const p = freshProject();
  root(p);
  for (const id of ["a", "b", "c"]) full(p, id);
  dep(p, "b", "a");
  dep(p, "c", "a");
  await w(p, "reopen", "a", "--reason", "rejected", "--why", "bad");
  const before = all(await w(p, "stale"));
  expect(before).toMatch(/\bb\b/);
  expect(before).toMatch(/\bc\b/);
  const r = await w(p, "rederive", "b", "--confirm", "a");
  expect(r.code, all(r)).toBe(0);
  const s = all(await w(p, "stale"));
  const flat = s.split("\n").filter((l) => /^\s*#?b\b|\bb\s+B\b|^b /.test(l));
  expect(s).not.toMatch(/(^|\n)\s*#?b\b/);
  expect(s).toMatch(/\bc\b/);
  expect(s).toContain("rejected");
  expect(flat.length).toBe(0);
  expect(all(await w(p, "show", "b"))).not.toMatch(/stale/i);
});

test("[65.5] deciding a postponed card again clears the paused marks", async () => {
  const p = freshProject();
  root(p);
  for (const id of ["a", "b", "c"]) full(p, id);
  dep(p, "b", "a");
  dep(p, "c", "b");
  await w(p, "reopen", "a", "--reason", "postponed", "--why", "later");
  expect(all(await w(p, "show", "c"))).toMatch(/paused/i);
  const r = await w(p, "status", "a", "decided");
  expect(r.code, all(r)).toBe(0);
  for (const id of ["b", "c"]) expect(all(await w(p, "show", id))).not.toMatch(/paused/i);
  const s = all(await w(p, "stale"));
  expect(s).not.toMatch(/\bb\b|\bc\b/);
  expect(all(await w(p, "show", "c"))).toContain("[decided]");
});

import { expect, test } from "bun:test";
import { card, events, lines, ok, seed, w, withRoot } from "./h.ts";

const edge = (from: string, to: string, type: string, why?: string) => ({
  type: "edge.added",
  payload: { from, to, type, ...(why ? { why } : {}) },
});
const option = (id: string, forCard: string) => [
  { type: "node.added", payload: { id, kind: "option", title: "Alt", why_not: "too slow" } },
  edge(id, forCard, "alternative_to"),
];
const KILL = { type: "kill.added", payload: { id: "c", criterion: { form: "revisit" } } };

function base() {
  const p = withRoot();
  seed(p, [card("base", "Base", { status: "decided", who: "me", parent: "root", no_basis: "top" })]);
  return p;
}

const statusLine = (out: string) => out.split("\n")[0];

test("64.1 missing kill criterion keeps the card open; the printed command fixes it", async () => {
  const p = base();
  seed(p, [card("c", "Card", { who: "me", parent: "root" }), edge("c", "base", "depends_on", "uses base"), ...option("c:opt", "c")]);
  const n = lines(p).length;
  const r = await w(p, "status", "c", "decided");
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("kill criterion");
  expect(r.err).toMatch(/werk kill c --/);
  expect(lines(p).length).toBe(n);
  expect(statusLine((await ok(p, "show", "c")).out)).toContain("[open]");
  const cmd = /werk kill c --revisit/.exec(r.err);
  expect(cmd).not.toBeNull();
  await ok(p, "kill", "c", "--revisit");
  await ok(p, "status", "c", "decided");
  expect(statusLine((await ok(p, "show", "c")).out)).toContain("[decided]");
});

test("64.2 several missing facts each with a command", async () => {
  const p = base();
  seed(p, [card("c", "Card", { body: "just text", parent: "root" })]);
  const r = await w(p, "status", "c", "decided");
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/who:/);
  expect(r.err).toMatch(/basis:/);
  expect(r.err).toMatch(/option:/);
  expect(r.err).toMatch(/kill criterion:/);
  expect(r.err).toContain("werk edit c --who");
  expect(r.err).toContain("werk kill c");
  expect(statusLine((await ok(p, "show", "c")).out)).toContain("[open]");
  await ok(p, "edit", "c", "--who", "me");
  await ok(p, "link", "c", "base", "--type", "depends_on", "--why", "uses base");
  await ok(p, "add", "c:opt", "--kind", "option", "--title", "Alt", "--why_not", "too slow");
  await ok(p, "link", "c:opt", "c", "--type", "alternative_to");
  await ok(p, "accept", "c:opt", "--actor", "you");
  await ok(p, "kill", "c", "--revisit");
  const s = await w(p, "status", "c", "decided");
  expect(s.err + s.out).not.toBe("");
  expect(s.code).toBe(0);
  expect(statusLine((await ok(p, "show", "c")).out)).toContain("[decided]");
});

test("64.3 a ghost card obeys the same check through held edges", async () => {
  const p = base();
  const ghost = (id: string) => ({ type: "node.proposed", payload: { id, kind: "card", title: id, who: "me", parent: "root" } });
  seed(p, [
    ghost("g1"),
    edge("g1", "base", "depends_on", "uses base"),
    { type: "node.proposed", payload: { id: "g1:opt", kind: "option", title: "Alt", why_not: "slow" } },
    edge("g1:opt", "g1", "alternative_to"),
    { type: "kill.added", payload: { id: "g1", criterion: { form: "revisit" } } },
    ghost("g2"),
    { type: "node.proposed", payload: { id: "g2:opt", kind: "option", title: "Alt", why_not: "slow" } },
    edge("g2:opt", "g2", "alternative_to"),
    { type: "kill.added", payload: { id: "g2", criterion: { form: "revisit" } } },
  ]);
  const a = await w(p, "status", "g1", "decided");
  expect(a.code).toBe(0);
  expect(statusLine((await ok(p, "show", "g1")).out)).toContain("[decided]");
  const b = await w(p, "status", "g2", "decided");
  expect(b.code).not.toBe(0);
  expect(b.err).toContain("basis");
  expect(b.err).toMatch(/werk (link|edit) g2/);
  expect(statusLine((await ok(p, "show", "g2")).out)).not.toContain("[decided]");
});

function decided() {
  const p = base();
  seed(p, [
    card("c", "Card", { who: "me", body: "Old body text that is long.", status: "decided", parent: "root" }),
    edge("c", "base", "depends_on", "uses base"),
    ...option("c:opt", "c"),
    KILL,
  ]);
  return p;
}

test("64.4 an amend that removes a required fact is refused", async () => {
  const p = decided();
  const before = (await ok(p, "show", "c")).out;
  // the amend is a proposal that ends in a review; removing the depends_on edge is an unlink first
  const un = await w(p, "unlink", "c", "base", "--type", "depends_on");
  expect(un.err).toContain("basis");
  expect(un.err).toMatch(/werk status base decided|werk edit c --no-basis|werk link c/);
  const after = (await ok(p, "show", "c")).out;
  // unlinking is the only way to drop the edge; the step's amend must refuse
  expect(un.code).not.toBe(0);
  expect(after).toBe(before);
});

test("64.5 an amend that keeps every fact succeeds", async () => {
  const p = decided();
  await ok(p, "propose", "c", "--ops", JSON.stringify([{ tag: "removed", old: "Old body text that is long." }, { tag: "new", new: "Short." }]), "--review", "shortened");
  await ok(p, "accept", "c", "--actor", "you");
  const s = (await ok(p, "show", "c")).out;
  expect(statusLine(s)).toContain("[decided]");
  expect(s).toContain("Short.");
  const types = events(p).map((e) => e.type);
  expect(types.slice(-3)).toEqual(["node.reopened", "change.accepted", "node.decided"]);
});

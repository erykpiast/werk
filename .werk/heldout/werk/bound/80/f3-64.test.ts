import { expect, test } from "bun:test";
import { mk } from "./lib.ts";
import { base, nearlyReady } from "./f3-lib.ts";

const KILL = (id: string) => ["kill", id, "--revisit"];

test("64.1 missing kill criterion refuses, prints command, fix works", async () => {
  const h = mk();
  nearlyReady(h, "c");
  const n = h.count();
  const r = await h.w("status", "c", "decided");
  expect(r.code).not.toBe(0);
  const text = r.out + r.err;
  expect(text).toContain("kill criterion");
  expect(text).toMatch(/werk kill c --/);
  expect((await h.w("show", "c")).out).toContain("[open]");
  expect(h.count()).toBe(n);
  expect((await h.w(...KILL("c"))).code).toBe(0);
  expect((await h.w("status", "c", "decided")).code).toBe(0);
  expect((await h.w("show", "c")).out).toContain("[decided]");
});

test("64.2 several gaps each reported with a command", async () => {
  const h = mk();
  h.card("c", { status: "open", title: "T", body: "text" });
  const r = await h.w("status", "c", "decided");
  expect(r.code).not.toBe(0);
  const t = r.out + r.err;
  for (const f of ["who", "basis", "option", "kill criterion"]) expect(t).toContain(f);
  expect(t).toContain("werk edit c --who");
  expect(t).toContain("werk link c <card> --type depends_on");
  expect(t).toContain("werk add c:opt0 --kind option");
  expect(t).toContain("werk kill c --");
  expect((await h.w("show", "c")).out).toContain("[open]");
  // run each fix in turn
  base(h);
  expect((await h.w("edit", "c", "--who", "you")).code).toBe(0);
  expect((await h.w("link", "c", "base", "--type", "depends_on", "--why", "uses base")).code).toBe(0);
  expect((await h.w("add", "c:opt0", "--kind", "option", "--title", "alt", "--why_not", "lost")).code).toBe(0);
  expect((await h.w("link", "c:opt0", "c", "--type", "alternative_to")).code).toBe(0);
  expect((await h.w(...KILL("c"))).code).toBe(0);
  const d = await h.w("status", "c", "decided");
  expect(d.code).toBe(0);
  expect((await h.w("show", "c")).out).toContain("[decided]");
});

async function ghostReady(h: ReturnType<typeof mk>, id: string, withBasis: boolean) {
  await h.ok("add", id, "--title", id);
  await h.ok("edit", id, "--who", "you");
  if (withBasis) await h.ok("link", id, "base", "--type", "depends_on", "--why", "uses");
  await h.ok("add", `${id}:opt0`, "--kind", "option", "--title", "alt", "--why_not", "lost");
  await h.ok("link", `${id}:opt0`, id, "--type", "alternative_to");
  await h.ok(...KILL(id));
}

test("64.3 ghost obeys same check via held edges", async () => {
  const h = mk();
  base(h);
  await ghostReady(h, "g1", true);
  await ghostReady(h, "g2", false);
  const a = await h.w("status", "g1", "decided");
  expect(a.code).toBe(0);
  expect((await h.w("show", "g1")).out).toContain("[decided]");
  const b = await h.w("status", "g2", "decided");
  expect(b.code).not.toBe(0);
  expect(b.out + b.err).toContain("basis");
  expect(b.out + b.err).toContain("werk link g2 <card> --type depends_on");
  expect((await h.w("show", "g2")).out).not.toContain("[decided]");
});

async function decidedCard(h: ReturnType<typeof mk>) {
  nearlyReady(h, "c");
  await h.ok(...KILL("c"));
  await h.ok("status", "c", "decided");
}

test("64.4 amend removing depends_on edge refused", async () => {
  const h = mk();
  await decidedCard(h);
  const before = (await h.w("show", "c")).out;
  const n = h.count();
  const r = await h.w("unlink", "c", "base", "--type", "depends_on");
  expect(r.code).not.toBe(0);
  expect(r.out + r.err).toContain("basis");
  expect(r.out + r.err).toContain("werk link c <card> --type depends_on");
  expect((await h.w("show", "c")).out).toBe(before);
  expect(h.count()).toBe(n);
});

test("64.5 amend that keeps facts succeeds", async () => {
  const h = mk();
  h.card("c", { status: "open", title: "T", body: "A long original body." });
  base(h);
  h.seed("node.edited", { id: "c", who: "you" });
  h.seed("edge.added", { from: "c", to: "base", type: "depends_on", why: "x" });
  h.seed("node.added", { id: "c:opt0", kind: "option", title: "alt", why_not: "lost" });
  h.seed("edge.added", { from: "c:opt0", to: "c", type: "alternative_to" });
  await h.ok(...KILL("c"));
  await h.ok("status", "c", "decided");
  await h.ok("propose", "c", "--ops", JSON.stringify([{ tag: "elaborated", old: "A long original body.", new: "Short." }]));
  const r = await h.w("accept", "c", "--actor", "you");
  expect(r.code).toBe(0);
  const s = (await h.w("show", "c")).out;
  expect(s).toContain("[decided]");
  expect(s).toContain("Short.");
  const types = h.events().map((e) => e.type);
  const tail = types.slice(-4);
  expect(tail).toContain("node.reopened");
  expect(tail[tail.length - 1]).toBe("node.decided");
});

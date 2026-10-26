import { expect, test } from "bun:test";
import { mk } from "./lib.ts";
import { dep } from "./f3-lib.ts";

function chain(h: ReturnType<typeof mk>, ids: string[], status = "decided") {
  for (const id of ids) h.card(id, { status, who: "me", title: `Card ${id}` });
}

test("65.1 rejected reopen marks next hop stale only", async () => {
  const h = mk();
  chain(h, ["a", "b", "c"]);
  dep(h, "b", "a");
  dep(h, "c", "b");
  await h.ok("reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong");
  const s = (await h.ok("stale")).toString();
  console.log(s);
  expect(s).toContain("b");
  expect(s).toMatch(/b[\s\S]*a/);
  expect(s).toContain("rejected");
  expect(s).toContain("depends_on");
  expect(s).not.toMatch(/^c\b/m);
  expect(s).not.toMatch(/\bc\b.*(stale|paused)/);
  const c = (await h.ok("show", "c"));
  console.log(c);
  expect(c).not.toMatch(/stale|paused/);
  expect((await h.ok("show", "b"))).toMatch(/stale/);
});

test("65.2 postponed reopen pauses downstream, keeps status", async () => {
  const h = mk();
  chain(h, ["a", "b", "c", "d"]);
  dep(h, "b", "a");
  dep(h, "c", "b");
  dep(h, "d", "c");
  await h.ok("reopen", "a", "--reason", "postponed", "--why", "the engine build waits for next quarter");
  for (const id of ["b", "c", "d"]) expect(await h.ok("show", id)).toContain("paused");
  expect(await h.ok("show", "d")).toContain("[decided]");
  const s = await h.ok("stale");
  console.log(s);
  expect(s).toMatch(/d[\s\S]*paused/);
  expect(s).toContain("postponed");
  for (const id of ["b", "c", "d"]) expect(await h.ok("show", id)).not.toContain("stale");
  expect(await h.ok("stale", "--kind", "stale")).not.toMatch(/\bd\b/);
});

test("65.3 stale wins over paused", async () => {
  const h = mk();
  h.card("a", { status: "decided", who: "me" });
  h.card("b", { status: "decided", who: "me" });
  h.card("c", { status: "decided", who: "me", parent: "b" });
  dep(h, "c", "a");
  await h.ok("reopen", "a", "--reason", "postponed");
  await h.ok("reopen", "b", "--reason", "rejected");
  const c = await h.ok("show", "c");
  console.log(c);
  expect(c.split("\n")[0]).toMatch(/stale/);
  expect(c.split("\n")[0]).not.toContain("paused");
  const s = await h.ok("stale");
  console.log(s);
  expect(s).not.toMatch(/^paused\s+c\b/m);
  expect(s).toMatch(/c[\s\S]*b/);
  expect(s).toContain("rejected");
});

test("65.4 rederive clears one card only", async () => {
  const h = mk();
  chain(h, ["a", "b", "c"]);
  dep(h, "b", "a");
  dep(h, "c", "a");
  await h.ok("reopen", "a", "--reason", "rejected", "--why", "bad");
  const s0 = await h.ok("stale");
  expect(s0).toContain("b");
  expect(s0).toContain("c");
  const r = await h.w("rederive", "b", "--confirm", "a");
  console.log(r.out, r.err);
  expect(r.code).toBe(0);
  const s = await h.ok("stale");
  console.log(s);
  expect(s).not.toMatch(/(^|\s)b(\s|$)/m);
  expect(s).toMatch(/c/);
  expect(s).toContain("rejected");
  expect(await h.ok("show", "b")).not.toContain("stale");
});

test("65.5 deciding postponed card again clears paused", async () => {
  const h = mk();
  chain(h, ["a", "b", "c"]);
  dep(h, "b", "a");
  dep(h, "c", "b");
  h.seed("node.edited", { id: "a", no_basis: "root of the chain" });
  await h.ok("kill", "a", "--revisit");
  await h.ok("reopen", "a", "--reason", "postponed", "--why", "later");
  expect(await h.ok("show", "b")).toContain("paused");
  expect(await h.ok("show", "c")).toContain("paused");
  const r = await h.w("status", "a", "decided");
  console.log(r.out, r.err);
  expect(r.code).toBe(0);
  expect(await h.ok("show", "b")).not.toContain("paused");
  expect(await h.ok("show", "c")).not.toContain("paused");
  const s = await h.ok("stale");
  expect(s).not.toMatch(/\bb\b/);
  expect(s).not.toMatch(/\bc\b/);
  expect(await h.ok("show", "c")).toContain("[decided]");
});

// Variant (not the step as written): the basis A is decided again before the confirm.
test("65.4 variant: A decided again, then rederive B", async () => {
  const h = mk();
  chain(h, ["a", "b", "c"]);
  dep(h, "b", "a");
  dep(h, "c", "a");
  h.seed("node.edited", { id: "a", no_basis: "root" });
  await h.ok("kill", "a", "--revisit");
  await h.ok("reopen", "a", "--reason", "rejected", "--why", "bad");
  await h.ok("status", "a", "decided");
  const r = await h.w("rederive", "b", "--confirm", "a");
  console.log(r.out, r.err);
  expect(r.code).toBe(0);
  const s = await h.ok("stale");
  console.log(s);
  expect(s).not.toMatch(/\bb\b/);
  expect(s).toMatch(/\bc\b/);
});

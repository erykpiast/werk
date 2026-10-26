import { expect, test } from "bun:test";
import { card, dep, freshProject, kill, ok, seed } from "./d-lib.ts";

const base = () => {
  const p = freshProject();
  seed(p, [card("root")]);
  return p;
};

test("65.1 rejected reopen marks next hop only", async () => {
  const p = base();
  seed(p, [card("a", "root"), card("b", "root"), card("c", "root"), dep("b", "a"), dep("c", "b"), kill("a")]);
  await ok(p, ["reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong"]);
  const stale = (await ok(p, ["stale"])).out;
  console.log(stale);
  expect(stale).toMatch(/stale\s+b\s/);
  expect(stale).toContain("from #a, rejected");
  expect(stale).not.toMatch(/\s+c\s+Card c/);
  const showc = (await ok(p, ["show", "c"])).out;
  console.log(showc.split("\n")[0]);
  expect(showc.split("\n")[0]).not.toMatch(/stale|paused/);
});

test("65.2 postponed pauses downstream, keeps status", async () => {
  const p = base();
  seed(p, [card("a", "root"), card("b", "root"), card("c", "root"), card("d", "root"), dep("b", "a"), dep("c", "b"), dep("d", "c"), kill("a")]);
  await ok(p, ["reopen", "a", "--reason", "postponed", "--why", "the engine build waits for next quarter"]);
  for (const id of ["b", "c", "d"]) {
    const s = (await ok(p, ["show", id])).out;
    expect(s.split("\n")[0]).toContain("paused");
  }
  expect((await ok(p, ["show", "d"])).out.split("\n")[0]).toContain("[decided]");
  const stale = (await ok(p, ["stale"])).out;
  console.log(stale);
  expect(stale).toMatch(/paused\s+d\s/);
  expect(stale).toContain("from #a, postponed");
  expect(stale).not.toMatch(/^stale /m);
});

test("65.3 stale wins over paused", async () => {
  const p = base();
  seed(p, [card("a", "root"), card("b", "root"), card("c", "b"), dep("c", "a"), kill("a"), kill("b")]);
  await ok(p, ["reopen", "a", "--reason", "postponed"]);
  await ok(p, ["reopen", "b", "--reason", "rejected"]);
  const stale = (await ok(p, ["stale"])).out;
  console.log(stale);
  expect(stale).toMatch(/stale\s+c\s/);
  expect(stale).toContain("from #b, rejected");
  expect(stale).not.toMatch(/paused\s+c\s/);
  expect((await ok(p, ["show", "c"])).out.split("\n")[0]).toContain("stale");
});

test("65.4 rederive clears one card", async () => {
  const p = base();
  seed(p, [card("a", "root"), card("b", "root"), card("c", "root"), dep("b", "a"), dep("c", "a"), kill("a")]);
  await ok(p, ["reopen", "a", "--reason", "rejected", "--why", "bad"]);
  expect((await ok(p, ["stale"])).out).toMatch(/stale\s+b\s[\s\S]*stale\s+c\s/);
  await ok(p, ["rederive", "b", "--confirm", "a"]);
  const stale = (await ok(p, ["stale"])).out;
  expect(stale).not.toMatch(/\s+b\s+Card b/);
  expect(stale).toMatch(/stale\s+c\s/);
  expect(stale).toContain("from #a, rejected");
  expect((await ok(p, ["show", "b"])).out.split("\n")[0]).not.toContain("stale");
});

test("65.5 deciding a postponed card again clears paused", async () => {
  const p = base();
  seed(p, [card("a", "root"), card("b", "root"), card("c", "root"), dep("b", "a"), dep("c", "b"), kill("a")]);
  await ok(p, ["reopen", "a", "--reason", "postponed"]);
  expect((await ok(p, ["show", "c"])).out.split("\n")[0]).toContain("paused");
  const r = await p.werk(["status", "a", "decided"]);
  console.log(r.out, r.err);
  expect(r.code).toBe(0);
  const stale = (await ok(p, ["stale"])).out;
  expect(stale).not.toMatch(/Card [bc]/);
  expect((await ok(p, ["show", "c"])).out.split("\n")[0]).toMatch(/\[decided\]$/);
});

test("65.4b (diagnostic) rederive after A decided again", async () => {
  const p = base();
  seed(p, [card("a", "root"), card("b", "root"), card("c", "root"), dep("b", "a"), dep("c", "a"), kill("a")]);
  await ok(p, ["reopen", "a", "--reason", "rejected", "--why", "bad"]);
  await ok(p, ["status", "a", "decided"]);
  await ok(p, ["rederive", "b", "--confirm", "a"]);
  const stale = (await ok(p, ["stale"])).out;
  expect(stale).not.toMatch(/\s+b\s+Card b/);
  expect(stale).toMatch(/stale\s+c\s/);
});

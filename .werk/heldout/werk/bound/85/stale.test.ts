import { expect, test } from "bun:test";
import { freshProject, type Project } from "../src/test/project.ts";
import { card, decided, edge, kill, lines, ok, root, seed, w } from "./h.ts";

const show = async (p: Project, id: string) => (await w(p, ["show", id])).out;
const stale = async (p: Project, ...a: string[]) => (await ok(p, ["stale", ...a])).out;
const entry = (s: string, kind: string, id: string) => {
  const blocks = s.split(/\n(?=\w+\s{2,})/);
  return blocks.find((b) => new RegExp(`^${kind}\\s+${id}\\b`).test(b));
};

test("65.1", async () => {
  const p = freshProject();
  seed(p, [...root(), decided("a"), decided("b"), decided("c"), edge("b", "a"), edge("c", "b")]);
  await ok(p, ["reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong"]);
  const s = await stale(p);
  const b = entry(s, "stale", "b")!;
  expect(b).toBeDefined();
  expect(b).toContain("#a");
  expect(b).toContain("rejected");
  expect(b).toContain("depends_on");
  expect(s).not.toMatch(/^\w+\s+c\b/m);
  const c = await show(p, "c");
  expect(c).not.toMatch(/\bstale\b|\bpaused\b/i.test(c.split("\n")[0]!) ? /x^/ : /^card c .*(stale|paused)/m);
  expect(c.split("\n")[0]).not.toMatch(/stale|paused/);
});

test("65.2", async () => {
  const p = freshProject();
  seed(p, [...root(), decided("a"), card("b"), card("c"), decided("d"), edge("b", "a"), edge("c", "b"), edge("d", "c")]);
  await ok(p, ["reopen", "a", "--reason", "postponed", "--why", "the engine build waits for next quarter"]);
  for (const id of ["b", "c", "d"]) expect((await show(p, id)).split("\n")[0]).toContain("paused");
  expect((await show(p, "d")).split("\n")[0]).toContain("[decided]");
  const s = await stale(p);
  const d = entry(s, "paused", "d")!;
  expect(d).toBeDefined();
  expect(d).toContain("#a");
  expect(d).toContain("postponed");
  expect(s).not.toMatch(/^stale /m);
  for (const id of ["b", "c", "d"]) expect((await show(p, id)).split("\n")[0]).not.toMatch(/\bstale\b/);
});

test("65.3", async () => {
  const p = freshProject();
  seed(p, [...root(), decided("a"), decided("b"), decided("c", { parent: "b" }), edge("c", "a")]);
  await ok(p, ["reopen", "a", "--reason", "postponed"]);
  await ok(p, ["reopen", "b", "--reason", "rejected"]);
  const head = (await show(p, "c")).split("\n")[0]!;
  expect(head).toContain("stale");
  expect(head).not.toContain("paused");
  const s = await stale(p);
  const c = entry(s, "stale", "c")!;
  expect(c).toBeDefined();
  expect(c).toContain("#b");
  expect(c).toContain("rejected");
});

test("65.4 literal", async () => {
  const p = freshProject();
  seed(p, [...root(), decided("a"), decided("b"), decided("c"), edge("b", "a"), edge("c", "a")]);
  await ok(p, ["reopen", "a", "--reason", "rejected", "--why", "bad"]);
  let s = await stale(p);
  expect(entry(s, "stale", "b")).toBeDefined();
  expect(entry(s, "stale", "c")).toBeDefined();
  const r = await w(p, ["rederive", "b", "--confirm", "a"]);
  console.log("65.4 rederive:", JSON.stringify(r));
  expect(r.code).toBe(0);
  s = await stale(p);
  expect(entry(s, "stale", "b")).toBeUndefined();
  expect(entry(s, "stale", "c")).toBeDefined();
  expect((await show(p, "b")).split("\n")[0]).not.toContain("stale");
});

test("65.4 variant: A decided again first", async () => {
  const p = freshProject();
  seed(p, [...root(), decided("a"), kill("a"), decided("b"), decided("c"), edge("b", "a"), edge("c", "a")]);
  await ok(p, ["reopen", "a", "--reason", "rejected", "--why", "bad"]);
  await ok(p, ["status", "a", "decided"]);
  const r = await w(p, ["rederive", "b", "--confirm", "a"]);
  console.log("65.4 variant rederive:", JSON.stringify(r));
  expect(r.code).toBe(0);
  const s = await stale(p);
  expect(entry(s, "stale", "b")).toBeUndefined();
  expect(entry(s, "stale", "c")).toBeDefined();
});

test("65.5", async () => {
  const p = freshProject();
  seed(p, [...root(), decided("a"), kill("a"), decided("b"), decided("c"), edge("b", "a"), edge("c", "b")]);
  await ok(p, ["reopen", "a", "--reason", "postponed", "--why", "later"]);
  for (const id of ["b", "c"]) expect((await show(p, id)).split("\n")[0]).toContain("paused");
  await ok(p, ["status", "a", "decided"]);
  for (const id of ["b", "c"]) expect((await show(p, id)).split("\n")[0]).not.toContain("paused");
  const s = await stale(p);
  expect(s).not.toMatch(/^\w+\s+(b|c)\b/m);
  expect((await show(p, "c")).split("\n")[0]).toContain("[decided]");
});

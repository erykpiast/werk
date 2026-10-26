// Binder: steps 65.1 to 65.5. The marks on the map are read from the first line of `werk show`;
// the stale list is `werk stale`.
import { expect, test } from "bun:test";
import { card, dep, head, kill, ok, refines, seeded } from "./f-helpers.ts";

const decided = (id: string) => [card(id, { status: "decided", who: "me", no_basis: "top" }), kill(id)];

test("65.1 a rejected reopen marks only the next hop as stale", async () => {
  const p = seeded([...decided("a"), ...decided("b"), ...decided("c"), dep("b", "a"), dep("c", "b")]);
  await ok(p, ["reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong"]);
  const stale = (await ok(p, ["stale"])).out;
  const entry = stale.split(/\n(?=\S)/).find((e) => /^stale\s+b\b/.test(e));
  expect(entry).toBeDefined();
  expect(entry).toContain("#a");
  expect(entry).toContain("rejected");
  expect(stale).not.toMatch(/\bc  Card c/);
  const c = await head(p, "c");
  expect(c).not.toContain("stale");
  expect(c).not.toContain("paused");
  // The entry names the depends_on link.
  expect(entry).toContain("depends_on");
}, 60_000);

test("65.2 a postponed reopen pauses every downstream card and keeps their status", async () => {
  const p = seeded([
    ...decided("a"),
    ...decided("b"),
    ...decided("c"),
    ...decided("d"),
    dep("b", "a"),
    dep("c", "b"),
    dep("d", "c"),
  ]);
  await ok(p, ["reopen", "a", "--reason", "postponed", "--why", "the engine build waits for next quarter"]);
  for (const id of ["b", "c", "d"]) expect(await head(p, id)).toContain("paused");
  expect(await head(p, "d")).toContain("[decided]");
  const stale = (await ok(p, ["stale"])).out;
  const entry = stale.split(/\n(?=\S)/).find((e) => /^paused\s+d\b/.test(e));
  expect(entry).toBeDefined();
  expect(entry).toContain("#a");
  expect(entry).toContain("postponed");
  for (const id of ["a", "b", "c", "d"]) expect(await head(p, id)).not.toContain("stale");
}, 60_000);

test("65.3 stale wins when a postponement and a rejection reach the same card", async () => {
  const p = seeded([...decided("a"), ...decided("b"), ...decided("c"), dep("c", "a"), refines("c", "b")]);
  await ok(p, ["reopen", "a", "--reason", "postponed"]);
  await ok(p, ["reopen", "b", "--reason", "rejected"]);
  const c = await head(p, "c");
  expect(c).toContain("stale");
  expect(c).not.toContain("paused");
  const stale = (await ok(p, ["stale"])).out;
  const entry = stale.split(/\n(?=\S)/).find((e) => /^stale\s+c\b/.test(e));
  expect(entry).toBeDefined();
  expect(entry).toContain("from #b, rejected");
}, 60_000);

test("65.4 rederive clears the mark on one card and leaves the others", async () => {
  const p = seeded([...decided("a"), ...decided("b"), ...decided("c"), dep("b", "a"), dep("c", "a")]);
  await ok(p, ["reopen", "a", "--reason", "rejected"]);
  let stale = (await ok(p, ["stale"])).out;
  expect(stale).toMatch(/^stale\s+b\b/m);
  expect(stale).toMatch(/^stale\s+c\b/m);
  // A confirm needs a settled basis, so the person decides A again before the rederive.
  await ok(p, ["status", "a", "decided"]);
  await ok(p, ["rederive", "b", "--confirm", "a"]);
  stale = (await ok(p, ["stale"])).out;
  expect(stale).not.toMatch(/^\S+\s+b\b/m);
  const entry = stale.split(/\n(?=\S)/).find((e) => /^stale\s+c\b/.test(e));
  expect(entry).toBeDefined();
  expect(entry).toContain("from #a, rejected");
  expect(await head(p, "b")).not.toContain("stale");
}, 60_000);

test("65.5 deciding a postponed card again clears the paused marks downstream", async () => {
  const p = seeded([...decided("a"), ...decided("b"), card("c", { status: "open" }), dep("b", "a"), dep("c", "b")]);
  const cBefore = await head(p, "c");
  await ok(p, ["reopen", "a", "--reason", "postponed"]);
  expect(await head(p, "b")).toContain("paused");
  expect(await head(p, "c")).toContain("paused");
  await ok(p, ["status", "a", "decided"]);
  expect(await head(p, "b")).not.toContain("paused");
  expect(await head(p, "c")).not.toContain("paused");
  const stale = (await ok(p, ["stale"])).out;
  expect(stale).not.toMatch(/^\S+\s+[bc]\b/m);
  expect(await head(p, "c")).toBe(cBefore);
}, 60_000);

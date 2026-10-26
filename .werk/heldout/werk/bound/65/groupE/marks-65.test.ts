// Held-out steps 65.1–65.5: reopen reasons, stale and paused marks, rederive and re-decide.
// "Shows on the map" reads the mark that `werk show` prints on the card's first line.
import { expect, test } from "bun:test";
import type { Project } from "../../src/test/project.ts";
import { card, dep, kill, ok, seeded } from "./helpers.ts";

const head = async (p: Project, id: string) => (await ok(p, ["show", id])).out.split("\n")[0] as string;
const stale = async (p: Project) => (await ok(p, ["stale"])).out;
/** The entry of one card in the stale list: its line and the cause line under it. */
function entry(list: string, id: string): string | undefined {
  const ls = list.split("\n");
  const i = ls.findIndex((l) => new RegExp(`^\\w+\\s+${id}\\s`).test(l));
  return i < 0 ? undefined : `${ls[i]}\n${ls[i + 1]}`;
}
const top = (id: string) => card(id, "decided", undefined, { no_basis: "top" });

test("65.1 a rejected reopen marks only the next hop as stale", async () => {
  const p = seeded([top("a"), card("b", "decided"), card("c", "decided"), dep("b", "a"), dep("c", "b"), kill("a")]);
  await ok(p, ["reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong"]);
  const list = await stale(p);
  const b = entry(list, "b");
  expect(b).toBeDefined();
  expect(b).toStartWith("stale");
  expect(b).toContain("#a");
  expect(b).toContain("rejected");
  expect(b).toContain("depends_on");
  expect(entry(list, "c")).toBeUndefined();
  const c = await head(p, "c");
  expect(c).not.toContain("stale");
  expect(c).not.toContain("paused");
});

test("65.2 a postponed reopen pauses every downstream card and keeps their status", async () => {
  const p = seeded([
    top("a"),
    card("b", "decided"),
    card("c", "decided"),
    card("d", "decided"),
    dep("b", "a"),
    dep("c", "b"),
    dep("d", "c"),
    kill("a"),
  ]);
  await ok(p, ["reopen", "a", "--reason", "postponed", "--why", "the engine build waits for next quarter"]);
  for (const id of ["b", "c", "d"]) expect(await head(p, id)).toContain("paused");
  expect(await head(p, "d")).toContain("[decided]");
  const d = entry(await stale(p), "d");
  expect(d).toStartWith("paused");
  expect(d).toContain("#a");
  expect(d).toContain("postponed");
  for (const id of ["a", "b", "c", "d"]) expect(await head(p, id)).not.toContain("stale");
});

test("65.3 stale wins when a postponement and a rejection reach the same card", async () => {
  const p = seeded([top("a"), top("b"), card("c", "decided", "b"), dep("c", "a"), kill("a"), kill("b")]);
  await ok(p, ["reopen", "a", "--reason", "postponed"]);
  await ok(p, ["reopen", "b", "--reason", "rejected"]);
  const c = await head(p, "c");
  expect(c).toContain("stale");
  expect(c).not.toContain("paused");
  const e = entry(await stale(p), "c");
  expect(e).toStartWith("stale");
  expect(e).toContain("#b");
  expect(e).toContain("rejected");
});

test("65.4 rederive clears the mark on one card and leaves the others", async () => {
  const p = seeded([top("a"), card("b", "decided"), card("c", "decided"), dep("b", "a"), dep("c", "a"), kill("a")]);
  await ok(p, ["reopen", "a", "--reason", "rejected"]);
  const before = await stale(p);
  expect(entry(before, "b")).toStartWith("stale");
  expect(entry(before, "c")).toStartWith("stale");
  await ok(p, ["rederive", "b", "--confirm", "a"]);
  const after = await stale(p);
  expect(entry(after, "b")).toBeUndefined();
  const c = entry(after, "c");
  expect(c).toStartWith("stale");
  expect(c).toContain("#a");
  expect(c).toContain("rejected");
  expect(await head(p, "b")).not.toContain("stale");
});

test("65.5 deciding a postponed card again clears the paused marks downstream", async () => {
  const p = seeded([top("a"), card("b", "decided"), card("c", "decided"), dep("b", "a"), dep("c", "b"), kill("a")]);
  const cBefore = /\[(\w+)\]/.exec(await head(p, "c"))?.[1];
  await ok(p, ["reopen", "a", "--reason", "postponed"]);
  expect(await head(p, "b")).toContain("paused");
  expect(await head(p, "c")).toContain("paused");
  await ok(p, ["status", "a", "decided"]);
  expect(await head(p, "b")).not.toContain("paused");
  expect(await head(p, "c")).not.toContain("paused");
  const list = await stale(p);
  expect(entry(list, "b")).toBeUndefined();
  expect(entry(list, "c")).toBeUndefined();
  expect(/\[(\w+)\]/.exec(await head(p, "c"))?.[1]).toBe(cBefore);
});

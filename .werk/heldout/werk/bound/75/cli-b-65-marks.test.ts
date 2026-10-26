import { expect, test } from "bun:test";
import type { Project } from "../src/test/project.ts";
import { day, decided, dep, link, ok, withMap } from "./cli-b-helpers.ts";

const head = async (p: Project, id: string) => (await ok(p, ["show", id])).out.split("\n")[0] as string;
/** The block of one card in the stale list: its line and the reason lines under it. */
function entry(stale: string, id: string): string | undefined {
  const blocks = stale.split(/\n(?=\S)/);
  return blocks.find((b) => b.split(/\s+/)[1] === id);
}

test("65.1", async () => {
  const p = withMap([...decided("a", "Card A"), ...decided("b", "Card B"), ...decided("c", "Card C"), dep("b", "a"), dep("c", "b")]);
  await ok(p, ["reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong"]);
  const stale = (await ok(p, ["stale"])).out;
  console.log(stale);
  console.log((await ok(p, ["show", "b"])).out);
  const b = entry(stale, "b");
  expect(b).toBeDefined();
  expect(b).toMatch(/^stale +b /);
  expect(b).toContain("#a");
  expect(b).toContain("rejected");
  expect(entry(stale, "c")).toBeUndefined();
  const c = await head(p, "c");
  expect(c).not.toContain("stale");
  expect(c).not.toContain("paused");
  // The entry names the depends_on link.
  expect(b).toContain("depends_on");
});

test("65.2", async () => {
  const p = withMap([
    ...decided("a", "Card A"),
    ...decided("b", "Card B"),
    ...decided("c", "Card C"),
    ...decided("d", "Card D"),
    dep("b", "a"),
    dep("c", "b"),
    dep("d", "c"),
  ]);
  await ok(p, ["reopen", "a", "--reason", "postponed", "--why", "the engine build waits for next quarter"]);
  for (const id of ["b", "c", "d"]) expect(await head(p, id)).toContain("paused");
  expect(await head(p, "d")).toContain("[decided]");
  const stale = (await ok(p, ["stale"])).out;
  console.log(stale);
  const d = entry(stale, "d");
  expect(d).toMatch(/^paused +d /);
  expect(d).toContain("from #a, postponed");
  for (const id of ["a", "b", "c", "d"]) expect(await head(p, id)).not.toContain("stale");
  expect(stale).not.toMatch(/^stale /m);
});

test("65.3", async () => {
  const p = withMap([
    ...decided("a", "Card A"),
    ...decided("b", "Card B"),
    ...decided("c", "Card C", { parent: "b" }),
    dep("c", "a"),
  ]);
  await ok(p, ["reopen", "a", "--reason", "postponed"]);
  await ok(p, ["reopen", "b", "--reason", "rejected"]);
  const h = await head(p, "c");
  console.log(h);
  expect(h).toContain("stale");
  expect(h).not.toContain("paused");
  const stale = (await ok(p, ["stale"])).out;
  console.log(stale);
  const c = entry(stale, "c");
  expect(c).toMatch(/^stale +c /);
  expect(c).toContain("from #b, rejected");
});

test("65.4", async () => {
  const p = withMap([...decided("a", "Card A"), ...decided("b", "Card B"), ...decided("c", "Card C"), dep("b", "a"), dep("c", "a")]);
  await ok(p, ["reopen", "a", "--reason", "rejected"]);
  const before = (await ok(p, ["stale"])).out;
  expect(entry(before, "b")).toMatch(/^stale/);
  expect(entry(before, "c")).toMatch(/^stale/);
  const run = await p.werk(["rederive", "b", "--confirm", "a"]);
  console.log(run);
  expect(run.code).toBe(0);
  const after = (await ok(p, ["stale"])).out;
  console.log(after);
  expect(entry(after, "b")).toBeUndefined();
  expect(entry(after, "c")).toContain(`from #a, rejected, ${day}`);
  expect(entry(after, "c")).toMatch(/^stale/);
  expect(await head(p, "b")).not.toContain("stale");
});

test("65.5", async () => {
  const p = withMap([...decided("a", "Card A"), ...decided("b", "Card B"), ...decided("c", "Card C"), dep("b", "a"), dep("c", "b")]);
  await ok(p, ["reopen", "a", "--reason", "postponed"]);
  expect(await head(p, "b")).toContain("paused");
  expect(await head(p, "c")).toContain("paused");
  await ok(p, ["status", "a", "decided"]);
  for (const id of ["b", "c"]) expect(await head(p, id)).not.toContain("paused");
  const stale = (await ok(p, ["stale"])).out;
  console.log(stale);
  expect(entry(stale, "b")).toBeUndefined();
  expect(entry(stale, "c")).toBeUndefined();
  expect(await head(p, "c")).toContain("[decided]");
});
void link;

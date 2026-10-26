import { expect, test } from "bun:test";
import { decided, type P, project } from "./b-helpers.ts";

const head = async (p: P, id: string) => (await p.must(["show", id])).split("\n")[0] ?? "";
const dep = (p: P, from: string, to: string) =>
  p.seed("edge.added", { from, to, type: "depends_on", why: `${from} takes from ${to}` });
/** The block of the stale list that starts with the line of `id`. */
function entry(list: string, id: string): string {
  const ls = list.split("\n");
  const at = ls.findIndex((l) => new RegExp(`^\\S+\\s+${id}\\s`).test(l));
  if (at < 0) return "";
  const end = ls.findIndex((l, i) => i > at && /^\S/.test(l));
  return ls.slice(at, end < 0 ? undefined : end).join("\n");
}

test("65.1 a rejected reopen marks only the next hop as stale", async () => {
  const p = project();
  decided(p, "a", { title: "Card A" });
  decided(p, "b", { title: "Card B" });
  decided(p, "c", { title: "Card C" });
  dep(p, "b", "a");
  dep(p, "c", "b");
  await p.must(["reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong"]);
  const list = await p.must(["stale"]);
  const b = entry(list, "b");
  expect(b).toMatch(/^stale/);
  expect(b).toContain("#a");
  expect(b).toContain("depends_on");
  expect(b).toContain("rejected");
  expect(entry(list, "c")).toBe("");
  const c = await head(p, "c");
  expect(c).not.toContain("stale");
  expect(c).not.toContain("paused");
});

test("65.2 a postponed reopen pauses every downstream card and keeps their status", async () => {
  const p = project();
  decided(p, "a", { title: "Card A" });
  decided(p, "b", { title: "Card B" });
  decided(p, "c", { title: "Card C" });
  decided(p, "d", { title: "Card D" });
  dep(p, "b", "a");
  dep(p, "c", "b");
  dep(p, "d", "c");
  await p.must(["reopen", "a", "--reason", "postponed", "--why", "the engine build waits for next quarter"]);
  for (const id of ["b", "c", "d"]) {
    const h = await head(p, id);
    expect(h).toContain("paused");
    expect(h).not.toContain("stale");
  }
  expect(await head(p, "d")).toContain("[decided]");
  const list = await p.must(["stale"]);
  const d = entry(list, "d");
  expect(d).toMatch(/^paused/);
  expect(d).toContain("#a");
  expect(d).toContain("postponed");
  expect(list.split("\n").some((l) => l.startsWith("stale"))).toBe(false);
});

test("65.3 stale wins when a postponement and a rejection reach the same card", async () => {
  const p = project();
  decided(p, "a", { title: "Card A" });
  decided(p, "b", { title: "Card B" });
  decided(p, "c", { title: "Card C", parent: "b" });
  dep(p, "c", "a");
  await p.must(["reopen", "a", "--reason", "postponed", "--why", "later"]);
  await p.must(["reopen", "b", "--reason", "rejected", "--why", "wrong"]);
  const h = await head(p, "c");
  expect(h).toContain("stale");
  expect(h).not.toContain("paused");
  const c = entry(await p.must(["stale"]), "c");
  expect(c).toMatch(/^stale/);
  expect(c).toContain("#b");
  expect(c).toContain("rejected");
});

test("65.4 rederive clears the mark on one card and leaves the others", async () => {
  const p = project();
  decided(p, "a", { title: "Card A" });
  decided(p, "b", { title: "Card B" });
  decided(p, "c", { title: "Card C" });
  dep(p, "b", "a");
  dep(p, "c", "a");
  await p.must(["reopen", "a", "--reason", "rejected", "--why", "wrong"]);
  const before = await p.must(["stale"]);
  expect(entry(before, "b")).toMatch(/^stale/);
  expect(entry(before, "c")).toMatch(/^stale/);
  await p.must(["rederive", "b", "--confirm", "a"]);
  const after = await p.must(["stale"]);
  expect(entry(after, "b")).toBe("");
  const c = entry(after, "c");
  expect(c).toMatch(/^stale/);
  expect(c).toContain("#a");
  expect(c).toContain("rejected");
  expect(await head(p, "b")).not.toContain("stale");
});

test("65.5 deciding a postponed card again clears the paused marks downstream", async () => {
  const p = project();
  decided(p, "a", { title: "Card A" });
  p.seed("node.edited", { id: "a", no_basis: "a starting point" });
  p.seed("kill.added", { id: "a", criterion: { form: "revisit" } });
  decided(p, "b", { title: "Card B" });
  decided(p, "c", { title: "Card C" });
  dep(p, "b", "a");
  dep(p, "c", "b");
  await p.must(["reopen", "a", "--reason", "postponed", "--why", "later"]);
  expect(await head(p, "b")).toContain("paused");
  expect(await head(p, "c")).toContain("paused");
  await p.must(["status", "a", "decided"]);
  expect(await head(p, "b")).not.toContain("paused");
  expect(await head(p, "c")).not.toContain("paused");
  const list = await p.must(["stale"]);
  expect(entry(list, "b")).toBe("");
  expect(entry(list, "c")).toBe("");
  expect(await head(p, "c")).toContain("[decided]");
});

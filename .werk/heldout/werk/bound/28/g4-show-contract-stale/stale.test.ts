import { expect, test } from "bun:test";
import { card, decided, dep, freshProject, ok, type Project } from "./helpers.ts";

const day = new Date().toISOString().slice(0, 10);
const head = async (p: Project, id: string) => (await ok(p, ["show", id])).out.split("\n")[0] as string;

function base(): Project {
  const p = freshProject();
  card(p, "root", { title: "Root", status: "decided", who: "me", no_basis: "top" });
  return p;
}

test("65.1 a rejected reopen marks only the next hop as stale", async () => {
  const p = base();
  decided(p, "a", { parent: "root" });
  decided(p, "b", { parent: "root" });
  decided(p, "c", { parent: "root" });
  dep(p, "b", "a");
  dep(p, "c", "b");
  await ok(p, ["reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong"]);
  const stale = (await ok(p, ["stale"])).out;
  console.log(stale);
  console.log((await ok(p, ["show", "b"])).out);
  expect(stale).toMatch(/^stale +b /m);
  expect(stale).not.toMatch(/ c {2}Card c/);
  expect(await head(p, "c")).toBe("card c  [decided]");
  const entry = stale.split("\n").slice(stale.split("\n").findIndex((l) => / b {2}Card b/.test(l))).slice(0, 3).join("\n");
  expect(entry).toContain(`from #a, rejected, ${day}`);
  expect(entry).toContain("depends_on");
}, 30_000);

test("65.2 a postponed reopen pauses every downstream card and keeps their status", async () => {
  const p = base();
  decided(p, "a", { parent: "root" });
  decided(p, "b", { parent: "root" });
  decided(p, "c", { parent: "root" });
  decided(p, "d", { parent: "root" });
  dep(p, "b", "a");
  dep(p, "c", "b");
  dep(p, "d", "c");
  await ok(p, ["reopen", "a", "--reason", "postponed", "--why", "the engine build waits for next quarter"]);
  for (const id of ["b", "c", "d"]) expect(await head(p, id)).toContain("  paused");
  expect(await head(p, "d")).toBe("card d  [decided]  paused");
  const stale = (await ok(p, ["stale"])).out;
  console.log(stale);
  const lines = stale.split("\n");
  const i = lines.findIndex((l) => /^paused +d /.test(l));
  expect(i).toBeGreaterThanOrEqual(0);
  expect(lines[i + 1]).toContain(`from #a, postponed, ${day}`);
  expect(stale).not.toMatch(/^stale /m);
  for (const id of ["a", "b", "c", "d"]) expect(await head(p, id)).not.toContain("stale");
}, 30_000);

test("65.3 stale wins when a postponement and a rejection reach the same card", async () => {
  const p = base();
  decided(p, "a", { parent: "root" });
  decided(p, "b", { parent: "root" });
  decided(p, "c", { parent: "b" });
  dep(p, "c", "a");
  await ok(p, ["reopen", "a", "--reason", "postponed"]);
  await ok(p, ["reopen", "b", "--reason", "rejected"]);
  expect(await head(p, "c")).toBe("card c  [decided]  stale");
  const stale = (await ok(p, ["stale"])).out;
  console.log(stale);
  const lines = stale.split("\n");
  const i = lines.findIndex((l) => /^stale +c /.test(l));
  expect(i).toBeGreaterThanOrEqual(0);
  expect(lines[i + 1]).toContain(`from #b, rejected, ${day}`);
}, 30_000);

test("65.4 rederive clears the mark on one card and leaves the others", async () => {
  const p = base();
  decided(p, "a", { parent: "root" });
  decided(p, "b", { parent: "root" });
  decided(p, "c", { parent: "root" });
  dep(p, "b", "a");
  dep(p, "c", "a");
  await ok(p, ["reopen", "a", "--reason", "rejected"]);
  const before = (await ok(p, ["stale"])).out;
  expect(before).toMatch(/^stale +b /m);
  expect(before).toMatch(/^stale +c /m);
  const r = await p.werk(["rederive", "b", "--confirm", "a"]);
  console.log(r);
  expect(r.code).toBe(0);
  const after = (await ok(p, ["stale"])).out;
  console.log(after);
  expect(after).not.toMatch(/ b {2}Card b/);
  const lines = after.split("\n");
  const i = lines.findIndex((l) => /^stale +c /.test(l));
  expect(i).toBeGreaterThanOrEqual(0);
  expect(lines[i + 1]).toContain(`from #a, rejected, ${day}`);
  expect(await head(p, "b")).toBe("card b  [decided]");
}, 30_000);

test("65.5 deciding a postponed card again clears the paused marks downstream", async () => {
  const p = base();
  decided(p, "a", { parent: "root" });
  decided(p, "b", { parent: "root" });
  decided(p, "c", { parent: "root" });
  dep(p, "b", "a");
  dep(p, "c", "b");
  const cBefore = await head(p, "c");
  await ok(p, ["reopen", "a", "--reason", "postponed"]);
  expect(await head(p, "b")).toContain("paused");
  expect(await head(p, "c")).toContain("paused");
  await ok(p, ["status", "a", "decided"]);
  expect(await head(p, "b")).not.toContain("paused");
  expect(await head(p, "c")).not.toContain("paused");
  const stale = (await ok(p, ["stale"])).out;
  expect(stale).not.toMatch(/ [bc] {2}Card/);
  expect(await head(p, "c")).toBe(cBefore);
}, 30_000);

test("65.4 variant: card A decided again before the rederive", async () => {
  const p = base();
  decided(p, "a", { parent: "root" });
  decided(p, "b", { parent: "root" });
  decided(p, "c", { parent: "root" });
  dep(p, "b", "a");
  dep(p, "c", "a");
  await ok(p, ["reopen", "a", "--reason", "rejected"]);
  await ok(p, ["status", "a", "decided"]);
  await ok(p, ["rederive", "b", "--confirm", "a"]);
  const after = (await ok(p, ["stale"])).out;
  expect(after).not.toMatch(/ b {2}Card b/);
  expect(after).toBe(`stale    c  Card c\n  from #a, rejected, ${day}\n`);
  expect(await head(p, "b")).toBe("card b  [decided]");
}, 30_000);

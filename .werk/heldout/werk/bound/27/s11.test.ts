import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, decidedEvents, ghost, linkEvent, openEvents, type Project, seed, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  seed(
    p,
    decidedEvents("root", { title: "Root" }),
    openEvents("c1", { parent: "root", title: "Child one" }),
    openEvents("c2", { parent: "root", title: "Child two", status: "proto" }),
    decidedEvents("g", { parent: "root", title: "Grand" }),
  );
  // the grandchild refines c1
  seed(p, { type: "edge.added", from: "g", to: "c1", link: "refines", why: "" });
  const r = await werk(p, "show", "root");
  expect(r.code, r.stderr).toBe(0);
  const rollup = r.stdout.split("\n").filter((l) => /\b4 cards\b/.test(l));
  expect(rollup).toHaveLength(1);
  expect(rollup[0]).toMatch(/1 open/);
  expect(rollup[0]).toMatch(/1 proto/);
  expect(rollup[0]).toMatch(/2 decided/);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  seed(
    p,
    decidedEvents("parent", { title: "Parent" }),
    decidedEvents("child", { parent: "parent", title: "Child" }),
    openEvents("gc1", { parent: "child", title: "GC one" }),
    decidedEvents("gc2", { parent: "child", title: "GC two" }),
  );
  const r = await werk(p, "show", "parent");
  expect(r.code, r.stderr).toBe(0);
  const lines = r.stdout.split("\n");
  const link = lines.find((l) => l.includes("<-") && l.includes("child"));
  expect(link).toBeDefined();
  expect(link).toMatch(/\b3 cards\b/);
  expect(lines.filter((l) => /\b4 cards\b/.test(l))).toHaveLength(1);
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  seed(p, decidedEvents("base", { title: "Base" }), decidedEvents("card", { title: "The card", parent: "base" }));
  seed(p, openEvents("card:opt0", { kind: "option", title: "Use a queue", why: "queues lose order" }), linkEvent("card:opt0", "card", "alternative_to"));
  const dir = join(p.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "talk.jsonl"), `${JSON.stringify({ speaker: "person", at: "10:02", session: "s1", kind: "spoken", text: "we must keep the order" })}\n`);
  seed(p, linkEvent("card", "base", "depends_on"));
  expect((await werk(p, "quote", "card", "talk", "we must keep the order")).code).toBe(0);
  await werk(p, "accept", "card:ex0", "--actor", "you");
  seed(p, ghost("src1", { kind: "source", title: "Order study", why: "Order matters in 9 of 10 cases" }), linkEvent("card", "src1", "supported_by"));
  const r = await werk(p, "show", "card");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout).toMatch(/depends_on[^\n]*base/);
  const out = r.stdout;
  const iLinks = out.indexOf("depends_on");
  const iOpt = out.indexOf("Options");
  expect(iOpt).toBeGreaterThan(iLinks);
  expect(out).toMatch(/Options[\s\S]*Use a queue[\s\S]*queues lose order/);
  expect(out).toMatch(/Say[\s\S]*person[\s\S]*we must keep the order/);
  expect(out).toMatch(/Ev[\s\S]*Order study[\s\S]*Order matters in 9 of 10 cases/);
  expect(out).toMatch(/Order study[^\n]*proposed|proposed[^\n]*Order study/);
});

test("11.4 a card with no options prints no Options section", async () => {
  seed(p, decidedEvents("base", { title: "Base" }), decidedEvents("card", { title: "The card", parent: "base" }));
  const dir = join(p.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "talk.jsonl"), `${JSON.stringify({ speaker: "person", at: "10:02", session: "s1", kind: "spoken", text: "we must keep the order" })}\n`);
  await werk(p, "quote", "card", "talk", "we must keep the order");
  await werk(p, "accept", "card:ex0", "--actor", "you");
  seed(p, openEvents("src1", { kind: "source", title: "Order study", why: "found it" }), linkEvent("card", "src1", "supported_by"));
  const r = await werk(p, "show", "card");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout).toMatch(/\bSay\b/);
  expect(r.stdout).toMatch(/\bEv\b/);
  expect(r.stdout).not.toMatch(/\bOptions\b/);
});

test("11.5 show with no id prints the root card", async () => {
  seed(p, decidedEvents("root", { title: "The Root" }), decidedEvents("second", { parent: "root", title: "Second card" }));
  const r = await werk(p, "show");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout).toContain("The Root");
  expect(r.stdout).toMatch(/\b2 cards\b/);
  expect(r.stdout).toMatch(/<-[^\n]*second[^\n]*\b1 cards?\b/);
});

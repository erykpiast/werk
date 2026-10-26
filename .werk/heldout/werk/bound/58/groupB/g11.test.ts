import { afterEach, beforeEach, expect, test } from "bun:test";
import { decided, ghost, link, open } from "../../src/map/mark-fixtures.ts";
import { make, SLOW, seed } from "./helper.ts";

let t: ReturnType<typeof make>;
beforeEach(() => {
  t = make();
});
afterEach(() => t.project.dispose());

const quote = (extra: Record<string, unknown> = {}) => ({
  type: "excerpt.quoted",
  id: "x:ex0",
  title: "seats are the unit",
  card: "x",
  conversation: "pricing",
  session: "s1",
  message: 2,
  start: 0,
  end: 18,
  speaker: "agent",
  said_at: "10:02",
  ...extra,
});

test("11.1 rollup counts the card and its whole subtree", async () => {
  seed(
    t.project,
    decided("root"),
    decided("c1", { parent: "root" }),
    open("c2", { parent: "root", status: "proto" }),
    decided("gc", { parent: "c1" }),
    // The product refuses a decided card under an open parent, so the child is reopened after.
    { type: "node.reopened", id: "c1", reason: "postponed", at: "2026-10-10T09:00:00.000Z" },
  );
  const r = await t.werk("show", "root");
  expect(r.code).toBe(0);
  const rollups = r.stdout.split("\n").filter((l) => l.startsWith("rollup:"));
  expect(rollups).toEqual(["rollup: 4 cards: 1 open, 1 proto, 2 decided"]);
}, SLOW);

test("11.2 each incoming refines link shows the child's rollup", async () => {
  seed(
    t.project,
    open("parent"),
    decided("child", { parent: "parent" }),
    open("g1", { parent: "child" }),
    decided("g2", { parent: "child" }),
    { type: "node.reopened", id: "child", reason: "postponed", at: "2026-10-10T09:00:00.000Z" },
  );
  const r = await t.werk("show", "parent");
  expect(r.stdout).toContain("rollup: 4 cards:");
  const link = r.stdout.split("\n").find((l) => l.includes("<- refines"));
  expect(link).toContain("child");
  expect(link).toContain("rollup: 3 cards:");
}, SLOW);

test("11.3 options, say and ev sections with their words", async () => {
  seed(
    t.project,
    open("y"),
    open("x"),
    link("x", "y"),
    ghost("x:opt0", { kind: "option", title: "Per call", why: "Too noisy" }),
    link("x:opt0", "x", "alternative_to"),
    quote(),
    ghost("x:src0", { kind: "source", title: "Survey", why: "70% agree" }),
    link("x", "x:src0", "supported_by"),
  );
  const r = (await t.werk("show", "x")).stdout;
  const at = (s: string) => r.indexOf(s);
  expect(r).toContain("depends_on");
  expect(r).toContain("x takes y");
  expect(at("Options:")).toBeGreaterThan(at("-> depends_on"));
  expect(r).toMatch(/Per call[\s\S]*Too noisy/);
  expect(r).toContain("Say:");
  expect(r).toContain("agent: seats are the unit");
  expect(r).toContain("Ev:");
  expect(r).toMatch(/Survey.*proposed[\s\S]*70% agree/);
}, SLOW);

test("11.4 no Options section without options", async () => {
  seed(
    t.project,
    open("x"),
    quote(),
    ghost("x:src0", { kind: "source", title: "Survey", why: "70% agree" }),
    link("x", "x:src0", "supported_by"),
  );
  const r = (await t.werk("show", "x")).stdout;
  expect(r).toContain("Say:");
  expect(r).toContain("Ev:");
  expect(r).not.toContain("Options");
}, SLOW);

test("11.5 show with no id prints the root card", async () => {
  seed(t.project, open("root", { title: "Root title" }), open("kid", { parent: "root", title: "Kid title" }));
  const r = await t.werk("show");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Root title");
  expect(r.stdout).toContain("rollup: 2 cards");
  const l = r.stdout.split("\n").find((x) => x.includes("<- refines"));
  expect(l).toContain("kid");
  expect(l).toContain("rollup: 1 cards");
}, SLOW);

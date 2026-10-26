import { expect, test } from "bun:test";
import { decided, ghost, link, open, useWerk } from "./query-support.ts";

const { werk, seed } = useWerk();

const quoted = (id: string, card: string) => ({
  type: "excerpt.quoted",
  id,
  title: "we ship on friday",
  card,
  conversation: "c1",
  session: "s1",
  message: 0,
  start: 0,
  end: 17,
  speaker: "alice",
  said_at: "2026-10-10T09:00:00.000Z",
});

test("11.1 rollup counts the card and its subtree", async () => {
  seed([
    ...decided("root", { title: "Root" }),
    ...decided("c1", { title: "C1", parent: "root" }),
    ...decided("g", { title: "G", parent: "c1" }),
    // the child goes back to open; its decided child keeps its status
    { type: "node.reopened", id: "c1", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" },
    ...open("c2", { title: "C2", parent: "root", status: "proto" }),
  ]);
  const r = await werk("show", "root");
  expect(r.code).toBe(0);
  const rollups = r.stdout.split("\n").filter((l) => l.startsWith("rollup:"));
  expect(rollups).toEqual(["rollup: 4 cards: 1 open, 1 proto, 2 decided"]);
});

test("11.2 incoming refines link shows the child's rollup", async () => {
  seed([
    ...decided("par", { title: "Par" }),
    ...decided("kid", { title: "Kid", parent: "par" }),
    ...decided("g2", { title: "G2", parent: "kid" }),
    { type: "node.reopened", id: "kid", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" },
    ...open("g1", { title: "G1", parent: "kid" }),
  ]);
  const r = await werk("show", "par");
  expect(r.stdout).toContain("rollup: 4 cards");
  const row = r.stdout.split("\n").find((l) => /<- refines\s+kid/.test(l));
  expect(row).toBeDefined();
  expect(row).toContain("rollup: 3 cards");
});

test("11.3 options, excerpts and a proposed source print with their words", async () => {
  seed([
    ...decided("dep", { title: "Dep" }),
    ...open("x", { title: "X card" }),
    link("x", "dep", "depends_on", "needs the dep"),
    ...open("opt", { kind: "option", title: "Other way", why: "too slow" }),
    link("opt", "x", "alternative_to", ""),
    quoted("ex", "x"),
    { type: "node.accepted", id: "ex", actor: "you" },
    ghost("src", { kind: "source", title: "RFC doc", why: "says fifteen minutes" }),
    link("x", "src", "supported_by", ""),
  ]);
  const r = await werk("show", "x");
  expect(r.code).toBe(0);
  const out = r.stdout;
  expect(out).toContain("depends_on");
  expect(out).toContain("why: needs the dep");
  const iLink = out.indexOf("why: needs the dep");
  const iOpt = out.indexOf("Options:");
  const iSay = out.indexOf("Say:");
  const iEv = out.indexOf("Ev:");
  expect(iOpt).toBeGreaterThan(iLink);
  expect(iSay).toBeGreaterThan(iOpt);
  expect(iEv).toBeGreaterThan(iSay);
  expect(out).toContain("Other way");
  expect(out).toContain("why not: too slow");
  expect(out).toContain("alice: we ship on friday");
  expect(out).toContain("RFC doc  proposed");
  expect(out).toContain("finding: says fifteen minutes");
});

test("11.4 no options means no Options section", async () => {
  seed([
    ...open("x", { title: "X card" }),
    quoted("ex", "x"),
    { type: "node.accepted", id: "ex", actor: "you" },
    ...open("src", { kind: "source", title: "RFC doc", why: "f" }),
    link("x", "src", "supported_by", ""),
  ]);
  const r = await werk("show", "x");
  expect(r.stdout).toContain("Say:");
  expect(r.stdout).toContain("Ev:");
  expect(r.stdout).not.toContain("Options:");
});

test("11.5 show with no id prints the root card", async () => {
  seed([...open("root", { title: "The Root" }), ...open("k", { title: "Kid", parent: "root" })]);
  const r = await werk("show");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("The Root");
  expect(r.stdout).toContain("rollup: 2 cards");
  const row = r.stdout.split("\n").find((l) => /<- refines\s+k\s/.test(l));
  expect(row).toContain("rollup: 1 cards");
});

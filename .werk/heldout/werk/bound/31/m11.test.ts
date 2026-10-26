import { afterEach, beforeEach, expect, test } from "bun:test";
import { card, createProject, decided, ev, link, type Project, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const rollupLines = (s: string) => s.split("\n").filter((l) => /\d+\s+cards?\b/i.test(l));

test("11.1 the rollup counts the card and its refines subtree", async () => {
  decided(p, "root", "Root");
  decided(p, "a", "Child A", { parent: "root" });
  decided(p, "g", "Grand", { parent: "a" });
  ev(p, { type: "node.reopened", id: "a", reason: "invalidated" });
  card(p, "b", "Child B", { parent: "root", status: "proto" });
  const r = await werk(p, "show", "root");
  expect(r.code).toBe(0);
  const lines = rollupLines(r.stdout);
  expect(lines, `no rollup line in:\n${r.stdout}`).toHaveLength(1);
  expect(lines[0]).toMatch(/\b4 cards\b/);
  expect(lines[0]).toMatch(/\b1 open\b/);
  expect(lines[0]).toMatch(/\b1 proto\b/);
  expect(lines[0]).toMatch(/\b2 decided\b/);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  decided(p, "parent", "Parent");
  decided(p, "child", "Child", { parent: "parent" });
  card(p, "g1", "Grand one", { parent: "child" });
  decided(p, "g2", "Grand two", { parent: "child" });
  ev(p, { type: "node.reopened", id: "child", reason: "invalidated" });
  const r = await werk(p, "show", "parent");
  expect(r.code).toBe(0);
  const link = r.stdout.split("\n").find((l) => l.includes("<-") && l.includes("refines"));
  expect(link, r.stdout).toBeDefined();
  const lines = r.stdout.split("\n");
  const at = lines.indexOf(link as string);
  const around = lines.slice(at, at + 3).join("\n");
  expect(around).toMatch(/\b3 cards\b/);
  const own = rollupLines(r.stdout).filter((l) => !around.includes(l));
  expect(own.join("\n")).toMatch(/\b4 cards\b/);
});

test("11.3 options, excerpts and a proposed source print with their words", async () => {
  decided(p, "other", "Other card");
  card(p, "main", "Main card");
  link(p, "main", "other", "depends_on", "it needs the other one");
  card(p, "main:opt0", "Use polling", { kind: "option", why: "polling wastes requests" });
  link(p, "main:opt0", "main", "alternative_to");
  card(p, "say1", "Sam", { kind: "excerpt", body: "we must expire the link after fifteen minutes" });
  link(p, "main", "say1", "supported_by");
  ev(p, { type: "node.proposed", id: "src1", kind: "source", title: "RFC 6749", status: "open", why: "tokens expire quickly" });
  link(p, "main", "src1", "supported_by");
  const r = await werk(p, "show", "main");
  expect(r.code).toBe(0);
  const out = r.stdout;
  expect(out).toContain("it needs the other one");
  const iOpt = out.search(/^\s*Options\b/m);
  const iSay = out.search(/^\s*Say\b/m);
  const iEv = out.search(/^\s*Ev\b/m);
  expect(iOpt, `no Options section:\n${out}`).toBeGreaterThan(out.indexOf("depends_on"));
  expect(iSay, `no Say section:\n${out}`).toBeGreaterThan(-1);
  expect(iEv, `no Ev section:\n${out}`).toBeGreaterThan(-1);
  expect(out).toContain("Use polling");
  expect(out).toContain("polling wastes requests");
  expect(out).toContain("Sam");
  expect(out).toContain("we must expire the link after fifteen minutes");
  const evPart = out.slice(iEv);
  expect(evPart).toContain("RFC 6749");
  expect(evPart).toContain("tokens expire quickly");
  expect(evPart).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  card(p, "main", "Main card");
  card(p, "say1", "Sam", { kind: "excerpt", body: "spoken words" });
  link(p, "main", "say1", "supported_by");
  card(p, "src1", "RFC", { kind: "source", why: "a finding" });
  link(p, "main", "src1", "supported_by");
  const r = await werk(p, "show", "main");
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/^\s*Say\b/m);
  expect(r.stdout).toMatch(/^\s*Ev\b/m);
  expect(r.stdout).not.toMatch(/^\s*Options\b/m);
});

test("11.5 show with no id prints the root card", async () => {
  decided(p, "root", "The root card");
  card(p, "second", "Second card", { parent: "root" });
  const r = await werk(p, "show");
  expect(r.code, `exit ${r.code}: ${r.stderr}`).toBe(0);
  expect(r.stdout).toContain("The root card");
  expect(rollupLines(r.stdout).length).toBeGreaterThan(0);
  const l = r.stdout.split("\n").find((x) => x.includes("<-") && x.includes("refines"));
  expect(l).toBeDefined();
  expect(r.stdout).toMatch(/\b(1|2) cards?\b/);
});

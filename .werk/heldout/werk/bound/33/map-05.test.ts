import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { card, decide, seed, setup } from "./map-support.ts";

const s = setup();
beforeEach(() => {
  s.make();
});
afterEach(() => s.done());

const decidedAuth = () => decide(s.werk, "auth", "Auth");

test("05.1 propose a card under a parent and read it back", async () => {
  await decidedAuth();
  const before = s.p.events().length;
  const r = await s.werk("add", "login", "--title", "Use magic links", "--why", "w", "--parent", "auth");
  expect(r.stdout.trim()).toBe("proposed");
  expect(s.p.events().length).toBe(before + 1);
  const shown = (await s.werk("show", "login")).stdout;
  expect(shown).toContain("Use magic links");
  expect(shown).toContain("proposed");
  expect(shown).toContain("auth");
  expect(shown.toLowerCase()).toMatch(/rollup|open|proto|decided/);
  console.log(shown);
});

test("05.2 duplicate id refused", async () => {
  await decidedAuth();
  await s.werk("add", "login", "--title", "First words", "--parent", "auth");
  const n = s.p.events().length;
  const r = await s.werk("add", "login", "--title", "Other words", "--parent", "auth");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toContain("duplicate-id");
  expect(s.p.events().length).toBe(n);
  expect((await s.werk("show", "login")).stdout).toContain("First words");
});

test("05.3 decided status refused on add", async () => {
  await decidedAuth();
  const n = s.p.events().length;
  const r = await s.werk("add", "pay", "--title", "Pay", "--parent", "auth", "--status", "decided");
  expect(r.code).not.toBe(0);
  expect(r.stderr.toLowerCase()).toContain("decided");
  expect(s.p.events().length).toBe(n);
  const shown = await s.werk("show", "pay");
  expect(shown.code).not.toBe(0);
  console.log(shown.stderr, shown.stdout);
  expect(shown.stderr.toLowerCase()).toMatch(/not found|unknown/);
});

test("05.4 hash optional on ids, kept in title", async () => {
  await s.werk("add", "auth", "--title", "Auth");
  const r = await s.werk("add", "#login", "--title", "#1 priority: magic links", "--parent", "#auth");
  expect(r.stdout.trim()).toBe("proposed");
  const a = (await s.werk("show", "#login")).stdout;
  const b = (await s.werk("show", "login")).stdout;
  expect(a).toBe(b);
  expect(a).toContain("#1 priority: magic links");
  expect(a).toContain("auth");
});

test("05.5 bad hand-written line listed; later cards show", async () => {
  seed(s.p, ...card("auth"));
  seed(s.p, { type: "node.proposed", id: "orphan", kind: "card", title: "o", status: "open", parent: "nowhere" });
  seed(s.p, card("login")[0]);
  const shown = await s.werk("show", "login");
  expect(shown.stdout).toContain("proposed");
  expect(shown.stderr).toMatch(/line 3/);
  expect(shown.stderr).toContain("unknown-card");
  expect(readFileSync(s.p.logPath, "utf8")).toContain("orphan");
});

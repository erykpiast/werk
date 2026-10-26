import { expect, test } from "bun:test";
import { Map_ } from "./b-lib.ts";

const isGhost = (out: string) => /\bproposed\b/.test(out.split("\n")[0] as string);

test("04.1 new card waits as a ghost until accepted", async () => {
  const m = new Map_();
  await m.root();
  await m.real("checkout", "Checkout flow");
  await m.ghost("other-ghost", "Other ghost");
  const before = m.count();
  const add = await m.ok("add", "retry", "--title", "Retry payment", "--parent", "checkout");
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  expect(m.count()).toBe(before + 1);
  const ev = m.events().at(-1)!;
  expect(ev.type).toBe("node.proposed");
  expect(ev.payload.parent).toBe("checkout");
  const s = await m.ok("show", "retry");
  expect(isGhost(s.out)).toBe(true);
  expect(s.out).toContain("parent: checkout  Checkout flow");
  const b2 = m.count();
  await m.ok("accept", "retry", "--actor", "you");
  expect(m.count()).toBe(b2 + 1);
  expect(m.events().at(-1)!.type).toContain("accept");
  const s2 = await m.ok("show", "retry");
  expect(isGhost(s2.out)).toBe(false);
  expect(s2.out).toContain("parent: checkout  Checkout flow");
  expect(isGhost((await m.ok("show", "other-ghost")).out)).toBe(true);
});

test("04.2 accept child accepts ghost parent, option, source; held link goes live", async () => {
  const m = new Map_();
  await m.root();
  await m.real("payments", "Payments");
  await m.real("fraud", "Fraud rules");
  await m.ghost("refunds", "Refunds", "payments");
  await m.ghost("partial", "Partial refunds", "refunds");
  await m.ok("link", "partial", "fraud", "--type", "depends_on", "--why", "fraud limits");
  await m.ok("add", "partial:opt0", "--kind", "option", "--title", "No partials", "--why_not", "customers ask");
  await m.ok("link", "partial:opt0", "partial", "--type", "alternative_to");
  await m.ok("add", "src", "--kind", "source", "--title", "Notes", "--finding", "f");
  await m.ok("link", "partial", "src", "--type", "supported_by");
  const held = await m.ok("show", "partial");
  expect(held.out).toMatch(/depends_on\s+fraud.*\(held\)/);
  const before = m.count();
  await m.ok("accept", "partial", "--actor", "you");
  const added = m.events().slice(before);
  expect(added.length).toBeGreaterThan(0);
  for (const e of added) {
    expect(e.type).toContain("accept");
    expect(e.type).not.toContain("edge");
  }
  expect(isGhost((await m.ok("show", "refunds")).out)).toBe(false);
  const s = await m.ok("show", "partial");
  expect(isGhost(s.out)).toBe(false);
  expect(s.out).not.toMatch(/\bproposed\b/);
  expect(s.out).not.toContain("(held)");
  expect(s.out).toMatch(/depends_on\s+fraud/);
  expect(s.out).not.toMatch(/depends_on\s+fraud.*\(held\)/);
  expect(isGhost((await m.ok("show", "partial:opt0")).out)).toBe(false);
  expect(isGhost((await m.ok("show", "src")).out)).toBe(false);
});

test("04.3 discarding ghost parent drops ghost children", async () => {
  const m = new Map_();
  await m.root();
  await m.real("onboarding", "Onboarding");
  await m.ghost("email", "Email verification", "onboarding");
  await m.ghost("resend", "Resend email", "email");
  await m.ok("discard", "email");
  for (const id of ["email", "resend"]) {
    const r = await m.w("show", id);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("no node");
  }
  const o = await m.ok("show", "onboarding");
  expect(o.out).not.toContain("ghost");
  expect(o.out).not.toContain("Email verification");
});

test("04.4 ghost words frozen", async () => {
  const m = new Map_();
  await m.root();
  await m.real("search", "Search");
  await m.ok("add", "search-index", "--title", "First title", "--why", "first why", "--parent", "search");
  const before = m.raw();
  const r = await m.w("add", "search-index", "--title", "Second title", "--why", "second why", "--parent", "search");
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("frozen");
  expect(m.raw()).toBe(before);
  const s = await m.ok("show", "search-index");
  expect(s.out).toContain("First title");
  expect(s.out).toContain("first why");
});

test("04.5 accept needs --actor you", async () => {
  const m = new Map_();
  await m.root();
  await m.real("p", "P");
  await m.ghost("audit", "Audit log", "p");
  const before = m.raw();
  const r = await m.w("accept", "audit");
  expect(r.code).not.toBe(0);
  expect(m.raw()).toBe(before);
  expect(isGhost((await m.ok("show", "audit")).out)).toBe(true);
  const ok = await m.w("accept", "audit", "--actor", "you");
  expect(ok.code).toBe(0);
  expect(isGhost((await m.ok("show", "audit")).out)).toBe(false);
});

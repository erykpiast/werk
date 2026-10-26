import { expect, test } from "bun:test";
import { events, lines, ok, real, w, withRoot } from "./h.ts";

test("04.1 new card waits as a ghost until accepted", async () => {
  const p = withRoot();
  await real(p, "checkout", "Checkout flow");
  const before = lines(p);
  const add = await ok(p, "add", "retry", "--title", "Retry payment", "--parent", "checkout");
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = lines(p);
  expect(after.length).toBe(before.length + 1);
  expect(JSON.parse(after.at(-1) as string)).toMatchObject({
    type: "node.proposed",
    payload: { id: "retry", parent: "checkout" },
  });
  const show = (await ok(p, "show", "retry")).out;
  expect(show).toContain("proposed");
  expect(show).toContain("parent: checkout  Checkout flow");
  await ok(p, "add", "other", "--title", "Other ghost");
  const n = lines(p).length;
  await ok(p, "accept", "retry", "--actor", "you");
  expect(lines(p).length).toBe(n + 1);
  expect(JSON.parse(lines(p).at(-1) as string).type).toBe("change.accepted");
  const s2 = (await ok(p, "show", "retry")).out;
  expect(s2).not.toContain("proposed");
  expect(s2).toContain("parent: checkout");
  expect((await ok(p, "show", "other")).out).toContain("proposed");
});

test("04.2 accept child accepts ghost parent; held link goes live with no link event", async () => {
  const p = withRoot();
  await real(p, "payments", "Payments");
  await real(p, "fraud", "Fraud rules");
  await ok(p, "add", "refunds", "--title", "Refunds", "--parent", "payments");
  await ok(p, "add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await ok(p, "link", "partial", "fraud", "--type", "depends_on", "--why", "needs rules");
  await ok(p, "add", "partial:opt0", "--kind", "option", "--title", "Opt", "--why_not", "no");
  await ok(p, "link", "partial:opt0", "partial", "--type", "alternative_to");
  await ok(p, "add", "src1", "--kind", "source", "--title", "Src", "--finding", "f");
  await ok(p, "link", "partial", "src1", "--type", "supported_by");
  const held = (await ok(p, "show", "partial")).out;
  expect(held).toMatch(/depends_on\s+fraud\s+Fraud rules\s+\(held\)/);
  const n = lines(p).length;
  await ok(p, "accept", "partial", "--actor", "you");
  const added = events(p).slice(n);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((e) => e.type === "change.accepted")).toBe(true);
  expect(added.some((e) => e.type.startsWith("edge"))).toBe(false);
  expect((await ok(p, "show", "refunds")).out).not.toContain("proposed");
  expect((await ok(p, "show", "partial")).out.split("\n")[0]).not.toContain("proposed");
  expect((await ok(p, "show", "partial:opt0")).out).not.toContain("proposed");
  expect((await ok(p, "show", "src1")).out).not.toContain("proposed");
  const live = (await ok(p, "show", "partial")).out;
  expect(live).toMatch(/depends_on\s+fraud\s+Fraud rules\n/);
  expect(live).not.toMatch(/depends_on\s+fraud.*held/);
});

test("04.3 discard ghost parent drops ghost children", async () => {
  const p = withRoot();
  await real(p, "onboarding", "Onboarding");
  await ok(p, "add", "email", "--title", "Email verification", "--parent", "onboarding");
  await ok(p, "add", "resend", "--title", "Resend email", "--parent", "email");
  await ok(p, "discard", "email");
  for (const id of ["email", "resend"]) {
    const r = await w(p, "show", id);
    expect(r.code).not.toBe(0);
    expect(r.err + r.out).toMatch(/no node #\w+ in the map/);
  }
  const on = (await ok(p, "show", "onboarding")).out;
  expect(on).not.toContain("ghost");
  expect(on).not.toContain("Email verification");
});

test("04.4 ghost words are frozen", async () => {
  const p = withRoot();
  await real(p, "search", "Search");
  await ok(p, "add", "idx", "--title", "Search index", "--why", "first why", "--parent", "search");
  const n = lines(p).length;
  const r = await w(p, "add", "idx", "--title", "Other title", "--why", "other why", "--parent", "search");
  expect(r.code).not.toBe(0);
  expect(r.err.toLowerCase()).toMatch(/frozen/);
  expect(lines(p).length).toBe(n);
  const s = (await ok(p, "show", "idx")).out;
  expect(s).toContain("Search index");
  expect(s).toContain("first why");
});

test("04.5 accept needs --actor you", async () => {
  const p = withRoot();
  await real(p, "base", "Base");
  await ok(p, "add", "audit", "--title", "Audit log", "--parent", "base");
  const n = lines(p).length;
  const r = await w(p, "accept", "audit");
  expect(r.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect((await ok(p, "show", "audit")).out).toContain("proposed");
  await ok(p, "accept", "audit", "--actor", "you");
  expect((await ok(p, "show", "audit")).out).not.toContain("proposed");
});

import { expect, test } from "bun:test";
import { world } from "./b-helpers.ts";

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const w = world();
  w.card("checkout", "Checkout flow");
  await w.ok("add", "other", "--title", "Other ghost");
  const before = w.log().length;
  const add = await w.werk(["add", "retry", "--title", "Retry payment", "--parent", "checkout"]);
  expect(add.code).toBe(0);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = w.log();
  expect(after.length).toBe(before + 1);
  const ev = after.at(-1) as { type: string; payload: { parent?: string } };
  expect(ev.type).toBe("node.proposed");
  expect(ev.payload.parent).toBe("checkout");
  const ghost = await w.ok("show", "retry");
  expect(ghost.split("\n")[0]).toContain("proposed");
  expect(ghost).toMatch(/parent: checkout\s+Checkout flow/);

  const n = w.log().length;
  await w.ok("accept", "retry", "--actor", "you");
  const accepts = w.log().slice(n);
  expect(accepts.length).toBe(1);
  expect(accepts[0]?.type).toBe("change.accepted");
  const real = await w.ok("show", "retry");
  expect(real.split("\n")[0]).not.toContain("proposed");
  expect(real).toMatch(/parent: checkout\s+Checkout flow/);
  expect((await w.ok("show", "other")).split("\n")[0]).toContain("proposed");
});

test("04.2 accepting a ghost child accepts its ghost parent and its held link goes live", async () => {
  const w = world();
  w.card("payments", "Payments");
  w.card("fraud", "Fraud rules");
  await w.ok("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await w.ok("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await w.ok("link", "partial", "fraud", "--type", "depends_on", "--why", "limits come from fraud rules");
  await w.ok("add", "partial:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "too strict");
  await w.ok("link", "partial:opt0", "partial", "--type", "alternative_to");
  await w.ok("add", "stripe", "--kind", "source", "--title", "Stripe docs", "--finding", "partial refunds work");
  await w.ok("link", "partial", "stripe", "--type", "supported_by");
  const held = await w.ok("show", "partial");
  expect(held).toMatch(/-> depends_on\s+fraud\s+Fraud rules\s+\(held\)/);

  const n = w.log().length;
  await w.ok("accept", "partial", "--actor", "you");
  const added = w.log().slice(n);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((e) => e.type === "change.accepted")).toBe(true);

  for (const id of ["refunds", "partial"]) {
    const out = await w.ok("show", id);
    expect(out.split("\n")[0]).toMatch(/^card /);
    expect(out.split("\n")[0]).not.toContain("proposed");
  }
  expect((await w.ok("show", "partial:opt0")).split("\n")[0]).not.toContain("proposed");
  expect((await w.ok("show", "stripe")).split("\n")[0]).not.toContain("proposed");
  const live = await w.ok("show", "partial");
  const line = live.split("\n").find((l) => /-> depends_on\s+fraud/.test(l)) ?? "";
  expect(line).not.toContain("held");
  expect(line).toContain("Fraud rules");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const w = world();
  w.card("onboarding", "Onboarding");
  await w.ok("add", "email-verification", "--title", "Email verification", "--parent", "onboarding");
  await w.ok("add", "resend-email", "--title", "Resend email", "--parent", "email-verification");
  await w.ok("discard", "email-verification");
  for (const id of ["email-verification", "resend-email"]) {
    const r = await w.werk(["show", id]);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("no node");
  }
  const onb = await w.ok("show", "onboarding");
  expect(onb).not.toContain("ghost");
  expect(onb).not.toContain("<- refines");
});

test("04.4 the words of a ghost are frozen", async () => {
  const w = world();
  w.card("search", "Search");
  await w.ok("add", "search-index", "--title", "One index per project", "--why", "Fast lookups", "--parent", "search");
  const n = w.log().length;
  const again = await w.werk(["add", "search-index", "--title", "Two indexes", "--why", "Other words", "--parent", "search"]);
  expect(again.code).not.toBe(0);
  expect(again.err).toMatch(/frozen/);
  expect(w.log().length).toBe(n);
  const show = await w.ok("show", "search-index");
  expect(show).toContain("One index per project");
  expect(show).toContain("Fast lookups");
  expect(show).not.toContain("Two indexes");
});

test("04.5 an accept from the command line needs --actor you", async () => {
  const w = world();
  w.card("ops", "Operations");
  await w.ok("add", "audit-log", "--title", "Audit log", "--parent", "ops");
  const n = w.log().length;
  const bare = await w.werk(["accept", "audit-log"]);
  expect(bare.code).not.toBe(0);
  expect(w.log().length).toBe(n);
  expect((await w.ok("show", "audit-log")).split("\n")[0]).toContain("proposed");
  const yes = await w.werk(["accept", "audit-log", "--actor", "you"]);
  expect(yes.code).toBe(0);
  expect((await w.ok("show", "audit-log")).split("\n")[0]).not.toContain("proposed");
});

import { expect, test } from "bun:test";
import { card, decided, lines, ok, project, seed } from "./helpers.ts";

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = project();
  seed(p, [card("checkout-flow", "Checkout flow"), decided("checkout-flow"), card("other", "Other")]);
  await ok(p, ["add", "other-ghost", "--title", "Other ghost", "--parent", "other"]);
  const before = lines(p).length;
  const add = await ok(p, ["add", "retry-payment", "--title", "Retry payment", "--why", "w", "--parent", "checkout-flow"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = lines(p);
  expect(after.length).toBe(before + 1);
  expect(after.at(-1)).toMatchObject({ type: "node.proposed", payload: { id: "retry-payment", parent: "checkout-flow" } });
  const show = await ok(p, ["show", "retry-payment"]);
  expect(show.out.split("\n")[0]).toContain("proposed");
  expect(show.out).toContain("parent: checkout-flow  Checkout flow");
  const acc = await ok(p, ["accept", "retry-payment", "--actor", "you"]);
  expect(acc.code).toBe(0);
  const afterAccept = lines(p);
  expect(afterAccept.length).toBe(before + 2);
  expect(afterAccept.at(-1)).toMatchObject({ type: "change.accepted", payload: { id: "retry-payment" } });
  const real = await ok(p, ["show", "retry-payment"]);
  expect(real.out.split("\n")[0]).not.toContain("proposed");
  expect(real.out).toContain("parent: checkout-flow  Checkout flow");
  expect(real.out).toMatch(/-> refines\s+checkout-flow  Checkout flow\n/);
  const other = await ok(p, ["show", "other-ghost"]);
  expect(other.out.split("\n")[0]).toContain("proposed");
});

test("04.2 accepting a ghost child accepts its ghost parent, and its held link goes live", async () => {
  const p = project();
  seed(p, [card("payments", "Payments"), card("fraud-rules", "Fraud rules")]);
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial-refunds", "fraud-rules", "--type", "depends_on", "--why", "needs the fraud rules"]);
  await ok(p, ["add", "partial-refunds:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "too coarse"]);
  await ok(p, ["link", "partial-refunds:opt0", "partial-refunds", "--type", "alternative_to"]);
  await ok(p, ["add", "psp-docs", "--kind", "source", "--title", "PSP docs", "--finding", "PSPs allow partial"]);
  await ok(p, ["link", "partial-refunds", "psp-docs", "--type", "supported_by"]);
  const held = await ok(p, ["show", "partial-refunds"]);
  expect(held.out).toMatch(/-> depends_on\s+fraud-rules  Fraud rules  \(held\)/);
  const before = lines(p).length;
  await ok(p, ["accept", "partial-refunds", "--actor", "you"]);
  const added = lines(p).slice(before);
  expect(added.length).toBeGreaterThan(0);
  for (const e of added) expect(e.type).toBe("change.accepted");
  for (const id of ["refunds", "partial-refunds", "partial-refunds:opt0", "psp-docs"]) {
    const s = await ok(p, ["show", id]);
    expect(s.out.split("\n")[0]).not.toContain("proposed");
  }
  const live = await ok(p, ["show", "partial-refunds"]);
  expect(live.out).toMatch(/-> depends_on\s+fraud-rules  Fraud rules\n/);
  expect(live.out).not.toContain("(held)");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = project();
  seed(p, [card("onboarding", "Onboarding")]);
  await ok(p, ["add", "email-verification", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend-email", "--title", "Resend email", "--parent", "email-verification"]);
  await ok(p, ["discard", "email-verification"]);
  for (const id of ["email-verification", "resend-email"]) {
    const s = await p.werk(["show", id]);
    expect(s.code).not.toBe(0);
    expect(s.err).toContain("in the map");
    expect(s.err).toContain(`no node #${id}`);
  }
  const on = await ok(p, ["show", "onboarding"]);
  expect(on.out).not.toContain("<- refines");
  expect(on.out).not.toContain("proposed");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = project();
  seed(p, [card("search", "Search")]);
  await ok(p, ["add", "search-index", "--title", "Search index", "--why", "fast lookup", "--parent", "search"]);
  const before = lines(p).length;
  const again = await p.werk(["add", "search-index", "--title", "Other words", "--why", "other why", "--parent", "search"]);
  expect(again.code).not.toBe(0);
  expect(`${again.out}${again.err}`).toMatch(/frozen/i);
  expect(lines(p).length).toBe(before);
  const s = await ok(p, ["show", "search-index"]);
  expect(s.out).toContain("Search index");
  expect(s.out).toContain("why: fast lookup");
});

test("04.5 an accept from the command line needs --actor you", async () => {
  const p = project();
  seed(p, [card("ops", "Ops")]);
  await ok(p, ["add", "audit-log", "--title", "Audit log", "--parent", "ops"]);
  const before = lines(p).length;
  const no = await p.werk(["accept", "audit-log"]);
  expect(no.code).not.toBe(0);
  expect(lines(p).length).toBe(before);
  expect((await ok(p, ["show", "audit-log"])).out.split("\n")[0]).toContain("proposed");
  const yes = await p.werk(["accept", "audit-log", "--actor", "you"]);
  expect(yes.code).toBe(0);
  expect((await ok(p, ["show", "audit-log"])).out.split("\n")[0]).not.toContain("proposed");
});

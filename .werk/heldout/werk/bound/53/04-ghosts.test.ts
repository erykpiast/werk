// Held-out steps 04.x: an agent's card is a ghost until the person accepts it.
import { expect, test } from "bun:test";
import { card, events, lines, ok, seeded } from "./helpers.ts";

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = seeded([card("checkout-flow", "Checkout flow")]);
  // Another ghost elsewhere, so "every other ghost" has a member.
  await ok(p, ["add", "refund-payment", "--title", "Refund payment", "--parent", "checkout-flow"]);
  const before = lines(p).length;
  const add = await ok(p, ["add", "retry-payment", "--title", "Retry payment", "--why", "Cards fail.", "--parent", "checkout-flow"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = events(p);
  expect(after.length).toBe(before + 1);
  expect(after.at(-1)).toMatchObject({ type: "node.proposed", payload: { id: "retry-payment", parent: "checkout-flow" } });
  const show = (await ok(p, ["show", "retry-payment"])).out;
  expect(show).toStartWith("card retry-payment  [open]  proposed\n");
  expect(show).toContain("parent: checkout-flow  Checkout flow");

  const n = lines(p).length;
  await ok(p, ["accept", "retry-payment", "--actor", "you"]);
  const accepted = events(p).slice(n);
  expect(accepted.length).toBe(1);
  expect(accepted[0]).toMatchObject({ type: "change.accepted", payload: { id: "retry-payment" } });
  const real = (await ok(p, ["show", "retry-payment"])).out;
  expect(real.split("\n")[0]).not.toContain("proposed");
  expect(real).toContain("parent: checkout-flow  Checkout flow");
  expect(real).toContain("-> refines         checkout-flow  Checkout flow\n");
  expect((await ok(p, ["show", "refund-payment"])).out).toStartWith("card refund-payment  [open]  proposed\n");
});

test("04.2 accepting a ghost child accepts its ghost parent, and the held link goes live", async () => {
  const p = seeded([card("payments", "Payments"), card("fraud-rules", "Fraud rules")]);
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial-refunds", "fraud-rules", "--type", "depends_on", "--why", "a partial refund obeys the fraud limits"]);
  await ok(p, ["add", "pr-opt", "--kind", "option", "--title", "Full refunds only", "--why_not", "Customers ask for partial ones"]);
  await ok(p, ["link", "pr-opt", "partial-refunds", "--type", "alternative_to"]);
  await ok(p, ["add", "pr-src", "--kind", "source", "--title", "Support tickets", "--finding", "Many ask for partial refunds"]);
  await ok(p, ["link", "partial-refunds", "pr-src", "--type", "supported_by"]);
  const held = (await ok(p, ["show", "partial-refunds"])).out;
  expect(held).toMatch(/-> depends_on +fraud-rules +Fraud rules +\(held\)/);

  const n = lines(p).length;
  await ok(p, ["accept", "partial-refunds", "--actor", "you"]);
  const added = events(p).slice(n);
  expect(added.length).toBeGreaterThan(0);
  for (const e of added) expect(e.type).toBe("change.accepted");
  expect(added.map((e) => e.payload.id).sort()).toEqual(["partial-refunds", "pr-opt", "pr-src", "refunds"]);

  for (const id of ["refunds", "partial-refunds", "pr-opt", "pr-src"])
    expect((await ok(p, ["show", id])).out.split("\n")[0]).not.toContain("proposed");
  const live = (await ok(p, ["show", "partial-refunds"])).out;
  expect(live).toMatch(/-> depends_on +fraud-rules +Fraud rules\n/);
  expect(live).not.toContain("held");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = seeded([card("onboarding", "Onboarding")]);
  await ok(p, ["add", "email-verification", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend-email", "--title", "Resend email", "--parent", "email-verification"]);
  await ok(p, ["discard", "email-verification"]);
  for (const id of ["email-verification", "resend-email"]) {
    const run = await p.werk(["show", id]);
    expect(run.code).not.toBe(0);
    expect(run.err).toContain("no node");
  }
  const show = (await ok(p, ["show", "onboarding"])).out;
  expect(show).not.toContain("ghost");
  expect(show).not.toContain("<- refines");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = seeded([card("search", "Search")]);
  await ok(p, ["add", "search-index", "--title", "Search index", "--why", "Queries must be fast.", "--parent", "search"]);
  const n = lines(p).length;
  const again = await p.werk(["add", "search-index", "--title", "Search index v2", "--why", "Other words.", "--parent", "search"]);
  expect(again.code).not.toBe(0);
  expect(`${again.out}${again.err}`.toLowerCase()).toContain("frozen");
  expect(lines(p).length).toBe(n);
  const show = (await ok(p, ["show", "search-index"])).out;
  expect(show).toContain("\nSearch index\n");
  expect(show).toContain("why: Queries must be fast.");
});

test("04.5 an accept from the command line needs --actor you", async () => {
  const p = seeded([card("platform", "Platform")]);
  await ok(p, ["add", "audit-log", "--title", "Audit log", "--parent", "platform"]);
  const n = lines(p).length;
  const refused = await p.werk(["accept", "audit-log"]);
  expect(refused.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect((await ok(p, ["show", "audit-log"])).out).toStartWith("card audit-log  [open]  proposed\n");
  const done = await p.werk(["accept", "audit-log", "--actor", "you"]);
  expect(done.code).toBe(0);
  expect((await ok(p, ["show", "audit-log"])).out.split("\n")[0]).not.toContain("proposed");
});

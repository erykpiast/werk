import { expect, test } from "bun:test";
import { card, events, ghost, ok, withMap } from "./helpers.ts";

test("04.1", async () => {
  // A second ghost lets the last Then check that the accept leaves other ghosts alone.
  const p = withMap([card("checkout-flow", "Checkout flow"), ghost("other-ghost", "Other ghost", "checkout-flow")]);
  const before = events(p).length;
  const add = await ok(p, ["add", "retry-payment", "--title", "Retry payment", "--parent", "checkout-flow"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = events(p);
  expect(after.length).toBe(before + 1);
  expect(after[before]).toMatchObject({
    type: "node.proposed",
    payload: { id: "retry-payment", parent: "checkout-flow" },
  });
  const shown = (await ok(p, ["show", "retry-payment"])).out;
  expect(shown.split("\n")[0]).toContain("proposed");
  expect(shown).toContain("parent: checkout-flow  Checkout flow");

  const acc = await ok(p, ["accept", "retry-payment", "--actor", "you"]);
  expect(acc.code).toBe(0);
  const later = events(p);
  expect(later.length).toBe(before + 2);
  expect(later[before + 1]).toMatchObject({ type: "change.accepted", payload: { id: "retry-payment" } });
  const real = (await ok(p, ["show", "retry-payment"])).out;
  expect(real.split("\n")[0]).not.toContain("proposed");
  expect(real).toContain("parent: checkout-flow  Checkout flow");
  expect((await ok(p, ["show", "other-ghost"])).out.split("\n")[0]).toContain("proposed");
});

test("04.2", async () => {
  const p = withMap([card("payments", "Payments"), card("fraud-rules", "Fraud rules")]);
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, [
    "link",
    "partial-refunds",
    "fraud-rules",
    "--type",
    "depends_on",
    "--why",
    "A partial refund passes the fraud rules",
  ]);
  await ok(p, [
    "add",
    "partial-refunds:opt0",
    "--kind",
    "option",
    "--title",
    "Full refunds only",
    "--why_not",
    "Too coarse",
  ]);
  await ok(p, ["link", "partial-refunds:opt0", "partial-refunds", "--type", "alternative_to"]);
  await ok(p, [
    "add",
    "src-refund-policy",
    "--kind",
    "source",
    "--title",
    "Refund policy",
    "--url",
    "https://example.com/refunds",
  ]);
  await ok(p, ["link", "partial-refunds", "src-refund-policy", "--type", "supported_by"]);
  const held = (await ok(p, ["show", "partial-refunds"])).out;
  const depLine = held.split("\n").find((l) => l.includes("-> depends_on") && l.includes("fraud-rules"));
  expect(depLine).toContain("(held)");

  const before = events(p).length;
  await ok(p, ["accept", "partial-refunds", "--actor", "you"]);
  const added = events(p).slice(before);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((e) => e.type === "change.accepted")).toBe(true);

  for (const id of ["refunds", "partial-refunds", "partial-refunds:opt0", "src-refund-policy"]) {
    const out = (await ok(p, ["show", id])).out;
    expect(out.split("\n")[0]).not.toContain("proposed");
  }
  const live = (await ok(p, ["show", "partial-refunds"])).out;
  const liveLine = live.split("\n").find((l) => l.includes("-> depends_on") && l.includes("fraud-rules"));
  expect(liveLine).toBeDefined();
  expect(liveLine).not.toContain("held");
});

test("04.3", async () => {
  const p = withMap([card("onboarding", "Onboarding")]);
  await ok(p, ["add", "email-verification", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend-email", "--title", "Resend email", "--parent", "email-verification"]);
  await ok(p, ["discard", "email-verification"]);
  for (const id of ["email-verification", "resend-email"]) {
    const run = await p.werk(["show", id]);
    expect(run.code).toBe(1);
    expect(run.err).toContain("no node");
    expect(run.err).toContain("in the map");
  }
  const onboarding = (await ok(p, ["show", "onboarding"])).out;
  expect(onboarding).not.toContain("refines");
  expect(onboarding).not.toContain("ghost");
});

test("04.4", async () => {
  const p = withMap([card("search", "Search")]);
  await ok(p, ["add", "search-index", "--title", "Search index", "--why", "Fast lookups", "--parent", "search"]);
  const before = events(p).length;
  const again = await p.werk([
    "add",
    "search-index",
    "--title",
    "Search index v2",
    "--why",
    "Other words",
    "--parent",
    "search",
  ]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("frozen");
  expect(events(p).length).toBe(before);
  const shown = (await ok(p, ["show", "search-index"])).out;
  expect(shown).toContain("\nSearch index\n");
  expect(shown).toContain("why: Fast lookups");
});

test("04.5", async () => {
  const p = withMap([card("platform", "Platform")]);
  await ok(p, ["add", "audit-log", "--title", "Audit log", "--parent", "platform"]);
  const before = events(p).length;
  const refused = await p.werk(["accept", "audit-log"]);
  expect(refused.code).not.toBe(0);
  expect(events(p).length).toBe(before);
  expect((await ok(p, ["show", "audit-log"])).out.split("\n")[0]).toContain("proposed");
  const accepted = await p.werk(["accept", "audit-log", "--actor", "you"]);
  expect(accepted.code).toBe(0);
  expect((await ok(p, ["show", "audit-log"])).out.split("\n")[0]).not.toContain("proposed");
});

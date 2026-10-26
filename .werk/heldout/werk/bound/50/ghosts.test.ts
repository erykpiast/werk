// Scenarios 04.x: an agent's card is a ghost until the person accepts it.
import { expect, test } from "bun:test";
import { events, head, lines, ok, project, real, seed } from "./helpers.ts";

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = project();
  seed(p, [real("checkout-flow", "Checkout flow")]);
  // Another ghost in the map, so "every other ghost is still a ghost" has something to check.
  await ok(p, ["add", "other-ghost", "--title", "Another ghost", "--parent", "checkout-flow"]);
  const before = lines(p).length;

  const add = await ok(p, ["add", "retry-payment", "--title", "Retry payment", "--parent", "checkout-flow"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const fresh = events(p).slice(before);
  expect(fresh).toHaveLength(1);
  expect(fresh[0]?.type).toBe("node.proposed");
  expect(fresh[0]?.payload.parent).toBe("checkout-flow");

  const ghost = (await ok(p, ["show", "retry-payment"])).out;
  expect(ghost.split("\n")[0]).toContain("proposed");
  expect(ghost).toContain("parent: checkout-flow  Checkout flow");

  const mid = lines(p).length;
  await ok(p, ["accept", "retry-payment", "--actor", "you"]);
  const accepted = events(p).slice(mid);
  expect(accepted).toHaveLength(1);
  expect(accepted[0]?.type).toBe("change.accepted");

  const now = (await ok(p, ["show", "retry-payment"])).out;
  expect(now.split("\n")[0]).not.toContain("proposed");
  expect(now).toContain("parent: checkout-flow  Checkout flow");
  expect(await head(p, "other-ghost")).toContain("proposed");
});

test("04.2 accepting a ghost child accepts its ghost parent, and its held link goes live", async () => {
  const p = project();
  seed(p, [real("payments", "Payments"), real("fraud-rules", "Fraud rules")]);
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, [
    "link",
    "partial-refunds",
    "fraud-rules",
    "--type",
    "depends_on",
    "--why",
    "a partial refund runs the fraud rules",
  ]);
  await ok(p, [
    "add",
    "partial-refunds:opt0",
    "--kind",
    "option",
    "--title",
    "Only full refunds",
    "--why_not",
    "customers return single items",
  ]);
  await ok(p, ["link", "partial-refunds:opt0", "partial-refunds", "--type", "alternative_to"]);
  await ok(p, [
    "add",
    "src-refund-study",
    "--kind",
    "source",
    "--title",
    "Refund study",
    "--url",
    "https://example.com/refunds",
  ]);
  await ok(p, ["link", "partial-refunds", "src-refund-study", "--type", "supported_by"]);

  const held = (await ok(p, ["show", "partial-refunds"])).out;
  const depLine = held.split("\n").find((line) => line.includes("depends_on") && line.includes("fraud-rules"));
  expect(depLine).toBeDefined();
  expect(depLine).toContain("held");

  const before = lines(p).length;
  await ok(p, ["accept", "partial-refunds", "--actor", "you"]);
  const fresh = events(p).slice(before);
  expect(fresh.length).toBeGreaterThan(0);
  expect(fresh.every((event) => event.type === "change.accepted")).toBe(true);

  expect(await head(p, "refunds")).not.toContain("proposed");
  expect(await head(p, "partial-refunds")).not.toContain("proposed");
  expect(await head(p, "partial-refunds:opt0")).not.toContain("proposed");
  expect(await head(p, "src-refund-study")).not.toContain("proposed");
  const live = (await ok(p, ["show", "partial-refunds"])).out;
  const liveLine = live.split("\n").find((line) => line.includes("depends_on") && line.includes("fraud-rules"));
  expect(liveLine).toBeDefined();
  expect(liveLine).not.toContain("held");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = project();
  seed(p, [real("onboarding", "Onboarding")]);
  await ok(p, ["add", "email-verification", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend-email", "--title", "Resend email", "--parent", "email-verification"]);
  await ok(p, ["discard", "email-verification"]);
  for (const id of ["email-verification", "resend-email"]) {
    const run = await p.werk(["show", id]);
    expect(run.code).not.toBe(0);
    expect(run.err).toContain("no node");
  }
  const onboarding = (await ok(p, ["show", "onboarding"])).out;
  expect(onboarding).not.toContain("ghost");
  expect(onboarding).not.toContain("email-verification");
  expect(onboarding).not.toContain("resend-email");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = project();
  seed(p, [real("search", "Search")]);
  await ok(p, [
    "add",
    "search-index",
    "--title",
    "Search index",
    "--why",
    "Search reads one index",
    "--parent",
    "search",
  ]);
  const before = lines(p);
  const again = await p.werk([
    "add",
    "search-index",
    "--title",
    "Search index, reworded",
    "--why",
    "Another reason",
    "--parent",
    "search",
  ]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("frozen");
  expect(lines(p)).toEqual(before);
  const shown = (await ok(p, ["show", "search-index"])).out;
  expect(shown.split("\n")[1]).toBe("Search index");
  expect(shown).toContain("why: Search reads one index");
});

test("04.5 an accept from the command line needs the statement that the person asked for it", async () => {
  const p = project();
  seed(p, [real("compliance", "Compliance")]);
  await ok(p, ["add", "audit-log", "--title", "Audit log", "--parent", "compliance"]);
  const before = lines(p);
  const refused = await p.werk(["accept", "audit-log"]);
  expect(refused.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect(await head(p, "audit-log")).toContain("proposed");
  const accepted = await p.werk(["accept", "audit-log", "--actor", "you"]);
  expect(accepted.code).toBe(0);
  const now = await head(p, "audit-log");
  expect(now).toStartWith("card audit-log");
  expect(now).not.toContain("proposed");
});

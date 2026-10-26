// Held-out steps 04.1 to 04.5: ghosts, accept and discard at the command line.
import { expect, test } from "bun:test";
import { events, mapWith, ok } from "./helpers.ts";

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = mapWith([
    { id: "checkout-flow", title: "Checkout flow" },
    { id: "other-real", title: "Other real" },
  ]);
  // Another ghost elsewhere in the map, to check "every other ghost is still a ghost".
  await ok(p, ["add", "other-ghost", "--title", "Other ghost", "--parent", "other-real"]);
  const before = events(p).length;

  const add = await ok(p, ["add", "retry-payment", "--title", "Retry payment", "--parent", "checkout-flow"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const afterAdd = events(p);
  expect(afterAdd).toHaveLength(before + 1);
  const added = afterAdd[afterAdd.length - 1];
  expect(added?.type).toBe("node.proposed");
  expect(added?.payload.parent).toBe("checkout-flow");

  const ghost = await ok(p, ["show", "retry-payment"]);
  expect(ghost.out.split("\n")[0]).toContain("proposed");
  expect(ghost.out).toContain("parent: checkout-flow  Checkout flow");

  const acc = await ok(p, ["accept", "retry-payment", "--actor", "you"]);
  const afterAccept = events(p);
  expect(afterAccept).toHaveLength(afterAdd.length + 1);
  expect(afterAccept[afterAccept.length - 1]?.type).toBe("change.accepted");
  expect(acc.code).toBe(0);

  const real = await ok(p, ["show", "retry-payment"]);
  expect(real.out.split("\n")[0]).not.toContain("proposed");
  expect(real.out).toContain("parent: checkout-flow  Checkout flow");
  const other = await ok(p, ["show", "other-ghost"]);
  expect(other.out.split("\n")[0]).toContain("proposed");
});

test("04.2 accepting a ghost child accepts its ghost parent, and its held link goes live", async () => {
  const p = mapWith([
    { id: "payments", title: "Payments" },
    { id: "fraud-rules", title: "Fraud rules" },
  ]);
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, [
    "link",
    "partial-refunds",
    "fraud-rules",
    "--type",
    "depends_on",
    "--why",
    "A partial refund is checked by the fraud rules",
  ]);
  await ok(p, ["add", "full-only", "--kind", "option", "--title", "Full refunds only", "--why_not", "Too strict"]);
  await ok(p, ["link", "full-only", "partial-refunds", "--type", "alternative_to"]);
  await ok(p, [
    "add",
    "refund-study",
    "--kind",
    "source",
    "--title",
    "Refund study",
    "--url",
    "https://example.invalid/study",
    "--finding",
    "Most refunds are partial",
  ]);
  await ok(p, ["link", "partial-refunds", "refund-study", "--type", "supported_by"]);

  const held = await ok(p, ["show", "partial-refunds"]);
  const depLine = held.out.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules"));
  expect(depLine).toBeDefined();
  expect(depLine).toContain("held");

  const before = events(p).length;
  await ok(p, ["accept", "partial-refunds", "--actor", "you"]);
  const added = events(p).slice(before);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((e) => e.type === "change.accepted")).toBe(true);
  expect(added.some((e) => e.type.startsWith("edge."))).toBe(false);

  for (const id of ["refunds", "partial-refunds", "full-only", "refund-study"]) {
    const s = await ok(p, ["show", id]);
    expect(s.out.split("\n")[0]).not.toContain("proposed");
  }
  const live = await ok(p, ["show", "partial-refunds"]);
  const liveLine = live.out.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules"));
  expect(liveLine).toBeDefined();
  expect(liveLine).not.toContain("held");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = mapWith([{ id: "onboarding", title: "Onboarding" }]);
  await ok(p, ["add", "email-verification", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend-email", "--title", "Resend email", "--parent", "email-verification"]);
  await ok(p, ["discard", "email-verification"]);
  for (const id of ["email-verification", "resend-email"]) {
    const s = await p.werk(["show", id]);
    expect(s.code).not.toBe(0);
    expect(s.err).toContain("no node");
    expect(s.err).toContain("in the map");
  }
  const parent = await ok(p, ["show", "onboarding"]);
  expect(parent.out).not.toContain("ghost");
  expect(parent.out).not.toContain("email-verification");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = mapWith([{ id: "search", title: "Search" }]);
  await ok(p, ["add", "search-index", "--title", "Search index", "--why", "Queries need it", "--parent", "search"]);
  const before = events(p).length;
  const again = await p.werk([
    "add",
    "search-index",
    "--title",
    "A different index",
    "--why",
    "Other words",
    "--parent",
    "search",
  ]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("a ghost's words are frozen");
  expect(events(p)).toHaveLength(before);
  const s = await ok(p, ["show", "search-index"]);
  expect(s.out).toContain("Search index\n");
  expect(s.out).toContain("why: Queries need it");
  expect(s.out).not.toContain("A different index");
});

test("04.5 an accept from the command line needs the statement that the person asked for it", async () => {
  const p = mapWith([{ id: "compliance", title: "Compliance" }]);
  await ok(p, ["add", "audit-log", "--title", "Audit log", "--parent", "compliance"]);
  const before = events(p).length;
  const refused = await p.werk(["accept", "audit-log"]);
  expect(refused.code).not.toBe(0);
  expect(events(p)).toHaveLength(before);
  const ghost = await ok(p, ["show", "audit-log"]);
  expect(ghost.out.split("\n")[0]).toContain("proposed");
  const accepted = await p.werk(["accept", "audit-log", "--actor", "you"]);
  expect(accepted.code).toBe(0);
  const real = await ok(p, ["show", "audit-log"]);
  expect(real.out.split("\n")[0]).not.toContain("proposed");
});

import { expect, test } from "bun:test";
import { card, events, lines, ok, seeded } from "./helpers.ts";

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = seeded([card("checkout", "Checkout flow")]);
  await ok(p, ["add", "other-ghost", "--title", "Other ghost", "--parent", "checkout"]);
  const before = lines(p).length;
  const add = await ok(p, ["add", "retry-payment", "--title", "Retry payment", "--parent", "checkout"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = events(p);
  expect(after.length).toBe(before + 1);
  expect(after.at(-1)).toMatchObject({ type: "node.proposed", payload: { id: "retry-payment", parent: "checkout" } });
  const ghost = (await ok(p, ["show", "retry-payment"])).out;
  expect(ghost.split("\n")[0]).toContain("proposed");
  expect(ghost).toContain("parent: checkout  Checkout flow");
  const n = lines(p).length;
  await ok(p, ["accept", "retry-payment", "--actor", "you"]);
  const acc = events(p).slice(n);
  expect(acc.length).toBe(1);
  expect(acc[0]).toMatchObject({ type: "change.accepted", payload: { id: "retry-payment" } });
  const real = (await ok(p, ["show", "retry-payment"])).out;
  expect(real.split("\n")[0]).not.toContain("proposed");
  expect(real).toContain("parent: checkout  Checkout flow");
  expect((await ok(p, ["show", "other-ghost"])).out.split("\n")[0]).toContain("proposed");
});

test("04.2 accepting a ghost child also accepts its ghost parent, and its held link goes live", async () => {
  const p = seeded([card("payments", "Payments"), card("fraud-rules", "Fraud rules")]);
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial-refunds", "fraud-rules", "--type", "depends_on", "--why", "limits come from the rules"]);
  await ok(p, ["add", "partial-refunds:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "Too strict"]);
  await ok(p, ["link", "partial-refunds:opt0", "partial-refunds", "--type", "alternative_to"]);
  await ok(p, ["add", "refund-study", "--kind", "source", "--title", "Refund study", "--finding", "Partial is common"]);
  await ok(p, ["link", "partial-refunds", "refund-study", "--type", "supported_by"]);
  const held = (await ok(p, ["show", "partial-refunds"])).out;
  const depLine = held.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules")) ?? "";
  expect(depLine).toContain("held");
  const n = lines(p).length;
  await ok(p, ["accept", "partial-refunds", "--actor", "you"]);
  const added = events(p).slice(n);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((e) => e.type === "change.accepted")).toBe(true);
  for (const id of ["refunds", "partial-refunds", "partial-refunds:opt0", "refund-study"]) {
    expect((await ok(p, ["show", id])).out.split("\n")[0]).not.toContain("proposed");
  }
  const live = (await ok(p, ["show", "partial-refunds"])).out;
  const liveLine = live.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules")) ?? "";
  expect(liveLine).not.toBe("");
  expect(liveLine).not.toContain("held");
  expect(liveLine).not.toContain("ghost");
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
  const onb = (await ok(p, ["show", "onboarding"])).out;
  expect(onb).not.toContain("<- refines");
  expect(onb).not.toContain("ghost");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = seeded([card("search", "Search")]);
  await ok(p, ["add", "search-index", "--title", "Search index", "--why", "Fast lookup", "--parent", "search"]);
  const n = lines(p).length;
  const again = await p.werk(["add", "search-index", "--title", "Search index v2", "--why", "Other", "--parent", "search"]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("frozen");
  expect(lines(p).length).toBe(n);
  const show = (await ok(p, ["show", "search-index"])).out;
  expect(show).toContain("Search index\n");
  expect(show).not.toContain("Search index v2");
  expect(show).toContain("Fast lookup");
});

test("04.5 an accept from the command line needs the statement that the person asked for it", async () => {
  const p = seeded([card("ops", "Operations")]);
  await ok(p, ["add", "audit-log", "--title", "Audit log", "--parent", "ops"]);
  const n = lines(p).length;
  const bare = await p.werk(["accept", "audit-log"]);
  expect(bare.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect((await ok(p, ["show", "audit-log"])).out.split("\n")[0]).toContain("proposed");
  const yes = await p.werk(["accept", "audit-log", "--actor", "you"]);
  expect(yes.code).toBe(0);
  expect((await ok(p, ["show", "audit-log"])).out.split("\n")[0]).not.toContain("proposed");
});

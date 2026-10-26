// Scenarios 04.x: ghosts wait for the person's accept.
import { expect, test } from "bun:test";
import { card, events, lines, ok, withMap } from "./helpers.ts";

const header = (out: string) => out.split("\n")[0] as string;

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = withMap([card("checkout", "Checkout flow"), card("search", "Search")]);
  await ok(p, ["add", "other-ghost", "--title", "Search filters", "--parent", "search"]);
  const before = lines(p).length;
  const add = await ok(p, ["add", "retry-payment", "--title", "Retry payment", "--parent", "checkout"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = events(p);
  expect(after).toHaveLength(before + 1);
  expect(after.at(-1)).toMatchObject({ type: "node.proposed", payload: { id: "retry-payment", parent: "checkout" } });
  const ghost = await ok(p, ["show", "retry-payment"]);
  expect(header(ghost.out)).toContain("proposed");
  expect(ghost.out).toContain("parent: checkout  Checkout flow");

  const n = lines(p).length;
  await ok(p, ["accept", "retry-payment", "--actor", "you"]);
  const accepted = events(p);
  expect(accepted).toHaveLength(n + 1);
  expect(accepted.at(-1)).toMatchObject({ type: "change.accepted", payload: { id: "retry-payment" } });
  const real = await ok(p, ["show", "retry-payment"]);
  expect(header(real.out)).not.toContain("proposed");
  expect(real.out).toContain("parent: checkout  Checkout flow");
  expect(real.out).not.toContain("(held)");
  expect(header((await ok(p, ["show", "other-ghost"])).out)).toContain("proposed");
});

test("04.2 accepting a ghost child also accepts its ghost parent, and its held link goes live", async () => {
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
  await ok(p, ["add", "partial-refunds:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "Too rigid"]);
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
    "--finding",
    "Most refunds are partial",
  ]);
  await ok(p, ["link", "partial-refunds", "src-refund-policy", "--type", "supported_by"]);

  const held = await ok(p, ["show", "partial-refunds"]);
  const depLine = held.out.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules"));
  expect(depLine).toBeDefined();
  expect(depLine).toContain("held");

  const n = lines(p).length;
  await ok(p, ["accept", "partial-refunds", "--actor", "you"]);
  const added = events(p).slice(n);
  expect(added.length).toBeGreaterThan(0);
  for (const event of added) expect(event.type).toBe("change.accepted");

  for (const id of ["refunds", "partial-refunds", "partial-refunds:opt0", "src-refund-policy"]) {
    const out = (await ok(p, ["show", id])).out;
    expect(header(out)).not.toContain("proposed");
  }
  const live = await ok(p, ["show", "partial-refunds"]);
  const liveLine = live.out.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules"));
  expect(liveLine).toBeDefined();
  expect(liveLine).not.toContain("held");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = withMap([card("onboarding", "Onboarding")]);
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
  expect(onboarding).not.toContain("<- refines");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = withMap([card("search", "Search")]);
  await ok(p, ["add", "search-index", "--title", "One index per tenant", "--why", "Tenants never share", "--parent", "search"]);
  const n = lines(p).length;
  const again = await p.werk(["add", "search-index", "--title", "One shared index", "--why", "Cheaper", "--parent", "search"]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("a ghost's words are frozen");
  expect(lines(p)).toHaveLength(n);
  const show = (await ok(p, ["show", "search-index"])).out;
  expect(show).toContain("One index per tenant");
  expect(show).toContain("why: Tenants never share");
  expect(show).not.toContain("One shared index");
});

test("04.5 an accept from the command line needs the statement that the person asked for it", async () => {
  const p = withMap([card("compliance", "Compliance")]);
  await ok(p, ["add", "audit-log", "--title", "Audit log", "--parent", "compliance"]);
  const n = lines(p).length;
  const refused = await p.werk(["accept", "audit-log"]);
  expect(refused.code).not.toBe(0);
  expect(lines(p)).toHaveLength(n);
  expect(header((await ok(p, ["show", "audit-log"])).out)).toContain("proposed");
  const accepted = await p.werk(["accept", "audit-log", "--actor", "you"]);
  expect(accepted.code).toBe(0);
  expect(header((await ok(p, ["show", "audit-log"])).out)).not.toContain("proposed");
});

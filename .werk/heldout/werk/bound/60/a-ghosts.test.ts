import { expect, test } from "bun:test";
import { card, map } from "./a-helpers.ts";

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const m = map();
  card(m, "checkout-flow", "Checkout flow", "root", { status: "decided" });
  // another ghost elsewhere
  await m.w("add", "other-ghost", "--title", "Other ghost", "--parent", "root");
  const before = m.events().length;
  const add = await m.w("add", "retry-payment", "--title", "Retry payment", "--why", "w", "--parent", "checkout-flow");
  expect(add.code).toBe(0);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = m.events();
  expect(after.length).toBe(before + 1);
  expect(after.at(-1)?.type).toBe("node.proposed");
  expect(after.at(-1)?.payload.parent).toBe("checkout-flow");
  const show = await m.w("show", "retry-payment");
  expect(show.out.split("\n")[0]).toContain("proposed");
  expect(show.out).toContain("parent: checkout-flow");
  const acc = await m.w("accept", "retry-payment", "--actor", "you");
  expect(acc.code).toBe(0);
  expect(m.events().length).toBe(before + 2);
  expect(m.events().at(-1)?.type).toBe("change.accepted");
  const real = await m.w("show", "retry-payment");
  expect(real.out.split("\n")[0]).not.toContain("proposed");
  expect(real.out).toContain("parent: checkout-flow");
  expect(real.out).not.toContain("(held)");
  const other = await m.w("show", "other-ghost");
  expect(other.out.split("\n")[0]).toContain("proposed");
});

test("04.2 accepting a ghost child accepts its ghost parent; held link goes live", async () => {
  const m = map();
  card(m, "payments", "Payments");
  card(m, "fraud-rules", "Fraud rules");
  expect((await m.w("add", "refunds", "--title", "Refunds", "--parent", "payments")).code).toBe(0);
  expect((await m.w("add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds")).code).toBe(0);
  expect(
    (await m.w("link", "partial-refunds", "fraud-rules", "--type", "depends_on", "--why", "uses the fraud limits")).code,
  ).toBe(0);
  expect((await m.w("add", "partial-refunds:opt0", "--kind", "option", "--title", "Full only", "--why_not", "too strict")).code).toBe(0);
  expect((await m.w("link", "partial-refunds:opt0", "partial-refunds", "--type", "alternative_to")).code).toBe(0);
  expect((await m.w("add", "src-pr", "--kind", "source", "--title", "Refund study", "--finding", "partials common")).code).toBe(0);
  expect((await m.w("link", "partial-refunds", "src-pr", "--type", "supported_by")).code).toBe(0);
  const held = await m.w("show", "partial-refunds");
  const depLine = held.out.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules"));
  expect(depLine).toContain("(held)");
  const before = m.events().length;
  const acc = await m.w("accept", "partial-refunds", "--actor", "you");
  expect(acc.code).toBe(0);
  const added = m.events().slice(before);
  expect(added.length).toBeGreaterThan(0);
  for (const e of added) expect(e.type).toBe("change.accepted");
  expect((await m.w("show", "refunds")).out.split("\n")[0]).not.toContain("proposed");
  const pr = await m.w("show", "partial-refunds");
  expect(pr.out.split("\n")[0]).not.toContain("proposed");
  expect((await m.w("show", "partial-refunds:opt0")).out.split("\n")[0]).not.toContain("proposed");
  expect((await m.w("show", "src-pr")).out.split("\n")[0]).not.toContain("proposed");
  const live = pr.out.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules"));
  expect(live).toBeDefined();
  expect(live).not.toContain("(held)");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const m = map();
  card(m, "onboarding", "Onboarding");
  await m.w("add", "email-verification", "--title", "Email verification", "--parent", "onboarding");
  await m.w("add", "resend-email", "--title", "Resend email", "--parent", "email-verification");
  expect((await m.w("discard", "email-verification")).code).toBe(0);
  const a = await m.w("show", "email-verification");
  const b = await m.w("show", "resend-email");
  expect(a.code).not.toBe(0);
  expect(a.err).toContain("no node");
  expect(b.code).not.toBe(0);
  expect(b.err).toContain("no node");
  const o = await m.w("show", "onboarding");
  expect(o.out).not.toContain("<- refines");
});

test("04.4 the words of a ghost are frozen", async () => {
  const m = map();
  card(m, "search", "Search");
  await m.w("add", "search-index", "--title", "Search index", "--why", "first why", "--parent", "search");
  const before = m.events().length;
  const again = await m.w("add", "search-index", "--title", "Other title", "--why", "other why", "--parent", "search");
  expect(again.code).not.toBe(0);
  expect((again.err + again.out).toLowerCase()).toMatch(/frozen/);
  expect(m.events().length).toBe(before);
  const show = await m.w("show", "search-index");
  expect(show.out).toContain("Search index");
  expect(show.out).toContain("why: first why");
});

test("04.5 an accept from the command line needs --actor you", async () => {
  const m = map();
  card(m, "compliance", "Compliance");
  await m.w("add", "audit-log", "--title", "Audit log", "--parent", "compliance");
  const before = m.events().length;
  const no = await m.w("accept", "audit-log");
  expect(no.code).not.toBe(0);
  expect(m.events().length).toBe(before);
  expect((await m.w("show", "audit-log")).out.split("\n")[0]).toContain("proposed");
  const yes = await m.w("accept", "audit-log", "--actor", "you");
  expect(yes.code).toBe(0);
  expect((await m.w("show", "audit-log")).out.split("\n")[0]).not.toContain("proposed");
});

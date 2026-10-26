import { expect, test } from "bun:test";
import { card, events, head, lines, ok, w, withRoot } from "./helpers.ts";

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = withRoot();
  card(p, "checkout", "Checkout flow");
  await ok(p, "add", "other", "--title", "Some other ghost");
  const before = lines(p).length;
  const add = await ok(p, "add", "retry", "--title", "Retry payment", "--parent", "checkout");
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = events(p);
  expect(after).toHaveLength(before + 1);
  expect(after.at(-1)).toMatchObject({ type: "node.proposed", payload: { id: "retry", parent: "checkout" } });
  const ghost = (await ok(p, "show", "retry")).out;
  expect(ghost.split("\n")[0]).toContain("proposed");
  expect(ghost).toContain("parent: checkout  Checkout flow");

  await ok(p, "accept", "retry", "--actor", "you");
  const accepted = events(p);
  expect(accepted).toHaveLength(before + 2);
  expect(accepted.at(-1)).toMatchObject({ type: "change.accepted", payload: { id: "retry" } });
  const real = (await ok(p, "show", "retry")).out;
  expect(real.split("\n")[0]).not.toContain("proposed");
  expect(real).toContain("parent: checkout  Checkout flow");
  expect(await head(p, "other")).toContain("proposed");
});

test("04.2 accepting a ghost child accepts its ghost parent, and its held link goes live", async () => {
  const p = withRoot();
  card(p, "payments", "Payments");
  card(p, "fraud", "Fraud rules");
  await ok(p, "add", "refunds", "--title", "Refunds", "--parent", "payments");
  await ok(p, "add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await ok(p, "link", "partial", "fraud", "--type", "depends_on", "--why", "partial refunds obey the fraud limits");
  await ok(p, "add", "partial:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "too strict");
  await ok(p, "link", "partial:opt0", "partial", "--type", "alternative_to");
  await ok(p, "add", "refund-study", "--kind", "source", "--title", "Refund study", "--finding", "most are partial");
  await ok(p, "link", "partial", "refund-study", "--type", "supported_by");
  const held = (await ok(p, "show", "partial")).out;
  expect(held).toMatch(/-> depends_on +fraud {2}Fraud rules {2}\(held\)/);

  const before = lines(p).length;
  await ok(p, "accept", "partial", "--actor", "you");
  const added = events(p).slice(before);
  expect(added.length).toBeGreaterThan(0);
  for (const e of added) expect(e.type).toBe("change.accepted");
  expect(await head(p, "refunds")).not.toContain("proposed");
  expect(await head(p, "partial")).not.toContain("proposed");
  expect(await head(p, "partial:opt0")).not.toContain("proposed");
  expect(await head(p, "refund-study")).not.toContain("proposed");
  const live = (await ok(p, "show", "partial")).out;
  expect(live).toMatch(/-> depends_on +fraud {2}Fraud rules\n/);
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = withRoot();
  card(p, "onboarding", "Onboarding");
  await ok(p, "add", "email", "--title", "Email verification", "--parent", "onboarding");
  await ok(p, "add", "resend", "--title", "Resend email", "--parent", "email");
  await ok(p, "discard", "email");
  for (const id of ["email", "resend"]) {
    const run = await w(p, "show", id);
    expect(run.code).not.toBe(0);
    expect(run.err).toContain("no node");
    expect(run.err).toContain("in the map");
  }
  const onboarding = (await ok(p, "show", "onboarding")).out;
  expect(onboarding).not.toContain("ghost");
  expect(onboarding).not.toContain("<- refines");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = withRoot();
  card(p, "search", "Search");
  await ok(p, "add", "search-index", "--title", "Search index", "--why", "lookups must be fast", "--parent", "search");
  const before = lines(p);
  const again = await w(p, "add", "search-index", "--title", "Index of search", "--why", "other words");
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("frozen");
  expect(lines(p)).toEqual(before);
  const show = (await ok(p, "show", "search-index")).out;
  expect(show).toContain("Search index");
  expect(show).toContain("why: lookups must be fast");
});

test("04.5 an accept from the command line needs the person's statement", async () => {
  const p = withRoot();
  card(p, "ops", "Operations");
  await ok(p, "add", "audit", "--title", "Audit log", "--parent", "ops");
  const before = lines(p);
  const refused = await w(p, "accept", "audit");
  expect(refused.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect(await head(p, "audit")).toContain("proposed");
  const accepted = await w(p, "accept", "audit", "--actor", "you");
  expect(accepted.code).toBe(0);
  expect(await head(p, "audit")).not.toContain("proposed");
});

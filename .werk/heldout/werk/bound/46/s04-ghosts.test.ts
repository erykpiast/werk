// Scenarios 04.1 - 04.5: ghosts, accept, discard, frozen words.
import { expect, test } from "bun:test";
import { freshProject, lines, real, seed } from "./helpers.ts";

const headerOf = (out: string) => out.split("\n")[0] ?? "";

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = freshProject();
  seed(p, [real("checkout-flow", "Checkout flow")]);
  // another ghost already in the map
  expect((await p.werk(["add", "other-ghost", "--title", "Other ghost"])).code).toBe(0);
  const before = lines(p).length;

  const add = await p.werk(["add", "retry-payment", "--title", "Retry payment", "--parent", "checkout-flow"]);
  expect(add.code).toBe(0);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = lines(p);
  expect(after.length).toBe(before + 1);
  expect(after.at(-1)?.type).toBe("node.proposed");
  expect(after.at(-1)?.payload.parent).toBe("checkout-flow");

  const show = await p.werk(["show", "retry-payment"]);
  expect(show.code).toBe(0);
  expect(headerOf(show.out)).toContain("proposed");
  expect(show.out).toContain("parent: checkout-flow");

  const n = lines(p).length;
  const accept = await p.werk(["accept", "retry-payment", "--actor", "you"]);
  expect(accept.code).toBe(0);
  const accepted = lines(p);
  expect(accepted.length).toBe(n + 1);
  expect(accepted.at(-1)?.type).toBe("change.accepted");

  const shown = await p.werk(["show", "retry-payment"]);
  expect(headerOf(shown.out)).not.toContain("proposed");
  expect(shown.out).toContain("parent: checkout-flow");
  expect(headerOf((await p.werk(["show", "other-ghost"])).out)).toContain("proposed");
});

test("04.2 accepting a ghost child accepts its ghost parent; its held link goes live with no further event", async () => {
  const p = freshProject();
  seed(p, [real("payments", "Payments"), real("fraud-rules", "Fraud rules")]);
  const ok = async (args: string[]) => {
    const run = await p.werk(args);
    if (run.code !== 0) throw new Error(`werk ${args.join(" ")}: ${run.err}`);
    return run;
  };
  await ok(["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(["add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(["link", "partial-refunds", "fraud-rules", "--type", "depends_on", "--why", "the fraud limits"]);
  await ok(["add", "partial-refunds:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "too strict"]);
  await ok(["link", "partial-refunds:opt0", "partial-refunds", "--type", "alternative_to"]);
  await ok(["add", "refund-law", "--kind", "source", "--title", "Refund law", "--url", "https://example.com"]);
  await ok(["link", "partial-refunds", "refund-law", "--type", "supported_by"]);

  const held = (await ok(["show", "partial-refunds"])).out;
  const depLine = held.split("\n").find((line) => line.includes("depends_on") && line.includes("fraud-rules"));
  expect(depLine).toBeDefined();
  expect(depLine).toContain("held");

  const n = lines(p).length;
  await ok(["accept", "partial-refunds", "--actor", "you"]);
  const added = lines(p).slice(n);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((event) => event.type === "change.accepted")).toBe(true);

  for (const id of ["refunds", "partial-refunds", "partial-refunds:opt0", "refund-law"]) {
    expect(headerOf((await ok(["show", id])).out)).not.toContain("proposed");
  }
  const live = (await ok(["show", "partial-refunds"])).out;
  const liveLine = live.split("\n").find((line) => line.includes("depends_on") && line.includes("fraud-rules"));
  expect(liveLine).toBeDefined();
  expect(liveLine).not.toContain("held");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = freshProject();
  seed(p, [real("onboarding", "Onboarding")]);
  expect((await p.werk(["add", "email-verification", "--title", "Email verification", "--parent", "onboarding"])).code).toBe(0);
  expect((await p.werk(["add", "resend-email", "--title", "Resend email", "--parent", "email-verification"])).code).toBe(0);
  expect((await p.werk(["discard", "email-verification"])).code).toBe(0);
  for (const id of ["email-verification", "resend-email"]) {
    const show = await p.werk(["show", id]);
    expect(show.code).toBe(1);
    expect(show.err).toContain("no node");
  }
  const onboarding = await p.werk(["show", "onboarding"]);
  expect(onboarding.out).not.toContain("ghost");
  expect(onboarding.out).not.toContain("email-verification");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = freshProject();
  seed(p, [real("search", "Search")]);
  expect(
    (await p.werk(["add", "search-index", "--title", "Search index", "--why", "Fast lookup", "--parent", "search"])).code,
  ).toBe(0);
  const n = lines(p).length;
  const again = await p.werk(["add", "search-index", "--title", "Another index", "--why", "Other words", "--parent", "search"]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("a ghost's words are frozen");
  expect(lines(p).length).toBe(n);
  const show = await p.werk(["show", "search-index"]);
  expect(show.out).toContain("Search index");
  expect(show.out).toContain("why: Fast lookup");
  expect(show.out).not.toContain("Another index");
});

test("04.5 an accept from the command line needs the statement that the person asked for it", async () => {
  const p = freshProject();
  seed(p, [real("platform", "Platform")]);
  expect((await p.werk(["add", "audit-log", "--title", "Audit log", "--parent", "platform"])).code).toBe(0);
  const n = lines(p).length;
  const refused = await p.werk(["accept", "audit-log"]);
  expect(refused.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect(headerOf((await p.werk(["show", "audit-log"])).out)).toContain("proposed");
  const accepted = await p.werk(["accept", "audit-log", "--actor", "you"]);
  expect(accepted.code).toBe(0);
  expect(headerOf((await p.werk(["show", "audit-log"])).out)).not.toContain("proposed");
});

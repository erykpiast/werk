// Held-out steps 04.x: ghosts, accept, discard, frozen words.
import { expect, test } from "bun:test";
import { card, project } from "./helpers.ts";

const header = (out: string) => out.split("\n")[0] as string;

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = project();
  p.seed(card("checkout", "Checkout flow"));
  await p.ok("add", "other-ghost", "--title", "Another ghost", "--parent", "checkout");
  const before = p.lines().length;
  const added = await p.ok(
    "add",
    "retry",
    "--title",
    "Retry payment",
    "--why",
    "A card fails often",
    "--parent",
    "checkout",
  );
  expect(added).toContain("proposed");
  expect(added).not.toContain("added");
  const after = p.lines();
  expect(after.length).toBe(before + 1);
  const event = after.at(-1);
  expect(event?.type).toBe("node.proposed");
  expect(event?.payload.parent).toBe("checkout");

  const shown = await p.ok("show", "retry");
  expect(header(shown)).toContain("proposed");
  expect(shown).toMatch(/parent: checkout\s+Checkout flow/);

  const n = p.lines().length;
  await p.ok("accept", "retry", "--actor", "you");
  const accepted = p.lines();
  expect(accepted.length).toBe(n + 1);
  expect(accepted.at(-1)?.type).toBe("change.accepted");
  const real = await p.ok("show", "retry");
  expect(header(real)).not.toContain("proposed");
  expect(real).toMatch(/parent: checkout\s+Checkout flow/);
  expect(real).toMatch(/-> refines\s+checkout\s+Checkout flow\s*$/m);
  expect(header(await p.ok("show", "other-ghost"))).toContain("proposed");
});

test("04.2 accepting a ghost child also accepts its ghost parent, and its held link goes live", async () => {
  const p = project();
  p.seed(card("payments", "Payments"), card("fraud-rules", "Fraud rules"));
  await p.ok("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.ok("add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds");
  await p.ok(
    "link",
    "partial-refunds",
    "fraud-rules",
    "--type",
    "depends_on",
    "--why",
    "a partial refund passes the fraud rules",
  );
  await p.ok(
    "add",
    "partial-refunds:opt0",
    "--kind",
    "option",
    "--title",
    "Only full refunds",
    "--why_not",
    "Customers ask for part",
  );
  await p.ok("link", "partial-refunds:opt0", "partial-refunds", "--type", "alternative_to");
  await p.ok(
    "add",
    "src-policy",
    "--kind",
    "source",
    "--title",
    "Refund policy",
    "--finding",
    "Part refunds are common",
  );
  await p.ok("link", "partial-refunds", "src-policy", "--type", "supported_by");

  const held = await p.ok("show", "partial-refunds");
  expect(held).toMatch(/-> depends_on\s+fraud-rules\s+Fraud rules\s+\(held\)/);

  const n = p.lines().length;
  await p.ok("accept", "partial-refunds", "--actor", "you");
  const fresh = p.lines().slice(n);
  expect(fresh.length).toBeGreaterThan(0);
  expect(fresh.every((event) => event.type === "change.accepted")).toBe(true);
  expect(fresh.some((event) => event.type.startsWith("edge."))).toBe(false);

  expect(header(await p.ok("show", "refunds"))).not.toContain("proposed");
  const live = await p.ok("show", "partial-refunds");
  expect(header(live)).not.toContain("proposed");
  expect(header(await p.ok("show", "partial-refunds:opt0"))).not.toContain("proposed");
  expect(header(await p.ok("show", "src-policy"))).not.toContain("proposed");
  expect(live).toMatch(/-> depends_on\s+fraud-rules\s+Fraud rules\s*$/m);
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = project();
  p.seed(card("onboarding", "Onboarding"));
  await p.ok("add", "email-verification", "--title", "Email verification", "--parent", "onboarding");
  await p.ok("add", "resend-email", "--title", "Resend email", "--parent", "email-verification");
  await p.ok("discard", "email-verification");
  for (const id of ["email-verification", "resend-email"]) {
    const run = await p.werk(["show", id]);
    expect(run.code).not.toBe(0);
    expect(run.err).toMatch(/no node|not in the map/);
  }
  const shown = await p.ok("show", "onboarding");
  expect(shown).not.toMatch(/<- refines/);
  expect(shown).not.toContain("ghost");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = project();
  p.seed(card("search", "Search"));
  await p.ok(
    "add",
    "search-index",
    "--title",
    "Search uses one index",
    "--why",
    "One index is simple",
    "--parent",
    "search",
  );
  const n = p.lines().length;
  const again = await p.werk([
    "add",
    "search-index",
    "--title",
    "Search uses two indexes",
    "--why",
    "Two scale",
    "--parent",
    "search",
  ]);
  expect(again.code).not.toBe(0);
  expect(p.lines().length).toBe(n);
  const shown = await p.ok("show", "search-index");
  expect(shown).toContain("Search uses one index");
  expect(shown).toContain("why: One index is simple");
  // The refusal names the rule that the words of a ghost are frozen.
  expect(`${again.err}${again.out}`).toMatch(/frozen/i);
});

test("04.5 an accept from the command line needs the statement that the person asked for it", async () => {
  const p = project();
  p.seed(card("compliance", "Compliance"));
  await p.ok("add", "audit-log", "--title", "Audit log", "--parent", "compliance");
  const n = p.lines().length;
  const refused = await p.werk(["accept", "audit-log"]);
  expect(refused.code).not.toBe(0);
  expect(p.lines().length).toBe(n);
  expect(header(await p.ok("show", "audit-log"))).toContain("proposed");
  await p.ok("accept", "audit-log", "--actor", "you");
  expect(header(await p.ok("show", "audit-log"))).not.toContain("proposed");
});

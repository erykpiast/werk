// Held-out steps 04.x: ghosts, accept, discard and frozen words at the command line.
import { expect, setDefaultTimeout, test } from "bun:test";
setDefaultTimeout(120_000);
import { head, project } from "./b-helpers.ts";

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = project();
  p.real("root", "Root");
  p.real("checkout", "Checkout flow", "root");
  p.real("other", "Other", "root");
  await p.ok("add", "ghost-other", "--title", "Another ghost", "--parent", "other");
  const before = p.log().length;
  const add = await p.ok("add", "retry", "--title", "Retry payment", "--parent", "checkout");
  expect(add).toContain("proposed");
  expect(add).not.toContain("added");
  const evs = p.events().slice(before);
  expect(evs).toHaveLength(1);
  expect(evs[0]?.type).toBe("node.proposed");
  expect(evs[0]?.payload.parent).toBe("checkout");
  const show = await p.ok("show", "retry");
  expect(head(show)).toContain("proposed");
  expect(show).toContain("parent: checkout  Checkout flow");

  const n = p.log().length;
  await p.ok("accept", "retry", "--actor", "you");
  const acc = p.events().slice(n);
  expect(acc).toHaveLength(1);
  expect(acc[0]?.type).toMatch(/accept/);
  const after = await p.ok("show", "retry");
  expect(head(after)).not.toContain("proposed");
  expect(after).toContain("parent: checkout  Checkout flow");
  expect(head(await p.ok("show", "ghost-other"))).toContain("proposed");
});

test("04.2 accepting a ghost child accepts its ghost parent; its held link goes live with no further event", async () => {
  const p = project();
  p.real("root", "Root");
  p.real("payments", "Payments", "root");
  p.real("fraud", "Fraud rules", "root");
  await p.ok("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.ok("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await p.ok("link", "partial", "fraud", "--type", "depends_on", "--why", "a refund passes the fraud rules");
  await p.ok("add", "partial:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "too strict");
  await p.ok("link", "partial:opt0", "partial", "--type", "alternative_to");
  await p.ok("add", "src-refund", "--kind", "source", "--title", "Refund study", "--finding", "most refunds are partial");
  await p.ok("link", "partial", "src-refund", "--type", "supported_by");
  const held = await p.ok("show", "partial");
  const dep = held.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud")) ?? "";
  expect(dep).toContain("held");

  const n = p.log().length;
  await p.ok("accept", "partial", "--actor", "you");
  const evs = p.events().slice(n);
  expect(evs.length).toBeGreaterThan(0);
  for (const e of evs) expect(e.type).toMatch(/accept/);
  expect(evs.some((e) => e.type.startsWith("link"))).toBe(false);
  expect(head(await p.ok("show", "refunds"))).not.toContain("proposed");
  const after = await p.ok("show", "partial");
  expect(head(after)).not.toContain("proposed");
  expect(head(await p.ok("show", "partial:opt0"))).not.toContain("proposed");
  expect(head(await p.ok("show", "src-refund"))).not.toContain("proposed");
  const live = after.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud")) ?? "";
  expect(live).not.toBe("");
  expect(live).not.toContain("held");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = project();
  p.real("root", "Root");
  p.real("onboarding", "Onboarding", "root");
  await p.ok("add", "email-verification", "--title", "Email verification", "--parent", "onboarding");
  await p.ok("add", "resend-email", "--title", "Resend email", "--parent", "email-verification");
  await p.ok("discard", "email-verification");
  const a = await p.w("show", "email-verification");
  const b = await p.w("show", "resend-email");
  expect(a.code).not.toBe(0);
  expect(a.err).toMatch(/no node #[a-z-]+ in the map/);
  expect(b.code).not.toBe(0);
  expect(b.err).toMatch(/no node #[a-z-]+ in the map/);
  const o = await p.ok("show", "onboarding");
  expect(o).not.toContain("ghost");
  expect(o).not.toContain("email-verification");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = project();
  p.real("root", "Root");
  p.real("search", "Search", "root");
  await p.ok("add", "search-index", "--title", "Search index", "--why", "Queries must be fast", "--parent", "search");
  const n = p.log().length;
  const again = await p.w("add", "search-index", "--title", "Another index", "--why", "Different", "--parent", "search");
  expect(again.code).not.toBe(0);
  expect(again.err).toMatch(/ghost's words are frozen/);
  expect(p.log().length).toBe(n);
  const show = await p.ok("show", "search-index");
  expect(show).toContain("Search index");
  expect(show).toContain("why: Queries must be fast");
});

test("04.5 an accept from the command line needs the statement that the person asked for it", async () => {
  const p = project();
  p.real("root", "Root");
  p.real("compliance", "Compliance", "root");
  await p.ok("add", "audit-log", "--title", "Audit log", "--parent", "compliance");
  const n = p.log().length;
  const bare = await p.w("accept", "audit-log");
  expect(bare.code).not.toBe(0);
  expect(p.log().length).toBe(n);
  expect(head(await p.ok("show", "audit-log"))).toContain("proposed");
  const yes = await p.w("accept", "audit-log", "--actor", "you");
  expect(yes.code).toBe(0);
  expect(head(await p.ok("show", "audit-log"))).not.toContain("proposed");
});

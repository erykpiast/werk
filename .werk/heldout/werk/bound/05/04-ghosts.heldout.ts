import { afterEach, expect, test } from "bun:test";
import { project } from "./harness";

let p: ReturnType<typeof project>;
afterEach(() => p?.remove());

async function ok(args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}
const header = (out: string) => out.split("\n")[0] ?? "";

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  p = project();
  p.real("checkout-flow", "Checkout flow");
  // Another ghost in the map, to check that it stays a ghost.
  await ok(["add", "other-ghost", "--title", "Other ghost", "--parent", "checkout-flow"]);
  const before = p.lines().length;
  const add = await ok(["add", "retry-payment", "--title", "Retry payment", "--parent", "checkout-flow"]);
  console.log("add out:", JSON.stringify(add.out));
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = p.lines();
  expect(after.length).toBe(before + 1);
  const ev = after.at(-1);
  expect(ev.type).toBe("node.proposed");
  expect(ev.payload.parent).toBe("checkout-flow");
  const show = await ok(["show", "retry-payment"]);
  console.log("show ghost:", show.out);
  expect(header(show.out)).toContain("proposed");
  expect(show.out).toContain("parent: checkout-flow  Checkout flow");

  const n = p.lines().length;
  await ok(["accept", "retry-payment", "--actor", "you"]);
  const acc = p.lines().slice(n);
  expect(acc.length).toBe(1);
  expect(acc[0].type).toBe("change.accepted");
  const real = await ok(["show", "retry-payment"]);
  console.log("show real:", real.out);
  expect(header(real.out)).not.toContain("proposed");
  expect(real.out).toContain("parent: checkout-flow  Checkout flow");
  const other = await ok(["show", "other-ghost"]);
  expect(header(other.out)).toContain("proposed");
});

test("04.2 accepting a ghost child also accepts its ghost parent, and its held link goes live", async () => {
  p = project();
  p.real("payments", "Payments");
  p.real("fraud-rules", "Fraud rules");
  await ok(["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(["add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(["link", "partial-refunds", "fraud-rules", "--type", "depends_on", "--why", "It reads the fraud thresholds"]);
  await ok(["add", "partial-refunds:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "Too coarse"]);
  await ok(["link", "partial-refunds:opt0", "partial-refunds", "--type", "alternative_to"]);
  await ok(["add", "refund-study", "--kind", "source", "--title", "Refund study", "--finding", "Half of refunds are partial"]);
  await ok(["link", "partial-refunds", "refund-study", "--type", "supported_by"]);
  const held = await ok(["show", "partial-refunds"]);
  console.log("before accept:", held.out);
  const depLine = (out: string) => out.split("\n").find((l) => l.includes("depends_on")) ?? "";
  expect(depLine(held.out)).toContain("held");

  const n = p.lines().length;
  const accept = await ok(["accept", "partial-refunds", "--actor", "you"]);
  console.log("accept out:", accept.out);
  const events = p.lines().slice(n);
  console.log("events:", events.map((e) => `${e.type}:${e.payload.id ?? ""}`).join(", "));
  expect(events.length).toBeGreaterThan(0);
  for (const e of events) expect(e.type).toBe("change.accepted");

  for (const id of ["refunds", "partial-refunds", "partial-refunds:opt0", "refund-study"]) {
    const s = await ok(["show", id]);
    expect(header(s.out)).not.toContain("proposed");
  }
  const live = await ok(["show", "partial-refunds"]);
  console.log("after accept:", live.out);
  expect(depLine(live.out)).toContain("fraud-rules");
  expect(depLine(live.out)).not.toContain("held");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  p = project();
  p.real("onboarding", "Onboarding");
  await ok(["add", "email-verification", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(["add", "resend-email", "--title", "Resend email", "--parent", "email-verification"]);
  await ok(["discard", "email-verification"]);
  for (const id of ["email-verification", "resend-email"]) {
    const s = await p.werk(["show", id]);
    console.log(id, s.code, s.err);
    expect(s.code).not.toBe(0);
    expect(s.err).toContain("no node");
  }
  const on = await ok(["show", "onboarding"]);
  console.log("onboarding:", on.out);
  expect(on.out).not.toContain("ghost");
  expect(on.out).not.toContain("<- refines");
});

test("04.4 the words of a ghost are frozen", async () => {
  p = project();
  p.real("search", "Search");
  await ok(["add", "search-index", "--title", "Search index", "--why", "Queries need an index", "--parent", "search"]);
  const n = p.lines().length;
  const again = await p.werk([
    "add", "search-index", "--title", "A different index", "--why", "Different words", "--parent", "search",
  ]);
  console.log("again:", again.code, again.err);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("frozen");
  expect(p.lines().length).toBe(n);
  const s = await ok(["show", "search-index"]);
  console.log("show:", s.out);
  expect(s.out).toContain("Search index");
  expect(s.out).toContain("Queries need an index");
  expect(s.out).not.toContain("A different index");
});

test("04.5 an accept from the command line needs --actor you", async () => {
  p = project();
  p.real("compliance", "Compliance");
  await ok(["add", "audit-log", "--title", "Audit log", "--parent", "compliance"]);
  const n = p.lines().length;
  const bare = await p.werk(["accept", "audit-log"]);
  console.log("bare:", bare.code, bare.err);
  expect(bare.code).not.toBe(0);
  expect(p.lines().length).toBe(n);
  expect(header((await ok(["show", "audit-log"])).out)).toContain("proposed");
  const yes = await p.werk(["accept", "audit-log", "--actor", "you"]);
  expect(yes.code).toBe(0);
  expect(header((await ok(["show", "audit-log"])).out)).not.toContain("proposed");
});

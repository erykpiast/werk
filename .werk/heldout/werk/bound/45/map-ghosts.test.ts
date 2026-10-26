// Held-out user paths 04.1 to 04.5: ghosts at the command line.
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const events = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l));

let seq = 0;
function withReal(cards: [string, string][]): Project {
  const p = freshProject();
  seq = 0;
  for (const [id, title] of cards) {
    seq++;
    appendFileSync(
      logOf(p),
      `${JSON.stringify({ seq, at: "t", actor: "you", type: "node.added", payload: { id, kind: "card", title } })}\n`,
    );
  }
  return p;
}

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = withReal([["checkout-flow", "Checkout flow"]]);
  // A second ghost, so "every other ghost" has something to check.
  await ok(p, ["add", "saved-cards", "--title", "Saved cards", "--parent", "checkout-flow"]);
  const before = events(p).length;
  const add = await ok(p, ["add", "retry-payment", "--title", "Retry payment", "--parent", "checkout-flow"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = events(p);
  expect(after.length).toBe(before + 1);
  expect(after.at(-1)).toMatchObject({ type: "node.proposed", payload: { id: "retry-payment", parent: "checkout-flow" } });
  const show = await ok(p, ["show", "retry-payment"]);
  expect(show.out).toContain("proposed");
  expect(show.out).toContain("parent: checkout-flow  Checkout flow");

  const n = events(p).length;
  await ok(p, ["accept", "retry-payment", "--actor", "you"]);
  const accepted = events(p).slice(n);
  expect(accepted).toHaveLength(1);
  expect(accepted[0]).toMatchObject({ type: "change.accepted", payload: { id: "retry-payment" } });
  const real = await ok(p, ["show", "retry-payment"]);
  expect(real.out.split("\n")[0]).not.toContain("proposed");
  expect(real.out).toContain("parent: checkout-flow  Checkout flow");
  const other = await ok(p, ["show", "saved-cards"]);
  expect(other.out.split("\n")[0]).toContain("proposed");
});

test("04.2 accepting a ghost child accepts its ghost parent, and its held link goes live", async () => {
  const p = withReal([
    ["payments", "Payments"],
    ["fraud-rules", "Fraud rules"],
  ]);
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial-refunds", "fraud-rules", "--type", "depends_on", "--why", "A refund checks the fraud rules"]);
  await ok(p, ["add", "refund-to-credit", "--kind", "option", "--title", "Refund to store credit", "--why_not", "Users want cash"]);
  await ok(p, ["link", "refund-to-credit", "partial-refunds", "--type", "alternative_to"]);
  await ok(p, ["add", "refund-study", "--kind", "source", "--title", "Refund study", "--url", "https://example.com/study"]);
  await ok(p, ["link", "partial-refunds", "refund-study", "--type", "supported_by"]);

  const held = await ok(p, ["show", "partial-refunds"]);
  const heldLine = held.out.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules"));
  expect(heldLine).toBeDefined();
  expect(heldLine).toContain("held");

  const n = events(p).length;
  await ok(p, ["accept", "partial-refunds", "--actor", "you"]);
  const added = events(p).slice(n);
  expect(added.length).toBeGreaterThan(0);
  for (const e of added) expect(e.type).toBe("change.accepted");
  expect(added.map((e) => e.payload.id).sort()).toEqual(["partial-refunds", "refund-study", "refund-to-credit", "refunds"]);

  for (const id of ["refunds", "partial-refunds", "refund-to-credit", "refund-study"]) {
    const s = await ok(p, ["show", id]);
    expect(s.out.split("\n")[0]).not.toContain("proposed");
  }
  const live = await ok(p, ["show", "partial-refunds"]);
  const liveLine = live.out.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules"));
  expect(liveLine).toBeDefined();
  expect(liveLine).not.toContain("held");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = withReal([["onboarding", "Onboarding"]]);
  await ok(p, ["add", "email-verification", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend-email", "--title", "Resend email", "--parent", "email-verification"]);
  await ok(p, ["discard", "email-verification"]);
  for (const id of ["email-verification", "resend-email"]) {
    const s = await p.werk(["show", id]);
    expect(s.code).not.toBe(0);
    expect(s.err).toContain(`no node #${id} in the map`);
  }
  const root = await ok(p, ["show", "onboarding"]);
  expect(root.out).not.toContain("ghost");
  expect(root.out).not.toContain("email-verification");
  expect(root.out).not.toContain("resend-email");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = withReal([["search", "Search"]]);
  await ok(p, ["add", "search-index", "--title", "Search index", "--why", "Queries must be fast", "--parent", "search"]);
  const n = events(p).length;
  const again = await p.werk(["add", "search-index", "--title", "Search index v2", "--why", "Other words", "--parent", "search"]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("frozen");
  expect(events(p).length).toBe(n);
  const s = await ok(p, ["show", "search-index"]);
  expect(s.out).toContain("Search index\n");
  expect(s.out).toContain("why: Queries must be fast");
  expect(s.out).not.toContain("Other words");
});

test("04.5 an accept from the command line needs --actor you", async () => {
  const p = withReal([["security", "Security"]]);
  await ok(p, ["add", "audit-log", "--title", "Audit log", "--parent", "security"]);
  const n = events(p).length;
  const refused = await p.werk(["accept", "audit-log"]);
  expect(refused.code).not.toBe(0);
  expect(events(p).length).toBe(n);
  const ghost = await ok(p, ["show", "audit-log"]);
  expect(ghost.out.split("\n")[0]).toContain("proposed");
  const accepted = await p.werk(["accept", "audit-log", "--actor", "you"]);
  expect(accepted.code).toBe(0);
  const real = await ok(p, ["show", "audit-log"]);
  expect(real.out.split("\n")[0]).not.toContain("proposed");
});

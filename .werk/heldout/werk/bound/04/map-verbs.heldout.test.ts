// Held-out user paths 04.1 to 04.5: ghosts, accept and discard at the command line.
// Card ids are the kebab-case form of each title in the step.
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

/** A person's real cards, written to the log as accepted cards. */
function withReal(cards: { id: string; title: string; parent?: string }[]): Project {
  const p = freshProject();
  cards.forEach((c, i) => {
    const payload = { id: c.id, kind: "card", title: c.title, ...(c.parent ? { parent: c.parent } : {}) };
    appendFileSync(logOf(p), `${JSON.stringify({ seq: i + 1, at: "t", actor: "you", type: "node.added", payload })}\n`);
  });
  return p;
}

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

const isGhost = (out: string) => /^card \S+ {2}\[\w+\] {2}proposed\n/.test(out);
const isReal = (out: string) => /^card \S+ {2}\[\w+\]\n/.test(out);

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = withReal([
    { id: "checkout-flow", title: "Checkout flow" },
    { id: "other", title: "Other" },
  ]);
  // Another ghost elsewhere in the map, to check that it stays a ghost.
  await ok(p, ["add", "other-ghost", "--title", "Other ghost", "--parent", "other"]);
  const before = events(p).length;
  const add = await ok(p, ["add", "retry-payment", "--title", "Retry payment", "--parent", "checkout-flow"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const afterAdd = events(p);
  expect(afterAdd.length).toBe(before + 1);
  expect(afterAdd.at(-1)).toMatchObject({ type: "node.proposed", payload: { id: "retry-payment", parent: "checkout-flow" } });
  const shown = await ok(p, ["show", "retry-payment"]);
  expect(isGhost(shown.out)).toBe(true);
  expect(shown.out).toContain("parent: checkout-flow  Checkout flow");

  await ok(p, ["accept", "retry-payment", "--actor", "you"]);
  const afterAccept = events(p);
  expect(afterAccept.length).toBe(afterAdd.length + 1);
  expect(afterAccept.at(-1)).toMatchObject({ type: "change.accepted", payload: { id: "retry-payment" } });
  const real = await ok(p, ["show", "retry-payment"]);
  expect(isReal(real.out)).toBe(true);
  expect(real.out).toContain("parent: checkout-flow  Checkout flow");
  expect(isGhost((await ok(p, ["show", "other-ghost"])).out)).toBe(true);
});

test("04.2 accepting a ghost child accepts its ghost parent, and its held link goes live with no event", async () => {
  const p = withReal([
    { id: "payments", title: "Payments" },
    { id: "fraud-rules", title: "Fraud rules" },
  ]);
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial-refunds", "fraud-rules", "--type", "depends_on", "--why", "Uses the fraud limits"]);
  await ok(p, ["add", "full-refunds-only", "--kind", "option", "--title", "Only full refunds", "--why_not", "Too strict"]);
  await ok(p, ["link", "full-refunds-only", "partial-refunds", "--type", "alternative_to"]);
  await ok(p, ["add", "refund-study", "--kind", "source", "--title", "Refund study", "--url", "https://example.com"]);
  await ok(p, ["link", "partial-refunds", "refund-study", "--type", "supported_by"]);

  const held = await ok(p, ["show", "partial-refunds"]);
  expect(held.out).toMatch(/-> depends_on +fraud-rules {2}Fraud rules {2}\(held\)/);

  const before = events(p).length;
  await ok(p, ["accept", "partial-refunds", "--actor", "you"]);
  const added = events(p).slice(before);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((e) => e.type === "change.accepted")).toBe(true);
  expect(added.some((e) => e.type.startsWith("edge."))).toBe(false);

  for (const id of ["refunds", "partial-refunds"]) expect(isReal((await ok(p, ["show", id])).out)).toBe(true);
  expect((await ok(p, ["show", "full-refunds-only"])).out).toMatch(/^option full-refunds-only {2}\[\w+\]\n/);
  expect((await ok(p, ["show", "refund-study"])).out).toMatch(/^source refund-study {2}\[\w+\]\n/);
  const live = await ok(p, ["show", "partial-refunds"]);
  expect(live.out).toMatch(/-> depends_on +fraud-rules {2}Fraud rules\n/);
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = withReal([{ id: "onboarding", title: "Onboarding" }]);
  await ok(p, ["add", "email-verification", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend-email", "--title", "Resend email", "--parent", "email-verification"]);
  await ok(p, ["discard", "email-verification"]);
  for (const id of ["email-verification", "resend-email"]) {
    const run = await p.werk(["show", id]);
    expect(run.code).not.toBe(0);
    expect(run.err).toContain("no node");
  }
  const parent = await ok(p, ["show", "onboarding"]);
  expect(parent.out).not.toContain("<- refines");
  expect(parent.out).not.toContain("ghost");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = withReal([{ id: "search", title: "Search" }]);
  await ok(p, ["add", "search-index", "--title", "Search index", "--why", "Fast lookup", "--parent", "search"]);
  const before = readFileSync(logOf(p), "utf8");
  const again = await p.werk(["add", "search-index", "--title", "Search catalogue", "--why", "Other words", "--parent", "search"]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("a ghost's words are frozen");
  expect(readFileSync(logOf(p), "utf8")).toBe(before);
  const shown = await ok(p, ["show", "search-index"]);
  expect(shown.out).toContain("\nSearch index\n");
  expect(shown.out).toContain("why: Fast lookup");
  expect(shown.out).not.toContain("Search catalogue");
});

test("04.5 an accept from the command line needs --actor you", async () => {
  const p = withReal([{ id: "security", title: "Security" }]);
  await ok(p, ["add", "audit-log", "--title", "Audit log", "--parent", "security"]);
  const before = readFileSync(logOf(p), "utf8");
  const bare = await p.werk(["accept", "audit-log"]);
  expect(bare.code).not.toBe(0);
  expect(readFileSync(logOf(p), "utf8")).toBe(before);
  expect(isGhost((await ok(p, ["show", "audit-log"])).out)).toBe(true);
  const run = await p.werk(["accept", "audit-log", "--actor", "you"]);
  expect(run.code).toBe(0);
  expect(isReal((await ok(p, ["show", "audit-log"])).out)).toBe(true);
});

// Held-out steps 04.1 to 04.5: an agent's card waits as a ghost until the person accepts it.
import { expect, test } from "bun:test";
import { decided, events, header, lines, ok, project, real, seed } from "./b-helpers.ts";

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = project();
  seed(p, real("checkout", "Checkout flow"));
  await ok(p, ["add", "other", "--title", "Other ghost", "--why", "w"]);
  const before = lines(p).length;
  const add = await ok(p, ["add", "retry", "--title", "Retry payment", "--why", "w", "--parent", "checkout"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const fresh = events(p).slice(before);
  expect(fresh).toHaveLength(1);
  expect(fresh[0]).toMatchObject({ type: "node.proposed", payload: { id: "retry", parent: "checkout" } });
  const shown = (await ok(p, ["show", "retry"])).out;
  expect(shown.split("\n")[0]).toContain("proposed");
  expect(shown).toContain("parent: checkout  Checkout flow");

  const mid = lines(p).length;
  await ok(p, ["accept", "retry", "--actor", "you"]);
  const accepted = events(p).slice(mid);
  expect(accepted).toHaveLength(1);
  expect(accepted[0]).toMatchObject({ type: "change.accepted", payload: { id: "retry" } });
  const after = (await ok(p, ["show", "retry"])).out;
  expect(after.split("\n")[0]).not.toContain("proposed");
  expect(after).toContain("parent: checkout  Checkout flow");
  expect(await header(p, "other")).toContain("proposed");
}, 30_000);

test("04.2 accepting a ghost child accepts its ghost parent; the held link goes live with no event", async () => {
  const p = project();
  seed(p, real("payments", "Payments"));
  decided(p, "fraud", "Fraud rules");
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial", "fraud", "--type", "depends_on", "--why", "partial reads the fraud rules"]);
  await ok(p, ["add", "partial:opt0", "--kind", "option", "--title", "Full only", "--why_not", "too strict"]);
  await ok(p, ["link", "partial:opt0", "partial", "--type", "alternative_to"]);
  await ok(p, ["add", "src-part", "--kind", "source", "--title", "Refund study", "--finding", "partials common"]);
  await ok(p, ["link", "partial", "src-part", "--type", "supported_by"]);
  const held = (await ok(p, ["show", "partial"])).out;
  const depLine = held.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud"));
  expect(depLine).toContain("held");

  const before = lines(p).length;
  await ok(p, ["accept", "partial", "--actor", "you"]);
  const fresh = events(p).slice(before);
  expect(fresh.length).toBeGreaterThan(0);
  for (const e of fresh) expect(e.type).toBe("change.accepted");
  expect(await header(p, "refunds")).not.toContain("proposed");
  expect(await header(p, "partial")).not.toContain("proposed");
  expect(await header(p, "partial:opt0")).not.toContain("proposed");
  expect(await header(p, "src-part")).not.toContain("proposed");
  const live = (await ok(p, ["show", "partial"])).out;
  const liveLine = live.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud"));
  expect(liveLine).toBeDefined();
  expect(liveLine).not.toContain("held");
}, 60_000);

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = project();
  seed(p, real("onboarding", "Onboarding"));
  await ok(p, ["add", "email-verify", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend", "--title", "Resend email", "--parent", "email-verify"]);
  await ok(p, ["discard", "email-verify"]);
  for (const id of ["email-verify", "resend"]) {
    const run = await p.werk(["show", id]);
    expect(run.code).not.toBe(0);
    expect(run.err).toContain("no node");
  }
  const shown = (await ok(p, ["show", "onboarding"])).out;
  expect(shown).not.toContain("ghost");
  expect(shown).not.toContain("Email verification");
}, 30_000);

test("04.4 the words of a ghost are frozen", async () => {
  const p = project();
  seed(p, real("search", "Search"));
  await ok(p, ["add", "search-index", "--title", "Search index", "--why", "Fast lookups", "--parent", "search"]);
  const before = lines(p);
  const run = await p.werk([
    "add",
    "search-index",
    "--title",
    "Other index",
    "--why",
    "Other why",
    "--parent",
    "search",
  ]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("frozen");
  expect(lines(p)).toEqual(before);
  const shown = (await ok(p, ["show", "search-index"])).out;
  expect(shown).toContain("Search index");
  expect(shown).toContain("why: Fast lookups");
  expect(shown).not.toContain("Other");
}, 30_000);

test("04.5 an accept from the command line needs the statement that the person asked for it", async () => {
  const p = project();
  seed(p, real("root", "Root"));
  await ok(p, ["add", "audit", "--title", "Audit log", "--parent", "root"]);
  const before = lines(p);
  const refused = await p.werk(["accept", "audit"]);
  expect(refused.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect(await header(p, "audit")).toContain("proposed");
  const accepted = await p.werk(["accept", "audit", "--actor", "you"]);
  expect(accepted.code).toBe(0);
  expect(await header(p, "audit")).not.toContain("proposed");
}, 30_000);

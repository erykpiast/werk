import { expect, test } from "bun:test";
import { card, events, lines, ok, withMap } from "./helpers.ts";

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = withMap([card("checkout", "Checkout flow"), card("other", "Other")]);
  await ok(p, ["add", "other-ghost", "--title", "Other ghost", "--parent", "other"]);
  const before = lines(p).length;
  const add = await ok(p, ["add", "retry", "--title", "Retry payment", "--parent", "checkout"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = events(p);
  expect(after.length).toBe(before + 1);
  expect(after.at(-1)).toMatchObject({ type: "node.proposed", payload: { id: "retry", parent: "checkout" } });
  const show = (await ok(p, ["show", "retry"])).out;
  expect(show).toStartWith("card retry  [open]  proposed\nRetry payment\n");
  expect(show).toContain("parent: checkout  Checkout flow");
  const acc = await ok(p, ["accept", "retry", "--actor", "you"]);
  expect(acc.code).toBe(0);
  const after2 = events(p);
  expect(after2.length).toBe(before + 2);
  expect(after2.at(-1)).toMatchObject({ type: "change.accepted", payload: { id: "retry" } });
  const show2 = (await ok(p, ["show", "retry"])).out;
  expect(show2.split("\n")[0]).toBe("card retry  [open]");
  expect(show2).toContain("parent: checkout  Checkout flow");
  expect((await ok(p, ["show", "other-ghost"])).out.split("\n")[0]).toContain("proposed");
});

test("04.2 accepting a ghost child accepts its ghost parent, and its held link goes live", async () => {
  const p = withMap([card("payments", "Payments"), card("fraud", "Fraud rules")]);
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial", "fraud", "--type", "depends_on", "--why", "Partial refunds read the fraud score"]);
  await ok(p, ["add", "partial:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "Too strict"]);
  await ok(p, ["link", "partial:opt0", "partial", "--type", "alternative_to"]);
  await ok(p, ["add", "survey", "--kind", "source", "--title", "Refund survey", "--finding", "Users want partial"]);
  await ok(p, ["link", "partial", "survey", "--type", "supported_by"]);
  const held = (await ok(p, ["show", "partial"])).out;
  expect(held).toMatch(/-> depends_on\s+fraud {2}Fraud rules {2}\((ghost, )?held\)/);
  const before = lines(p).length;
  await ok(p, ["accept", "partial", "--actor", "you"]);
  const added = events(p).slice(before);
  expect(added.length).toBeGreaterThan(0);
  for (const e of added) expect(e.type).toBe("change.accepted");
  expect((await ok(p, ["show", "refunds"])).out.split("\n")[0]).toBe("card refunds  [open]");
  const shown = (await ok(p, ["show", "partial"])).out;
  expect(shown.split("\n")[0]).toBe("card partial  [open]");
  expect((await ok(p, ["show", "partial:opt0"])).out.split("\n")[0]).not.toContain("proposed");
  expect((await ok(p, ["show", "survey"])).out.split("\n")[0]).not.toContain("proposed");
  expect(shown).toContain("  -> depends_on      fraud  Fraud rules\n");
  expect(shown).not.toMatch(/fraud {2}Fraud rules {2}\(/);
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = withMap([card("onboarding", "Onboarding")]);
  await ok(p, ["add", "email", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend", "--title", "Resend email", "--parent", "email"]);
  await ok(p, ["discard", "email"]);
  for (const id of ["email", "resend"]) {
    const r = await p.werk(["show", id]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("no node");
  }
  const on = (await ok(p, ["show", "onboarding"])).out;
  expect(on).not.toContain("ghost");
  expect(on).not.toContain("<- refines");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = withMap([card("search", "Search")]);
  await ok(p, ["add", "search-index", "--title", "Search index", "--why", "Fast lookups", "--parent", "search"]);
  const before = lines(p);
  const again = await p.werk(["add", "search-index", "--title", "Search index v2", "--why", "Other", "--parent", "search"]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("frozen");
  expect(lines(p)).toEqual(before);
  const show = (await ok(p, ["show", "search-index"])).out;
  expect(show).toContain("Search index\n");
  expect(show).toContain("why: Fast lookups");
});

test("04.5 an accept from the command line needs --actor you", async () => {
  const p = withMap([card("root", "Root")]);
  await ok(p, ["add", "audit", "--title", "Audit log", "--parent", "root"]);
  const before = lines(p);
  const no = await p.werk(["accept", "audit"]);
  expect(no.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", "audit"])).out.split("\n")[0]).toContain("proposed");
  const yes = await p.werk(["accept", "audit", "--actor", "you"]);
  expect(yes.code).toBe(0);
  expect((await ok(p, ["show", "audit"])).out.split("\n")[0]).toBe("card audit  [open]");
});

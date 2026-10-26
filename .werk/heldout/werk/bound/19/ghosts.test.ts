import { expect, test } from "bun:test";
import { project } from "./helpers.ts";

test("04.1", async () => {
  const p = project();
  p.real("checkout-flow", "Checkout flow");
  await p.ok(["add", "other-ghost", "--title", "Other ghost", "--parent", "checkout-flow"]);
  const before = p.log().length;
  const add = await p.werk(["add", "retry-payment", "--title", "Retry payment", "--parent", "checkout-flow"]);
  expect(add.code).toBe(0);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = p.log();
  expect(after.length).toBe(before + 1);
  expect(after.at(-1)).toMatchObject({ type: "node.proposed", payload: { id: "retry-payment", parent: "checkout-flow" } });
  const show = await p.ok(["show", "retry-payment"]);
  expect(show).toContain("proposed");
  expect(show).toMatch(/parent: checkout-flow/);
  const acc = await p.werk(["accept", "retry-payment", "--actor", "you"]);
  expect(acc.code).toBe(0);
  const log2 = p.log();
  expect(log2.length).toBe(after.length + 1);
  expect(log2.at(-1)).toMatchObject({ type: "change.accepted", payload: { id: "retry-payment" } });
  const show2 = await p.ok(["show", "retry-payment"]);
  expect(show2.split("\n")[0]).not.toContain("proposed");
  expect(show2).toMatch(/parent: checkout-flow/);
  expect((await p.ok(["show", "other-ghost"])).split("\n")[0]).toContain("proposed");
});

test("04.2", async () => {
  const p = project();
  p.real("payments", "Payments");
  p.real("fraud-rules", "Fraud rules");
  await p.ok(["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await p.ok(["add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds"]);
  await p.ok(["link", "partial-refunds", "fraud-rules", "--type", "depends_on", "--why", "uses the fraud limits"]);
  await p.ok(["add", "partial-refunds:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "too strict"]);
  await p.ok(["link", "partial-refunds:opt0", "partial-refunds", "--type", "alternative_to"]);
  await p.ok(["add", "src-pci", "--kind", "source", "--title", "PCI guide", "--url", "https://example.com"]);
  await p.ok(["link", "partial-refunds", "src-pci", "--type", "supported_by"]);
  const held = await p.ok(["show", "partial-refunds"]);
  const depLine = held.split("\n").find((l) => l.includes("depends_on"));
  expect(depLine).toContain("held");
  const before = p.log().length;
  const acc = await p.werk(["accept", "partial-refunds", "--actor", "you"]);
  expect(acc.code).toBe(0);
  const fresh = p.log().slice(before);
  expect(fresh.length).toBeGreaterThan(0);
  expect(fresh.every((e) => e.type === "change.accepted")).toBe(true);
  for (const id of ["refunds", "partial-refunds", "partial-refunds:opt0", "src-pci"]) {
    expect((await p.ok(["show", id])).split("\n")[0]).not.toContain("proposed");
  }
  const live = await p.ok(["show", "partial-refunds"]);
  const dep = live.split("\n").find((l) => l.includes("depends_on"));
  expect(dep).toContain("fraud-rules");
  expect(dep).not.toContain("held");
});

test("04.3", async () => {
  const p = project();
  p.real("onboarding", "Onboarding");
  await p.ok(["add", "email-verification", "--title", "Email verification", "--parent", "onboarding"]);
  await p.ok(["add", "resend-email", "--title", "Resend email", "--parent", "email-verification"]);
  const d = await p.werk(["discard", "email-verification"]);
  expect(d.code).toBe(0);
  for (const id of ["email-verification", "resend-email"]) {
    const s = await p.werk(["show", id]);
    expect(s.code).not.toBe(0);
    expect(s.err).toContain("no node");
  }
  const o = await p.ok(["show", "onboarding"]);
  expect(o).not.toContain("email-verification");
  expect(o).not.toContain("ghost");
});

test("04.4", async () => {
  const p = project();
  p.real("search", "Search");
  await p.ok(["add", "search-index", "--title", "Search index", "--why", "fast lookups", "--parent", "search"]);
  const before = p.log().length;
  const again = await p.werk(["add", "search-index", "--title", "Search index v2", "--why", "other words", "--parent", "search"]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("frozen");
  expect(p.log().length).toBe(before);
  const s = await p.ok(["show", "search-index"]);
  expect(s).toContain("Search index\n");
  expect(s).toContain("why: fast lookups");
  expect(s).not.toContain("v2");
});

test("04.5", async () => {
  const p = project();
  p.real("platform", "Platform");
  await p.ok(["add", "audit-log", "--title", "Audit log", "--parent", "platform"]);
  const before = p.log().length;
  const no = await p.werk(["accept", "audit-log"]);
  expect(no.code).not.toBe(0);
  expect(p.log().length).toBe(before);
  expect((await p.ok(["show", "audit-log"])).split("\n")[0]).toContain("proposed");
  const yes = await p.werk(["accept", "audit-log", "--actor", "you"]);
  expect(yes.code).toBe(0);
  expect((await p.ok(["show", "audit-log"])).split("\n")[0]).not.toContain("proposed");
});

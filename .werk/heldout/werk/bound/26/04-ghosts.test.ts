import { expect, test } from "bun:test";
import { events, freshProject, realCard } from "./helpers.ts";

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = freshProject();
  await realCard(p, "checkout-flow", "Checkout flow");
  await p.werk(["add", "other-ghost", "--title", "Other ghost"]);
  const before = events(p).length;
  const add = await p.werk(["add", "retry-payment", "--title", "Retry payment", "--parent", "checkout-flow"]);
  console.log("04.1 add:", JSON.stringify(add));
  expect(add.code).toBe(0);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = events(p).slice(before);
  console.log("04.1 new events:", JSON.stringify(after));
  expect(after.length).toBe(1);
  expect(after[0]?.type).toBe("node.proposed");
  expect(after[0]?.payload.parent).toBe("checkout-flow");
  const show = await p.werk(["show", "retry-payment"]);
  console.log("04.1 show ghost:", show.out);
  expect(show.out.split("\n")[0]).toContain("proposed");
  expect(show.out).toContain("parent: checkout-flow  Checkout flow");
  const n = events(p).length;
  const acc = await p.werk(["accept", "retry-payment", "--actor", "you"]);
  console.log("04.1 accept:", JSON.stringify(acc));
  expect(acc.code).toBe(0);
  const accEvents = events(p).slice(n);
  expect(accEvents.length).toBe(1);
  expect(accEvents[0]?.type).toBe("change.accepted");
  const show2 = await p.werk(["show", "retry-payment"]);
  console.log("04.1 show real:", show2.out);
  expect(show2.out.split("\n")[0]).not.toContain("proposed");
  expect(show2.out).toContain("parent: checkout-flow  Checkout flow");
  const other = await p.werk(["show", "other-ghost"]);
  expect(other.out.split("\n")[0]).toContain("proposed");
});

test("04.2 accepting a ghost child accepts its ghost parent, and the held link goes live", async () => {
  const p = freshProject();
  await realCard(p, "payments", "Payments");
  await realCard(p, "fraud-rules", "Fraud rules");
  expect((await p.werk(["add", "refunds", "--title", "Refunds", "--parent", "payments"])).code).toBe(0);
  expect((await p.werk(["add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds"])).code).toBe(0);
  const link = await p.werk([
    "link", "partial-refunds", "fraud-rules", "--type", "depends_on", "--why", "a partial refund passes the fraud rules",
  ]);
  console.log("04.2 link:", JSON.stringify(link));
  expect(link.code).toBe(0);
  const opt = await p.werk(["add", "partial-refunds:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "customers ask for partial"]);
  const optLink = await p.werk(["link", "partial-refunds:opt0", "partial-refunds", "--type", "alternative_to"]);
  const src = await p.werk(["add", "src-refund-policy", "--kind", "source", "--title", "Refund policy", "--url", "https://example.com/policy", "--finding", "partial refunds allowed"]);
  const srcLink = await p.werk(["link", "partial-refunds", "src-refund-policy", "--type", "supported_by"]);
  console.log("04.2 option/source:", JSON.stringify([opt, optLink, src, srcLink]));
  for (const r of [opt, optLink, src, srcLink]) expect(r.code).toBe(0);
  const held = await p.werk(["show", "partial-refunds"]);
  console.log("04.2 show before:", held.out);
  const depLine = held.out.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules"));
  expect(depLine).toBeDefined();
  expect(depLine).toContain("held");
  const n = events(p).length;
  const acc = await p.werk(["accept", "partial-refunds", "--actor", "you"]);
  console.log("04.2 accept:", JSON.stringify(acc));
  expect(acc.code).toBe(0);
  const newEvents = events(p).slice(n);
  console.log("04.2 new events:", JSON.stringify(newEvents.map((e) => [e.type, e.payload.id])));
  expect(newEvents.length).toBeGreaterThan(0);
  expect(newEvents.every((e) => e.type === "change.accepted")).toBe(true);
  for (const id of ["refunds", "partial-refunds", "partial-refunds:opt0", "src-refund-policy"]) {
    const s = await p.werk(["show", id]);
    expect(s.code).toBe(0);
    expect(s.out.split("\n")[0]).not.toContain("proposed");
  }
  const live = await p.werk(["show", "partial-refunds"]);
  console.log("04.2 show after:", live.out);
  const depLive = live.out.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules"));
  expect(depLive).toBeDefined();
  expect(depLive).not.toContain("held");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = freshProject();
  await realCard(p, "onboarding", "Onboarding");
  await p.werk(["add", "email-verification", "--title", "Email verification", "--parent", "onboarding"]);
  await p.werk(["add", "resend-email", "--title", "Resend email", "--parent", "email-verification"]);
  const d = await p.werk(["discard", "email-verification"]);
  console.log("04.3 discard:", JSON.stringify(d));
  expect(d.code).toBe(0);
  for (const id of ["email-verification", "resend-email"]) {
    const s = await p.werk(["show", id]);
    console.log("04.3 show", id, JSON.stringify(s));
    expect(s.code).not.toBe(0);
    expect(s.err).toContain("no node");
  }
  const on = await p.werk(["show", "onboarding"]);
  console.log("04.3 show onboarding:", on.out);
  expect(on.out).not.toContain("email-verification");
  expect(on.out).not.toContain("resend-email");
  expect(on.out).not.toContain("ghost");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = freshProject();
  await realCard(p, "search", "Search");
  await p.werk(["add", "search-index", "--title", "Search uses an index", "--why", "Scans are slow", "--parent", "search"]);
  const n = events(p).length;
  const again = await p.werk(["add", "search-index", "--title", "Search scans every card", "--why", "An index is costly", "--parent", "search"]);
  console.log("04.4 second add:", JSON.stringify(again));
  expect(again.code).not.toBe(0);
  expect(again.err.toLowerCase()).toMatch(/frozen|ghost/);
  expect(events(p).length).toBe(n);
  const s = await p.werk(["show", "search-index"]);
  console.log("04.4 show:", s.out);
  expect(s.out).toContain("Search uses an index");
  expect(s.out).toContain("why: Scans are slow");
});

test("04.5 an accept from the command line needs --actor you", async () => {
  const p = freshProject();
  await realCard(p, "security", "Security");
  await p.werk(["add", "audit-log", "--title", "Audit log", "--parent", "security"]);
  const n = events(p).length;
  const bad = await p.werk(["accept", "audit-log"]);
  console.log("04.5 accept without actor:", JSON.stringify(bad));
  expect(bad.code).not.toBe(0);
  expect(events(p).length).toBe(n);
  expect((await p.werk(["show", "audit-log"])).out.split("\n")[0]).toContain("proposed");
  const ok = await p.werk(["accept", "audit-log", "--actor", "you"]);
  expect(ok.code).toBe(0);
  const s = await p.werk(["show", "audit-log"]);
  console.log("04.5 show after:", s.out);
  expect(s.out.split("\n")[0]).not.toContain("proposed");
});

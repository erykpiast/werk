// Held-out 04.x: ghosts wait until the person accepts them.
import { expect, test } from "bun:test";
import { head, project } from "./helpers.ts";

test("04.1 an agent's new card waits as a ghost until the person accepts it", () => {
  const p = project([
    { id: "checkout", title: "Checkout flow" },
    { id: "other-ghost-host", title: "Host" },
  ]);
  // Another ghost in the map, to check that it stays a ghost.
  p.ok("add", "other", "--title", "Other ghost", "--parent", "other-ghost-host");
  const before = p.events().length;
  const add = p.ok("add", "retry", "--title", "Retry payment", "--parent", "checkout");
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const afterAdd = p.events();
  expect(afterAdd.length).toBe(before + 1);
  const ev = afterAdd.at(-1)!;
  expect(ev.type).toContain("proposed");
  expect(ev.payload.parent).toBe("checkout");
  const shown = p.show("retry");
  expect(head(shown)).toContain("proposed");
  expect(shown).toContain("parent: checkout  Checkout flow");

  p.ok("accept", "retry", "--actor", "you");
  const afterAccept = p.events();
  expect(afterAccept.length).toBe(afterAdd.length + 1);
  expect(afterAccept.at(-1)!.type).toBe("change.accepted");
  const real = p.show("retry");
  expect(head(real)).not.toContain("proposed");
  expect(real).toContain("parent: checkout  Checkout flow");
  expect(real).toMatch(/-> refines\s+checkout\s+Checkout flow\s*\n/);
  expect(head(p.show("other"))).toContain("proposed");
});

test("04.2 accepting a ghost child accepts its ghost parent, and the held link goes live with no further event", () => {
  const p = project([
    { id: "payments", title: "Payments" },
    { id: "fraud", title: "Fraud rules" },
  ]);
  p.ok("add", "refunds", "--title", "Refunds", "--parent", "payments");
  p.ok("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  p.ok("link", "partial", "fraud", "--type", "depends_on", "--why", "fraud limits cap partial refunds");
  p.ok("add", "partial:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "too strict");
  p.ok("link", "partial:opt0", "partial", "--type", "alternative_to");
  p.ok("add", "bench", "--kind", "source", "--title", "Refund study", "--finding", "partials are common");
  p.ok("link", "partial", "bench", "--type", "supported_by");
  expect(p.show("partial")).toMatch(/-> depends_on\s+fraud\s+Fraud rules\s+\(held\)/);

  const before = p.events().length;
  p.ok("accept", "partial", "--actor", "you");
  const added = p.events().slice(before);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((e) => e.type === "change.accepted")).toBe(true);
  expect(added.some((e) => e.type.startsWith("edge."))).toBe(false);
  expect(head(p.show("refunds"))).not.toContain("proposed");
  const partial = p.show("partial");
  expect(head(partial)).not.toContain("proposed");
  expect(head(p.show("partial:opt0"))).not.toContain("proposed");
  expect(head(p.show("bench"))).not.toContain("proposed");
  expect(partial).toMatch(/-> depends_on\s+fraud\s+Fraud rules\s*\n/);
  expect(partial).not.toMatch(/depends_on.*held/);
});

test("04.3 discarding a ghost parent drops its ghost children", () => {
  const p = project([{ id: "onboarding", title: "Onboarding" }]);
  p.ok("add", "email", "--title", "Email verification", "--parent", "onboarding");
  p.ok("add", "resend", "--title", "Resend email", "--parent", "email");
  p.ok("discard", "email");
  for (const id of ["email", "resend"]) {
    const run = p.werk("show", id);
    expect(run.code).not.toBe(0);
    expect(run.err).toContain(`#${id}`);
    expect(run.err).toMatch(/no node .* in the map/);
  }
  const onboarding = p.show("onboarding");
  expect(onboarding).not.toContain("ghost");
  expect(onboarding).not.toContain("<- refines");
});

test("04.4 the words of a ghost are frozen", () => {
  const p = project([{ id: "search", title: "Search" }]);
  p.ok("add", "index", "--title", "Search index", "--why", "fast lookups", "--parent", "search");
  const before = p.rawLines();
  const again = p.werk("add", "index", "--title", "Search catalog", "--why", "other words", "--parent", "search");
  expect(again.code).not.toBe(0);
  expect(again.err).toMatch(/frozen/);
  expect(p.rawLines()).toEqual(before);
  const shown = p.show("index");
  expect(shown).toContain("Search index");
  expect(shown).toContain("why: fast lookups");
});

test("04.5 an accept from the command line needs the statement that the person asked for it", () => {
  const p = project([{ id: "admin", title: "Admin" }]);
  p.ok("add", "audit", "--title", "Audit log", "--parent", "admin");
  const before = p.rawLines();
  const refused = p.werk("accept", "audit");
  expect(refused.code).not.toBe(0);
  expect(p.rawLines()).toEqual(before);
  expect(head(p.show("audit"))).toContain("proposed");
  const accepted = p.werk("accept", "audit", "--actor", "you");
  expect(accepted.code).toBe(0);
  expect(head(p.show("audit"))).not.toContain("proposed");
});

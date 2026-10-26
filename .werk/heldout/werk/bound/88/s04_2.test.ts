import { expect, test } from "bun:test";
import { card, lines, ok, withMap } from "./h62util.ts";

test("04.2 accepting a ghost child accepts its ghost parent; held link goes live with no event", async () => {
  const p = withMap([card("root", "Root"), card("payments", "Payments", "root"), card("fraud", "Fraud rules", "root")]);
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial", "fraud", "--type", "depends_on", "--why", "Fraud limits partial refunds"]);
  await ok(p, ["add", "partial:opt0", "--kind", "option", "--title", "Full only", "--why_not", "Too coarse"]);
  await ok(p, ["link", "partial:opt0", "partial", "--type", "alternative_to"]);
  await ok(p, ["add", "src", "--kind", "source", "--title", "Refund study"]);
  await ok(p, ["link", "partial", "src", "--type", "supported_by"]);
  const held = (await ok(p, ["show", "partial"])).out;
  expect(held).toMatch(/depends_on\s+fraud\s+Fraud rules\s+\(held\)/);
  const before = lines(p);
  await ok(p, ["accept", "partial", "--actor", "you"]);
  const added = lines(p).slice(before.length).map((l) => JSON.parse(l));
  expect(added.length).toBeGreaterThan(0);
  for (const e of added) expect(e.type).toBe("change.accepted");
  expect(added.some((e) => e.type.startsWith("edge"))).toBe(false);
  for (const id of ["refunds", "partial"]) {
    const out = (await ok(p, ["show", id])).out;
    expect(out).not.toContain("proposed");
    expect(out).not.toContain("ghost");
  }
  for (const id of ["partial:opt0", "src"]) expect((await ok(p, ["show", id])).out).not.toContain("proposed");
  const live = (await ok(p, ["show", "partial"])).out;
  expect(live).toMatch(/depends_on\s+fraud\s+Fraud rules\n/);
  expect(live).not.toContain("held");
  expect(live).not.toContain("proposed");
}, 30_000);

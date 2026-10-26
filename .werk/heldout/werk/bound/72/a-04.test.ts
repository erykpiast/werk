import { expect, test } from "bun:test";
import { children, project, real, show } from "./a-helpers.ts";

const header = (out: string) => out.split("\n")[0] ?? "";

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = await (async () => {
    const p = project();
    await real(p, "root", "Root");
    await real(p, "checkout", "Checkout flow", "root");
    await p.werk(["add", "other", "--title", "Another ghost", "--parent", "root"]);
    return p;
  })();
  const before = p.lines().length;
  const add = await p.werk(["add", "retry", "--title", "Retry payment", "--parent", "checkout"]);
  expect(add.code).toBe(0);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const evs = p.events().slice(before);
  expect(evs).toHaveLength(1);
  expect(evs[0]?.type).toBe("node.proposed");
  expect(evs[0]?.payload.parent).toBe("checkout");
  const s = await show(p, "retry");
  expect(header(s.out)).toContain("proposed");
  expect(s.out).toMatch(/parent: checkout\s+Checkout flow/);

  const mid = p.lines().length;
  const acc = await p.werk(["accept", "retry", "--actor", "you"]);
  expect(acc.code).toBe(0);
  const accEvs = p.events().slice(mid);
  expect(accEvs).toHaveLength(1);
  expect(accEvs[0]?.type).toBe("change.accepted");
  const s2 = await show(p, "retry");
  expect(header(s2.out)).not.toContain("proposed");
  expect(s2.out).toMatch(/parent: checkout\s+Checkout flow/);
  expect(header((await show(p, "other")).out)).toContain("proposed");
});

test("04.2 accepting a ghost child also accepts its ghost parent, and its held link goes live", async () => {
  const p = project();
  await real(p, "root", "Root");
  await real(p, "payments", "Payments", "root");
  await real(p, "fraud", "Fraud rules", "root");
  await p.werk(["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await p.werk(["add", "partial", "--title", "Partial refunds", "--parent", "refunds"]);
  expect(
    (await p.werk(["link", "partial", "fraud", "--type", "depends_on", "--why", "fraud limits refunds"])).code,
  ).toBe(0);
  await p.werk(["add", "partial:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "too coarse"]);
  await p.werk(["link", "partial:opt0", "partial", "--type", "alternative_to"]);
  await p.werk(["add", "bench", "--kind", "source", "--title", "Refund study", "--finding", "partials are common"]);
  await p.werk(["link", "partial", "bench", "--type", "supported_by"]);
  const before = await show(p, "partial");
  expect(before.out).toMatch(/-> depends_on\s+fraud\s+Fraud rules\s+\(held\)/);

  const n = p.lines().length;
  expect((await p.werk(["accept", "partial", "--actor", "you"])).code).toBe(0);
  const evs = p.events().slice(n);
  expect(evs.length).toBeGreaterThan(0);
  expect(evs.every((e) => e.type === "change.accepted")).toBe(true);
  expect(header((await show(p, "refunds")).out)).not.toContain("proposed");
  const after = await show(p, "partial");
  expect(header(after.out)).not.toContain("proposed");
  expect(header((await show(p, "partial:opt0")).out)).not.toContain("proposed");
  expect(header((await show(p, "bench")).out)).not.toContain("proposed");
  expect(after.out).toMatch(/-> depends_on\s+fraud\s+Fraud rules\s*\n/);
  expect(after.out).not.toContain("held");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = project();
  await real(p, "root", "Root");
  await real(p, "onboarding", "Onboarding", "root");
  await p.werk(["add", "email", "--title", "Email verification", "--parent", "onboarding"]);
  await p.werk(["add", "resend", "--title", "Resend email", "--parent", "email"]);
  expect((await p.werk(["discard", "email"])).code).toBe(0);
  for (const id of ["email", "resend"]) {
    const s = await show(p, id);
    expect(s.code).not.toBe(0);
    expect(s.err).toContain("not in the map".replace("not in", "in")); // "no node #x in the map"
    expect(s.err).toMatch(/no node/);
  }
  const o = await show(p, "onboarding");
  expect(children(o.out)).toEqual([]);
  expect(o.out).not.toContain("ghost");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = project();
  await real(p, "root", "Root");
  await real(p, "search", "Search", "root");
  await p.werk(["add", "index", "--title", "Search index", "--why", "Queries need speed", "--parent", "search"]);
  const n = p.lines().length;
  const again = await p.werk([
    "add",
    "index",
    "--title",
    "Search index v2",
    "--why",
    "Other words",
    "--parent",
    "search",
  ]);
  expect(again.code).not.toBe(0);
  expect(again.err).toMatch(/frozen/);
  expect(p.lines()).toHaveLength(n);
  const s = await show(p, "index");
  expect(s.out).toContain("Search index\n");
  expect(s.out).toContain("why: Queries need speed");
});

test("04.5 an accept from the command line needs the statement that the person asked for it", async () => {
  const p = project();
  await real(p, "root", "Root");
  await p.werk(["add", "audit", "--title", "Audit log", "--parent", "root"]);
  const n = p.lines().length;
  const bare = await p.werk(["accept", "audit"]);
  expect(bare.code).not.toBe(0);
  expect(p.lines()).toHaveLength(n);
  expect(header((await show(p, "audit")).out)).toContain("proposed");
  const ok = await p.werk(["accept", "audit", "--actor", "you"]);
  expect(ok.code).toBe(0);
  expect(header((await show(p, "audit")).out)).not.toContain("proposed");
});

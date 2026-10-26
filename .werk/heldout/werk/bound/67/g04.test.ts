import { expect, test } from "bun:test";
import { make } from "./lib.ts";

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  p.card("checkout", { title: "Checkout flow", parent: "root" });
  p.seed("node.proposed", { id: "other", kind: "card", title: "Other ghost", parent: "root" });
  const before = p.lines().length;
  const add = await p.w("add", "retry", "--title", "Retry payment", "--parent", "checkout");
  expect(add.code).toBe(0);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const ev = p.events().slice(before);
  expect(ev.length).toBe(1);
  expect(ev[0].type).toBe("node.proposed");
  expect(ev[0].payload.parent).toBe("checkout");
  const show = await p.w("show", "retry");
  expect(show.out).toMatch(/card retry .*proposed/);
  expect(show.out).toContain("parent: checkout  Checkout flow");
  const n = p.lines().length;
  const acc = await p.w("accept", "retry", "--actor", "you");
  expect(acc.code).toBe(0);
  const ev2 = p.events().slice(n);
  expect(ev2.length).toBe(1);
  expect(ev2[0].type).toBe("change.accepted");
  const show2 = await p.w("show", "retry");
  expect(show2.out.split("\n")[0]).not.toContain("proposed");
  expect(show2.out).toContain("parent: checkout  Checkout flow");
  const other = await p.w("show", "other");
  expect(other.out.split("\n")[0]).toContain("proposed");
});

test("04.2 accepting a ghost child also accepts its ghost parent, held link goes live", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  p.card("payments", { title: "Payments", parent: "root" });
  p.card("fraud", { title: "Fraud rules", parent: "root" });
  expect((await p.w("add", "refunds", "--title", "Refunds", "--parent", "payments")).code).toBe(0);
  expect((await p.w("add", "partial", "--title", "Partial refunds", "--parent", "refunds")).code).toBe(0);
  expect((await p.w("link", "partial", "fraud", "--type", "depends_on", "--why", "uses fraud checks")).code).toBe(0);
  expect(
    (await p.w("add", "partial:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "too strict"))
      .code,
  ).toBe(0);
  expect((await p.w("link", "partial:opt0", "partial", "--type", "alternative_to")).code).toBe(0);
  expect((await p.w("add", "src-bench", "--kind", "source", "--title", "Bench", "--finding", "fast")).code).toBe(0);
  expect((await p.w("link", "partial", "src-bench", "--type", "supported_by")).code).toBe(0);
  const s1 = await p.w("show", "partial");
  expect(s1.out).toMatch(/-> depends_on +fraud +Fraud rules +\(held\)/);
  const n = p.lines().length;
  expect((await p.w("accept", "partial", "--actor", "you")).code).toBe(0);
  const ev = p.events().slice(n);
  expect(ev.length).toBeGreaterThan(0);
  expect(ev.every((e: { type: string }) => e.type === "change.accepted")).toBe(true);
  for (const id of ["refunds", "partial", "partial:opt0", "src-bench"]) {
    const s = await p.w("show", id);
    expect(s.out.split("\n")[0]).not.toContain("proposed");
  }
  const s2 = await p.w("show", "partial");
  expect(s2.out).toMatch(/-> depends_on +fraud +Fraud rules\n/);
  expect(s2.out).not.toContain("held");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  p.card("onboarding", { title: "Onboarding", parent: "root" });
  expect((await p.w("add", "email", "--title", "Email verification", "--parent", "onboarding")).code).toBe(0);
  expect((await p.w("add", "resend", "--title", "Resend email", "--parent", "email")).code).toBe(0);
  expect((await p.w("discard", "email")).code).toBe(0);
  for (const id of ["email", "resend"]) {
    const s = await p.w("show", id);
    expect(s.code).not.toBe(0);
    expect(s.err).toContain("no node");
  }
  const s = await p.w("show", "onboarding");
  expect(s.out).not.toContain("ghost");
  expect(s.out).not.toContain("<- refines");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  p.card("search", { title: "Search", parent: "root" });
  expect(
    (await p.w("add", "search-index", "--title", "Index first", "--why", "Fast lookups", "--parent", "search")).code,
  ).toBe(0);
  const n = p.lines().length;
  const again = await p.w(
    "add",
    "search-index",
    "--title",
    "Index later",
    "--why",
    "Slow lookups",
    "--parent",
    "search",
  );
  expect(again.code).not.toBe(0);
  expect(`${again.out}${again.err}`).toMatch(/frozen/i);
  expect(p.lines().length).toBe(n);
  const s = await p.w("show", "search-index");
  expect(s.out).toContain("Index first");
  expect(s.out).toContain("why: Fast lookups");
});

test("04.5 an accept from the command line needs --actor you", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  expect((await p.w("add", "audit-log", "--title", "Audit log", "--parent", "root")).code).toBe(0);
  const n = p.lines().length;
  const bad = await p.w("accept", "audit-log");
  expect(bad.code).not.toBe(0);
  expect(p.lines().length).toBe(n);
  expect((await p.w("show", "audit-log")).out.split("\n")[0]).toContain("proposed");
  const ok = await p.w("accept", "audit-log", "--actor", "you");
  expect(ok.code).toBe(0);
  expect((await p.w("show", "audit-log")).out.split("\n")[0]).not.toContain("proposed");
});

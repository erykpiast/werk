import { expect, test } from "bun:test";
import { card, events, lines, ok, type Project, seed, w, withRoot } from "./lib.ts";

function base(): Project {
  const p = withRoot();
  card(p, "checkout", { title: "Checkout flow" });
  return p;
}

test("04.1 add under real card proposes a ghost; accept makes it real", async () => {
  const p = base();
  card(p, "other", { title: "Other" });
  await ok(p, "add", "other-ghost", "--title", "Other ghost", "--parent", "root");
  const before = lines(p).length;
  const add = await ok(p, "add", "retry", "--title", "Retry payment", "--parent", "checkout");
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  expect(lines(p).length).toBe(before + 1);
  const ev = events(p).at(-1)!;
  expect(ev.type).toBe("node.proposed");
  expect(ev.payload.parent).toBe("checkout");
  const show = (await ok(p, "show", "retry")).out;
  expect(show).toContain("proposed");
  expect(show).toContain("parent: checkout  Checkout flow");
  const b2 = lines(p).length;
  await ok(p, "accept", "retry", "--actor", "you");
  expect(lines(p).length).toBe(b2 + 1);
  expect(events(p).at(-1)!.type).toBe("change.accepted");
  const after = (await ok(p, "show", "retry")).out;
  expect(after).not.toContain("proposed");
  expect(after).toContain("parent: checkout  Checkout flow");
  expect((await ok(p, "show", "other-ghost")).out).toContain("proposed");
});

test("04.2 accepting a ghost child accepts ghost parent, option, source; held link goes live without link event", async () => {
  const p = withRoot();
  card(p, "payments", { title: "Payments" });
  card(p, "fraud", { title: "Fraud rules" });
  await ok(p, "add", "refunds", "--title", "Refunds", "--parent", "payments");
  await ok(p, "add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await ok(p, "link", "partial", "fraud", "--type", "depends_on", "--why", "needs fraud");
  await ok(p, "add", "partial:opt0", "--kind", "option", "--title", "Opt", "--why_not", "bad");
  await ok(p, "link", "partial:opt0", "partial", "--type", "alternative_to");
  await ok(p, "add", "src1", "--kind", "source", "--title", "Src", "--finding", "f");
  await ok(p, "link", "partial", "src1", "--type", "supported_by");
  const held = (await ok(p, "show", "partial")).out;
  expect(held).toMatch(/depends_on\s+fraud\s+Fraud rules\s+\(held\)/);
  const n = lines(p).length;
  await ok(p, "accept", "partial", "--actor", "you");
  const added = events(p).slice(n);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((e) => e.type === "change.accepted")).toBe(true);
  expect(added.some((e) => e.type === "edge.added")).toBe(false);
  expect((await ok(p, "show", "refunds")).out).not.toContain("proposed");
  const s = (await ok(p, "show", "partial")).out;
  expect(s).not.toContain("proposed");
  expect(s).not.toContain("held");
  expect(s).not.toContain("ghost");
  expect(s).toMatch(/depends_on\s+fraud\s+Fraud rules/);
});

test("04.3 discarding a ghost parent drops ghost children", async () => {
  const p = withRoot();
  card(p, "onboarding", { title: "Onboarding" });
  await ok(p, "add", "email", "--title", "Email verification", "--parent", "onboarding");
  await ok(p, "add", "resend", "--title", "Resend email", "--parent", "email");
  await ok(p, "discard", "email");
  for (const id of ["email", "resend"]) {
    const r = await w(p, "show", id);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("no node");
  }
  const on = (await ok(p, "show", "onboarding")).out;
  expect(on).not.toContain("email");
  expect(on).not.toContain("ghost");
});

test("04.4 ghost words are frozen", async () => {
  const p = withRoot();
  card(p, "search", { title: "Search" });
  await ok(p, "add", "idx", "--title", "Search index", "--why", "fast", "--parent", "search");
  const n = lines(p).length;
  const r = await w(p, "add", "idx", "--title", "Other", "--why", "slow", "--parent", "search");
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("frozen");
  expect(lines(p).length).toBe(n);
  const s = (await ok(p, "show", "idx")).out;
  expect(s).toContain("Search index");
  expect(s).toContain("fast");
  expect(s).not.toContain("Other");
});

test("04.5 / 62.2 accept needs --actor you", async () => {
  const p = withRoot();
  await ok(p, "add", "audit", "--title", "Audit log", "--parent", "root");
  const n = lines(p).length;
  const r = await w(p, "accept", "audit");
  expect(r.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect((await ok(p, "show", "audit")).out).toContain("proposed");
  await ok(p, "accept", "audit", "--actor", "you");
  expect((await ok(p, "show", "audit")).out).not.toContain("proposed");
});

test("62.1 propose/accept appends exactly one event, earlier lines unchanged", async () => {
  const p = withRoot();
  card(p, "x1", { title: "X1" });
  const before = lines(p);
  const add = await ok(p, "add", "log", "--title", "Use a log", "--body", "Body here", "--why", "Why here");
  expect(add.out).toContain("proposed");
  const l1 = lines(p);
  expect(l1.length).toBe(before.length + 1);
  expect(l1.slice(0, before.length)).toEqual(before);
  const s = (await ok(p, "show", "log")).out;
  expect(s).toContain("Use a log");
  expect(s).toContain("Body here");
  expect(s).toContain("Why here");
  expect(s).toContain("proposed");
  await ok(p, "accept", "log", "--actor", "you");
  const l2 = lines(p);
  expect(l2.length).toBe(l1.length + 1);
  expect(l2.slice(0, l1.length)).toEqual(l1);
  const s2 = (await ok(p, "show", "log")).out;
  expect(s2).toContain("Use a log");
  expect(s2).toContain("Body here");
  expect(s2).toContain("Why here");
  expect(s2).not.toContain("proposed");
});

test("62.3 ghost words frozen: edit body, retitle, re-add", async () => {
  const p = withRoot();
  await ok(p, "add", "log", "--title", "Use a log");
  const n = lines(p).length;
  for (const args of [
    ["edit", "log", "--body", "new body"],
    ["retitle", "log", "Use an append-only log"],
    ["add", "log", "--title", "Different"],
  ]) {
    const r = await w(p, ...args);
    expect(r.code).not.toBe(0);
    expect(lines(p).length).toBe(n);
  }
  const s = (await ok(p, "show", "log")).out;
  expect(s).toContain("Use a log");
  expect(s).toContain("proposed");
});

test("62.4 retitle of real card keeps old title in log only", async () => {
  const p = withRoot();
  await ok(p, "add", "log", "--title", "Use a log");
  await ok(p, "accept", "log", "--actor", "you");
  const n = lines(p).length;
  const r = await ok(p, "retitle", "log", "Use an append-only log");
  expect(r.code).toBe(0);
  expect(lines(p).length).toBe(n + 1);
  const s = (await ok(p, "show", "log")).out;
  expect(s).toContain("Use an append-only log");
  expect(s).not.toContain("Use a log");
  expect(lines(p).join("\n")).toContain("Use a log");
  await ok(p, "edit", "log", "--body", "new body");
  const s2 = (await ok(p, "show", "log")).out;
  expect(s2).toContain("new body");
  expect(s2).toContain("Use an append-only log");
});

test("62.5 option, source, excerpt enter as ghosts", async () => {
  const p = withRoot();
  card(p, "c", { title: "C" });
  const e1 = lines(p).length;
  const o = await ok(p, "add", "c:o", "--kind", "option", "--title", "Opt", "--why_not", "no good");
  await ok(p, "link", "c:o", "c", "--type", "alternative_to");
  expect(o.out).toContain("proposed");
  expect(lines(p).length).toBe(e1 + 1 + 1);
  const s = await ok(p, "add", "src", "--kind", "source", "--title", "Src");
  expect(s.out).toContain("proposed");
  expect(lines(p).length).toBe(e1 + 3);
  // excerpt via plain add is refused (see 12.4); via quote it needs a conversation: seed one
  expect((await ok(p, "show", "c:o")).out).toContain("proposed");
  expect((await ok(p, "show", "src")).out).toContain("proposed");
  await ok(p, "accept", "c:o", "--actor", "you");
  const so = (await ok(p, "show", "c:o")).out;
  expect(so).not.toContain("proposed");
  expect(so).toContain("no good");
  expect((await ok(p, "show", "src")).out).toContain("proposed");
});

test("63.1 link to a ghost is held, live on accept with one link event", async () => {
  const p = withRoot();
  card(p, "storage", { title: "Storage" });
  await ok(p, "add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  await ok(p, "link", "sqlite", "storage", "--type", "depends_on", "--why", "basis");
  expect((await ok(p, "show", "sqlite")).out).toMatch(/depends_on\s+storage.*\(held\)/);
  expect((await ok(p, "show", "storage")).out).not.toContain("sqlite");
  await ok(p, "accept", "sqlite", "--actor", "you");
  expect((await ok(p, "show", "sqlite")).out).toMatch(/depends_on\s+storage\s+Storage\n/);
  expect((await ok(p, "show", "sqlite")).out).not.toContain("held");
  const links = events(p).filter((e) => e.type === "edge.added" && e.payload.type === "depends_on");
  expect(links.length).toBe(1);
});

test("63.2 accept ghost child accepts ghost parent, not depended-on ghost", async () => {
  const p = withRoot();
  card(p, "platform", { title: "Platform" });
  await ok(p, "add", "auth", "--title", "Auth", "--parent", "platform");
  await ok(p, "add", "magic", "--title", "Magic links", "--parent", "auth");
  await ok(p, "add", "email", "--title", "Email service", "--parent", "platform");
  await ok(p, "link", "magic", "email", "--type", "depends_on", "--why", "sends mail");
  await ok(p, "accept", "magic", "--actor", "you");
  const m = (await ok(p, "show", "magic")).out;
  expect(m).not.toContain("proposed");
  const a = (await ok(p, "show", "auth")).out;
  expect(a).not.toContain("proposed");
  expect(a).toContain("parent: platform");
  expect((await ok(p, "show", "email")).out).toContain("proposed");
  expect(m).toMatch(/depends_on\s+email.*\(ghost, held\)/);
});

test("63.3 accept takes own ghost options and sources; status+who allowed on ghost", async () => {
  const p = withRoot();
  card(p, "storage", { title: "Storage" });
  await ok(p, "add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  await ok(p, "add", "pg", "--kind", "option", "--title", "Use Postgres", "--why_not", "heavy");
  await ok(p, "link", "pg", "sqlite", "--type", "alternative_to");
  await ok(p, "add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "fast");
  await ok(p, "link", "sqlite", "bench", "--type", "supported_by");
  await ok(p, "edit", "sqlite", "--no-basis", "nothing to build on");
  await ok(p, "kill", "sqlite", "--revisit");
  const ed = await w(p, "edit", "sqlite", "--who", "you");
  expect(ed.code).toBe(0);
  const st = await w(p, "status", "sqlite", "decided");
  expect(st.code, st.err + st.out).toBe(0);
  await ok(p, "accept", "sqlite", "--actor", "you");
  const s = (await ok(p, "show", "sqlite")).out;
  expect(s).toContain("[decided]");
  expect(s).toContain("who: you");
  expect(s).not.toContain("proposed");
  expect(s).toMatch(/supported_by\s+bench\s+Benchmark notes\n/);
  expect(s).toContain("why not: heavy");
  expect((await ok(p, "show", "pg")).out).not.toContain("proposed");
  expect((await ok(p, "show", "bench")).out).not.toContain("proposed");
});

test("63.4 discarding ghost parent discards whole branch", async () => {
  const p = withRoot();
  card(p, "platform", { title: "Platform" });
  await ok(p, "add", "auth", "--title", "Auth", "--parent", "platform");
  await ok(p, "add", "magic", "--title", "Magic links", "--parent", "auth");
  await ok(p, "add", "pw", "--kind", "option", "--title", "Passwords", "--why_not", "weak");
  await ok(p, "link", "pw", "magic", "--type", "alternative_to");
  await ok(p, "discard", "auth");
  for (const id of ["auth", "magic", "pw"]) expect((await w(p, "show", id)).code).not.toBe(0);
  const s = (await ok(p, "show", "platform")).out;
  expect(s).not.toContain("proposed");
  expect(s).not.toContain("auth");
});

test("63.5 ghost changes no count of a real card until accepted", async () => {
  const p = withRoot();
  card(p, "storage", { title: "Storage" });
  card(p, "child", { title: "Child", parent: "storage" });
  const before = (await ok(p, "show", "storage")).out;
  await ok(p, "add", "sqlite", "--title", "Use SQLite", "--parent", "storage", "--status", "open");
  await ok(p, "add", "sqlite:o", "--kind", "option", "--title", "O", "--why_not", "x");
  await ok(p, "link", "sqlite:o", "sqlite", "--type", "alternative_to");
  const mid = (await ok(p, "show", "storage")).out;
  const rollup = (s: string) => s.split("\n").find((l) => l.startsWith("subtree:"));
  expect(rollup(mid)).toBe(rollup(before));
  expect(mid).not.toContain("stale");
  await ok(p, "accept", "sqlite", "--actor", "you");
  expect(rollup((await ok(p, "show", "storage")).out)).not.toBe(rollup(before));
  expect(rollup((await ok(p, "show", "storage")).out)).toContain("3 cards");
});

import { expect, test } from "bun:test";
import { chat, edge, msg, types } from "./f1-lib.ts";
import { mk } from "./lib.ts";

const REAL_DEC = { status: "decided", who: "me" };

test("04.1 agent card waits as ghost until accepted", async () => {
  const h = mk();
  h.card("checkout", { title: "Checkout flow", ...REAL_DEC });
  h.card("other", { title: "Other" });
  await h.ok("add", "other-ghost", "--title", "Other ghost");
  const n = h.count();
  const add = await h.w("add", "retry", "--title", "Retry payment", "--parent", "checkout");
  expect(add.code).toBe(0);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  expect(h.count()).toBe(n + 1);
  const ev = h.events().at(-1);
  expect(ev.type).toBe("node.proposed");
  expect(ev.payload.parent).toBe("checkout");
  const s = (await h.w("show", "retry")).out;
  expect(s).toContain("proposed");
  expect(s).toContain("parent: checkout");
  const acc = await h.w("accept", "retry", "--actor", "you");
  expect(acc.code).toBe(0);
  expect(h.count()).toBe(n + 2);
  expect(h.events().at(-1).type).toBe("change.accepted");
  const s2 = (await h.w("show", "retry")).out;
  expect(s2).not.toContain("proposed");
  expect(s2).toContain("parent: checkout");
  expect((await h.w("show", "other-ghost")).out).toContain("proposed");
});

async function refundsSetup() {
  const h = mk();
  h.card("payments", { title: "Payments" });
  h.card("fraud", { title: "Fraud rules" });
  await h.ok("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await h.ok("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await h.ok("link", "partial", "fraud", "--type", "depends_on", "--why", "needs rules");
  await h.ok("add", "partial:opt0", "--kind", "option", "--title", "Opt", "--why_not", "no");
  await h.ok("link", "partial:opt0", "partial", "--type", "alternative_to");
  await h.ok("add", "src", "--kind", "source", "--title", "Src", "--finding", "f");
  await h.ok("link", "partial", "src", "--type", "supported_by");
  return h;
}

test("04.2 accepting ghost child accepts ghost parent; held link goes live", async () => {
  const h = await refundsSetup();
  const before = (await h.w("show", "partial")).out;
  expect(before).toMatch(/depends_on\s+fraud.*\(held\)/);
  const n = h.count();
  await h.ok("accept", "partial", "--actor", "you");
  const newTypes = types(h).slice(n);
  expect(newTypes.every((t) => t === "change.accepted")).toBe(true);
  expect(newTypes.includes("edge.added")).toBe(false);
  const r = (await h.w("show", "refunds")).out;
  expect(r).not.toContain("proposed");
  const p = (await h.w("show", "partial")).out;
  expect(p).not.toContain("proposed");
  expect(p).toMatch(/depends_on\s+fraud/);
  expect(p).not.toMatch(/depends_on\s+fraud.*held/);
  expect(p).not.toContain("held");
  expect(p).not.toContain("ghost");
  expect((await h.w("show", "partial:opt0")).out).not.toContain("proposed");
  expect((await h.w("show", "src")).out).not.toContain("proposed");
});

test("04.3 discarding ghost parent drops ghost children", async () => {
  const h = mk();
  h.card("onb", { title: "Onboarding" });
  await h.ok("add", "email", "--title", "Email verification", "--parent", "onb");
  await h.ok("add", "resend", "--title", "Resend email", "--parent", "email");
  const d = await h.w("discard", "email");
  expect(d.code).toBe(0);
  const a = await h.w("show", "email");
  const b = await h.w("show", "resend");
  expect(a.code).not.toBe(0);
  expect(b.code).not.toBe(0);
  expect(a.err).toMatch(/no node #\w+ in the map/);
  expect(b.err).toMatch(/no node #\w+ in the map/);
  const o = (await h.w("show", "onb")).out;
  expect(o).not.toContain("email");
  expect(o).not.toContain("resend");
});

test("04.4 ghost words are frozen", async () => {
  const h = mk();
  h.card("search", { title: "Search" });
  await h.ok("add", "idx", "--title", "First title", "--why", "first why", "--parent", "search");
  const n = h.count();
  const r = await h.w("add", "idx", "--title", "Second title", "--why", "second why", "--parent", "search");
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/frozen/);
  expect(h.count()).toBe(n);
  const s = (await h.w("show", "idx")).out;
  expect(s).toContain("First title");
  expect(s).toContain("first why");
  expect(s).not.toContain("Second");
});

test("04.5 accept without --actor you fails", async () => {
  const h = mk();
  h.card("base", { title: "Base" });
  await h.ok("add", "audit", "--title", "Audit log", "--parent", "base");
  const n = h.count();
  const r = await h.w("accept", "audit");
  expect(r.code).not.toBe(0);
  expect(h.count()).toBe(n);
  expect((await h.w("show", "audit")).out).toContain("proposed");
  const ok = await h.w("accept", "audit", "--actor", "you");
  expect(ok.code).toBe(0);
  expect((await h.w("show", "audit")).out).not.toContain("proposed");
});

test("06.1 new excerpt stages as ghost with pending link", async () => {
  const h = mk();
  h.card("dec", { title: "Decided card", why: "because", ...REAL_DEC });
  chat(h, "talk", [msg("spoken", "we keep one log per conversation")]);
  const before = h.count();
  const r = await h.w("quote", "dec", "talk", "one log per conversation");
  expect(r.code).toBe(0);
  expect(r.out).toContain("proposed");
  expect(r.out).not.toContain("added");
  expect(h.count()).toBe(before + 1);
  const ex = (await h.w("show", "dec:ex0")).out;
  expect(ex).toContain("proposed");
  const s = (await h.w("show", "dec")).out;
  expect(s).toMatch(/supported_by\s+dec:ex0.*(held|ghost)/);
  expect(s).toContain("[decided]");
  expect(s).toContain("Decided card");
  expect(s).toContain("why: because");
  expect(s).not.toContain("stale");
});

test("08.1 remove takes subtree, restore brings back", async () => {
  const h = mk();
  h.card("auth", { title: "Auth", ...REAL_DEC });
  h.card("login", { title: "Login", parent: "auth", ...REAL_DEC });
  h.card("session", { title: "Session", parent: "auth", ...REAL_DEC });
  h.card("audit", { title: "Audit" });
  edge(h, "login", "audit", "depends_on", "needs audit");
  const n = h.count();
  const r = await h.w("remove", "auth", "--actor", "you");
  expect(r.code).toBe(0);
  expect(h.count()).toBe(n + 1);
  for (const id of ["auth", "login", "session"]) expect((await h.w("show", id)).code).not.toBe(0);
  const root = (await h.w("show", "root")).out;
  for (const id of ["auth", "login", "session"]) expect(root).not.toContain(id);
  const rem = (await h.w("removed")).out;
  expect(rem).toContain("auth");
  expect(rem).toContain("login");
  expect(rem).toContain("session");
  const audit = (await h.w("show", "audit")).out;
  expect(audit).not.toContain("login");
  const rs = await h.w("restore", "auth", "--actor", "you");
  expect(rs.code).toBe(0);
  const a = (await h.w("show", "auth")).out;
  expect(a).toMatch(/refines\s+login/);
  expect(a).toMatch(/refines\s+session/);
  const audit2 = (await h.w("show", "audit")).out;
  expect(audit2).toContain("login");
  expect((await h.w("show", "login")).out).toMatch(/depends_on\s+audit/);
  expect((await h.w("removed")).out).toContain("no card is removed");
});

test("08.2 remove with reparent", async () => {
  const h = mk();
  h.card("platform", { title: "Platform" });
  h.card("auth", { title: "Auth", parent: "platform" });
  h.card("login", { title: "Login", parent: "auth" });
  h.card("session", { title: "Session", parent: "auth" });
  const r = await h.w("remove", "auth", "--actor", "you", "--reparent");
  expect(r.code).toBe(0);
  expect((await h.w("show", "auth")).code).not.toBe(0);
  const p = (await h.w("show", "platform")).out;
  expect(p).toMatch(/<- refines\s+login/);
  expect(p).toMatch(/<- refines\s+session/);
  expect(p).not.toMatch(/<- refines\s+auth/);
  const rs = await h.w("restore", "auth", "--actor", "you");
  expect(rs.code).toBe(0);
  const p2 = (await h.w("show", "platform")).out;
  expect(p2).toMatch(/<- refines\s+auth/);
  expect(p2).not.toMatch(/<- refines\s+login/);
  expect(p2).not.toMatch(/<- refines\s+session/);
  const a = (await h.w("show", "auth")).out;
  expect(a).toMatch(/<- refines\s+login/);
  expect(a).toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both ends are back", async () => {
  const h = mk();
  h.card("login", { title: "Login" });
  h.card("session", { title: "Session" });
  edge(h, "login", "session", "depends_on", "needs session");
  expect((await h.w("remove", "login", "--actor", "you")).code).toBe(0);
  expect((await h.w("remove", "session", "--actor", "you")).code).toBe(0);
  expect((await h.w("restore", "login", "--actor", "you")).code).toBe(0);
  const l = await h.w("show", "login");
  expect(l.code).toBe(0);
  expect(l.out).not.toMatch(/depends_on\s+session/);
  expect((await h.w("restore", "session", "--actor", "you")).code).toBe(0);
  expect((await h.w("show", "login")).out).toMatch(/depends_on\s+session/);
});

test("08.4 removed id stays taken; cited source stays", async () => {
  const h = mk();
  h.card("login", { title: "Login" });
  h.card("billing", { title: "Billing" });
  h.seed("node.added", { id: "rfc-6749", kind: "source", title: "RFC 6749", finding: "oauth" });
  edge(h, "login", "rfc-6749", "supported_by");
  edge(h, "billing", "rfc-6749", "supported_by");
  expect((await h.w("remove", "login", "--actor", "you")).code).toBe(0);
  const s = (await h.w("show", "rfc-6749")).out;
  expect(s).toContain("RFC 6749");
  expect(s).toMatch(/<- supported_by\s+billing/);
  const n = h.count();
  const add = await h.w("add", "login", "--title", "New login");
  expect(add.code).not.toBe(0);
  expect(add.err).toMatch(/restore #login/);
  expect(h.count()).toBe(n);
  expect(h.events().some((e) => e.type === "node.proposed")).toBe(false);
});

test("08.5 remove refuses without --actor you", async () => {
  const h = mk();
  h.card("login", { title: "Login" });
  const n = h.count();
  const r = await h.w("remove", "login");
  expect(r.code).not.toBe(0);
  expect((await h.w("show", "login")).code).toBe(0);
  expect(h.count()).toBe(n);
});

test("08.6 restore refuses without --actor you", async () => {
  const h = mk();
  h.card("login", { title: "Login" });
  expect((await h.w("remove", "login", "--actor", "you")).code).toBe(0);
  const n = h.count();
  const r = await h.w("restore", "login");
  expect(r.code).not.toBe(0);
  expect((await h.w("show", "login")).code).not.toBe(0);
  expect(h.count()).toBe(n);
});

test("62.1 propose and accept", async () => {
  const h = mk();
  h.card("a", { title: "A" });
  const before = h.logText();
  const r = await h.w("add", "c1", "--title", "T1", "--body", "B1", "--why", "W1");
  expect(r.out).toContain("proposed");
  const after = h.logText();
  expect(after.startsWith(before)).toBe(true);
  expect(after.slice(before.length).trim().split("\n")).toHaveLength(1);
  const s = (await h.w("show", "c1")).out;
  for (const t of ["T1", "B1", "W1", "proposed"]) expect(s).toContain(t);
  const mid = h.logText();
  expect((await h.w("accept", "c1", "--actor", "you")).code).toBe(0);
  const end = h.logText();
  expect(end.startsWith(mid)).toBe(true);
  expect(end.slice(mid.length).trim().split("\n")).toHaveLength(1);
  const s2 = (await h.w("show", "c1")).out;
  for (const t of ["T1", "B1", "W1"]) expect(s2).toContain(t);
  expect(s2).not.toContain("proposed");
});

test("62.2 accept without claim refuses", async () => {
  const h = mk();
  await h.ok("add", "c1", "--title", "T1");
  const n = h.count();
  expect((await h.w("accept", "c1")).code).not.toBe(0);
  expect(h.count()).toBe(n);
  expect((await h.w("show", "c1")).out).toContain("proposed");
  await h.ok("accept", "c1", "--actor", "you");
  expect((await h.w("show", "c1")).out).not.toContain("proposed");
});

test("62.3 ghost words frozen", async () => {
  const h = mk();
  await h.ok("add", "c1", "--title", "Use a log");
  const n = h.count();
  const e = await h.w("edit", "c1", "--body", "new body");
  expect(e.code).not.toBe(0);
  expect(h.count()).toBe(n);
  const t = await h.w("retitle", "c1", "Use an append-only log");
  expect(t.code).not.toBe(0);
  expect(h.count()).toBe(n);
  const a = await h.w("add", "c1", "--title", "Different");
  expect(a.code).not.toBe(0);
  expect(h.count()).toBe(n);
  const s = (await h.w("show", "c1")).out;
  expect(s).toContain("Use a log");
  expect(s).toContain("proposed");
});

test("62.4 retitle keeps old title in log", async () => {
  const h = mk();
  await h.ok("add", "c1", "--title", "Use a log");
  await h.ok("accept", "c1", "--actor", "you");
  const n = h.count();
  const r = await h.w("retitle", "c1", "Use an append-only log");
  expect(r.code).toBe(0);
  expect(h.count()).toBe(n + 1);
  const s = (await h.w("show", "c1")).out;
  expect(s).toContain("Use an append-only log");
  expect(s).not.toContain("Use a log");
  expect(h.logText()).toContain('"title":"Use a log"');
  const e = await h.w("edit", "c1", "--body", "the new body");
  expect(e.code).toBe(0);
  const s2 = (await h.w("show", "c1")).out;
  expect(s2).toContain("the new body");
  expect(s2).toContain("Use an append-only log");
});

test("62.5 option, source, excerpt enter as ghosts", async () => {
  const h = mk();
  await h.ok("add", "c1", "--title", "T1");
  await h.ok("accept", "c1", "--actor", "you");
  chat(h, "talk", [msg("spoken", "we keep one log per conversation")]);
  let n = h.count();
  const o = await h.w("add", "c1:opt0", "--kind", "option", "--title", "Opt", "--why_not", "too slow");
  expect(o.out).toContain("proposed");
  expect(h.count()).toBe(n + 1);
  n = h.count();
  const s = await h.w("add", "src1", "--kind", "source", "--title", "Src", "--finding", "found");
  expect(s.out).toContain("proposed");
  expect(h.count()).toBe(n + 1);
  n = h.count();
  const x = await h.w("quote", "c1", "talk", "one log per conversation");
  expect(x.out).toContain("proposed");
  expect(h.count()).toBe(n + 1);
  const so = (await h.w("show", "c1:opt0")).out;
  expect(so).toContain("proposed");
  expect(so).toContain("too slow");
  const ss = (await h.w("show", "src1")).out;
  expect(ss).toContain("proposed");
  expect(ss).toContain("found");
  const sx = (await h.w("show", "c1:ex0")).out;
  expect(sx).toContain("proposed");
  expect(sx).toContain("one log per conversation");
  const acc = await h.w("accept", "c1:opt0", "--actor", "you");
  expect(acc.code).toBe(0);
  const so2 = (await h.w("show", "c1:opt0")).out;
  expect(so2).not.toContain("proposed");
  expect(so2).toContain("too slow");
  expect((await h.w("show", "src1")).out).toContain("proposed");
  expect((await h.w("show", "c1:ex0")).out).toContain("proposed");
});

test("63.1 link to ghost is held and goes live on accept with no extra event", async () => {
  const h = mk();
  h.card("storage", { title: "Storage" });
  await h.ok("add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  const lk = await h.w("link", "sqlite", "storage", "--type", "depends_on", "--why", "basis");
  expect(lk.err).toBe("");
  expect(lk.code).toBe(0);
  expect((await h.w("show", "sqlite")).out).toMatch(/depends_on\s+storage.*\(held\)/);
  expect((await h.w("show", "storage")).out).not.toMatch(/<- depends_on\s+sqlite/);
  await h.ok("accept", "sqlite", "--actor", "you");
  const s = (await h.w("show", "sqlite")).out;
  expect(s).toMatch(/depends_on\s+storage/);
  expect(s).not.toMatch(/depends_on\s+storage.*held/);
  expect(h.events().filter((e) => e.type === "edge.added" && e.payload.type === "depends_on")).toHaveLength(1);
});

test("63.2 accept takes ghost parent, not ghost dependency", async () => {
  const h = mk();
  h.card("platform", { title: "Platform" });
  await h.ok("add", "auth", "--title", "Auth", "--parent", "platform");
  await h.ok("add", "magic", "--title", "Magic links", "--parent", "auth");
  await h.ok("add", "email", "--title", "Email service", "--parent", "platform");
  await h.ok("link", "magic", "email", "--type", "depends_on", "--why", "sends mail");
  await h.ok("accept", "magic", "--actor", "you");
  expect((await h.w("show", "magic")).out).not.toMatch(/proposed/);
  const a = (await h.w("show", "auth")).out;
  expect(a).not.toMatch(/proposed/);
  expect(a).toContain("parent: platform");
  expect((await h.w("show", "email")).out).toContain("proposed");
  expect((await h.w("show", "magic")).out).toMatch(/depends_on\s+email.*held/);
});

test("63.3 accept takes options and sources; status+who work on ghost", async () => {
  const h = mk();
  h.card("storage", { title: "Storage", ...REAL_DEC });
  await h.ok("add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  await h.ok("add", "pg", "--kind", "option", "--title", "Use Postgres", "--why_not", "heavy");
  await h.ok("link", "pg", "sqlite", "--type", "alternative_to");
  await h.ok("add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "fast");
  await h.ok("link", "sqlite", "bench", "--type", "supported_by");
  const w = await h.w("edit", "sqlite", "--who", "you");
  expect(w.code).toBe(0);
  h.card("base", { title: "Base", ...REAL_DEC });
  await h.ok("link", "sqlite", "base", "--type", "depends_on", "--why", "basis");
  const k = await h.w("kill", "sqlite", "--revisit");
  const st = await h.w("status", "sqlite", "decided");
  expect(st.err + st.out).not.toMatch(/refused: .*ghost|is proposed/);
  expect(st.code).toBe(0);
  await h.ok("accept", "sqlite", "--actor", "you");
  const s = (await h.w("show", "sqlite")).out;
  expect(s).toContain("[decided]");
  expect(s).not.toContain("proposed");
  expect(s).toMatch(/supported_by\s+bench/);
  expect(s).not.toContain("held");
  const o = (await h.w("show", "pg")).out;
  expect(o).not.toContain("proposed");
  expect(o).toContain("heavy");
  expect((await h.w("show", "bench")).out).not.toContain("proposed");
  void k;
  const ev = h.events().find((e) => e.type === "status.set" || e.type.startsWith("status"));
  expect(JSON.stringify(h.events())).toContain('"who"');
});

test("63.4 discarding ghost parent discards branch", async () => {
  const h = mk();
  h.card("platform", { title: "Platform" });
  await h.ok("add", "auth", "--title", "Auth", "--parent", "platform");
  await h.ok("add", "magic", "--title", "Magic links", "--parent", "auth");
  await h.ok("add", "pw", "--kind", "option", "--title", "Passwords", "--why_not", "weak");
  await h.ok("link", "pw", "magic", "--type", "alternative_to");
  expect((await h.w("discard", "auth")).code).toBe(0);
  for (const id of ["auth", "magic", "pw"]) expect((await h.w("show", id)).code).not.toBe(0);
  const p = (await h.w("show", "platform")).out;
  expect(p).not.toContain("proposed");
  expect(p).not.toMatch(/refines\s+auth/);
  expect(p).not.toContain("ghost");
});

test("63.5 a ghost changes no count of a real card", async () => {
  const h = mk();
  h.card("storage", { title: "Storage", status: "open" });
  h.card("child", { title: "Child", parent: "storage", ...REAL_DEC });
  const before = (await h.w("show", "storage")).out;
  expect(before).not.toMatch(/stale|paused|waiting/);
  await h.ok("add", "sqlite", "--title", "Use SQLite", "--parent", "storage", "--status", "open");
  await h.ok("add", "sqlite:opt0", "--kind", "option", "--title", "O", "--why_not", "x");
  await h.ok("link", "sqlite:opt0", "sqlite", "--type", "alternative_to");
  const after = (await h.w("show", "storage")).out;
  const line = (t: string) => t.split("\n").find((l) => l.startsWith("subtree"));
  expect(line(after)).toBe(line(before));
  expect(after).not.toMatch(/stale|paused|waiting/);
  await h.ok("accept", "sqlite", "--actor", "you");
  const acc = (await h.w("show", "storage")).out;
  expect(line(acc)).not.toBe(line(before));
  expect(line(acc)).toContain("3 cards");
});

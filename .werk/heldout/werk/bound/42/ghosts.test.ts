import { expect, test } from "bun:test";
import { mk, readFileSync, writeFileSync, mkdirSync, join } from "./h.ts";

const first = (s: string) => s.split("\n")[0]!;
const isGhost = (s: string) => /\bproposed\b/.test(first(s));

test("[04.1] a new card waits as a ghost until accepted", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("checkout", "Checkout flow", "root");
  const n0 = h.count();
  const r = await h.w("add", "retry", "--title", "Retry payment", "--parent", "checkout");
  expect(r.out).toContain("proposed");
  expect(r.out).not.toContain("added");
  expect(h.count()).toBe(n0 + 1);
  const ev = h.events().at(-1)!;
  expect(ev.type).toBe("node.proposed");
  expect(ev.payload.parent).toBe("checkout");
  await h.w("add", "other", "--title", "Other ghost");
  const s = await h.out("show", "retry");
  expect(isGhost(s)).toBe(true);
  expect(s).toContain("parent: checkout  Checkout flow");
  const n1 = h.count();
  const a = await h.w("accept", "retry", "--actor", "you");
  expect(a.code).toBe(0);
  expect(h.count()).toBe(n1 + 1);
  expect(h.events().at(-1)!.type).toBe("change.accepted");
  const s2 = await h.out("show", "retry");
  expect(isGhost(s2)).toBe(false);
  expect(s2).toContain("parent: checkout  Checkout flow");
  expect(isGhost(await h.out("show", "other"))).toBe(true);
});

test("[04.2] accepting a ghost child accepts its ghost parent; held link goes live", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("payments", "Payments", "root");
  h.real("fraud", "Fraud rules", "root");
  await h.w("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await h.w("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  const l = await h.w("link", "partial", "fraud", "--type", "depends_on", "--why", "fraud limits");
  expect(l.code).toBe(0);
  await h.w("add", "opt", "--kind", "option", "--title", "Full only", "--why_not", "too coarse");
  await h.w("link", "opt", "partial", "--type", "alternative_to");
  await h.w("add", "src", "--kind", "source", "--title", "Notes", "--finding", "f");
  await h.w("link", "partial", "src", "--type", "supported_by");
  const s = await h.out("show", "partial");
  expect(s).toMatch(/depends_on\s+fraud\s+Fraud rules\s+\(held\)/);
  const n = h.count();
  const a = await h.w("accept", "partial", "--actor", "you");
  expect(a.code).toBe(0);
  const newEv = h.events().slice(n);
  expect(newEv.length).toBeGreaterThan(0);
  expect(newEv.every((e) => e.type === "change.accepted")).toBe(true);
  expect(newEv.some((e) => e.type.startsWith("edge"))).toBe(false);
  expect(isGhost(await h.out("show", "refunds"))).toBe(false);
  const s2 = await h.out("show", "partial");
  expect(isGhost(s2)).toBe(false);
  expect(isGhost(await h.out("show", "opt"))).toBe(false);
  expect(isGhost(await h.out("show", "src"))).toBe(false);
  expect(s2).toMatch(/depends_on\s+fraud\s+Fraud rules\s*\n/);
  expect(s2).not.toMatch(/depends_on\s+fraud\s+Fraud rules\s+\(held\)/);
});

test("[04.3] discarding a ghost parent drops its ghost children", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("onb", "Onboarding", "root");
  await h.w("add", "ev", "--title", "Email verification", "--parent", "onb");
  await h.w("add", "re", "--title", "Resend email", "--parent", "ev");
  const d = await h.w("discard", "ev");
  expect(d.code).toBe(0);
  for (const id of ["ev", "re"]) {
    const r = await h.w("show", id);
    expect(r.code).not.toBe(0);
    console.log("show discarded:", all(r));
    expect(all(r)).toMatch(/no node|not in the map|unknown/i);
  }
  const o = await h.out("show", "onb");
  expect(o).not.toMatch(/<- refines/);
});
const all = (r: { out: string; err: string }) => r.out + r.err;

test("[04.4] ghost words are frozen", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("search", "Search", "root");
  await h.w("add", "idx", "--title", "First title", "--why", "first why", "--parent", "search");
  const n = h.count();
  const r = await h.w("add", "idx", "--title", "Second title", "--why", "second why", "--parent", "search");
  console.log("re-add:", all(r));
  expect(r.code).not.toBe(0);
  expect(all(r).toLowerCase()).toContain("frozen");
  expect(h.count()).toBe(n);
  const s = await h.out("show", "idx");
  expect(s).toContain("First title");
  expect(s).toContain("first why");
});

test("[04.5] accept needs --actor you", async () => {
  const h = mk();
  h.real("root", "Root");
  await h.w("add", "audit", "--title", "Audit log", "--parent", "root");
  const n = h.count();
  const r = await h.w("accept", "audit");
  expect(r.code).not.toBe(0);
  expect(h.count()).toBe(n);
  expect(isGhost(await h.out("show", "audit"))).toBe(true);
  const r2 = await h.w("accept", "audit", "--actor", "you");
  expect(r2.code).toBe(0);
  expect(isGhost(await h.out("show", "audit"))).toBe(false);
});

function withChat(h: ReturnType<typeof mk>) {
  mkdirSync(join(h.p.dir, ".werk", "chats"), { recursive: true });
  const m = (kind: string, text: string, speaker: string) =>
    JSON.stringify({ speaker, at: "2026-01-01T00:00:00Z", session: "sess1", kind, text });
  writeFileSync(
    join(h.p.dir, ".werk", "chats", "c1.jsonl"),
    [m("tool_result", "tool says things", "agent"), m("spoken", "we keep one log per conversation", "person"), ""].join("\n"),
  );
}

test("[06.1][06.2] a new excerpt stages as a ghost and goes live on accept", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("dec", "Decided card", "root");
  h.decide("dec");
  withChat(h);
  const before = await h.out("show", "dec");
  const r = await h.w("quote", "dec", "c1", "one log per conversation");
  expect(r.code).toBe(0);
  expect(r.out).toContain("proposed");
  expect(r.out).not.toContain("added");
  const ex = "dec:ex0";
  expect(isGhost(await h.out("show", ex))).toBe(true);
  const s = await h.out("show", "dec");
  console.log("decided card with ghost excerpt:\n", s);
  expect(s).toMatch(/supported_by\s+dec:ex0.*\(ghost, held\)/);
  expect(s).toContain("[decided]");
  expect(first(s)).toBe(first(before));
  const a = await h.w("accept", ex, "--actor", "you");
  expect(a.code).toBe(0);
  expect(isGhost(await h.out("show", ex))).toBe(false);
  const s2 = await h.out("show", "dec");
  expect(s2).toMatch(/supported_by\s+dec:ex0/);
  expect(s2).not.toMatch(/supported_by\s+dec:ex0.*held/);
  expect(s2).toMatch(/Say\n\s+dec:ex0\s+person: "one log per conversation"/);
  expect(h.events().filter((e) => e.type === "edge.added").length).toBe(0);
});

test("[62.1] propose and accept; the log only grows at the end", async () => {
  const h = mk();
  h.real("root", "Root");
  const snap = () => h.lines();
  const before = snap();
  const r = await h.w("add", "c", "--title", "T", "--body", "the body", "--why", "the why");
  expect(r.out).toContain("proposed");
  const after = snap();
  expect(after.length).toBe(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const s = await h.out("show", "c");
  for (const t of ["T", "the body", "the why"]) expect(s).toContain(t);
  expect(isGhost(s)).toBe(true);
  const a = await h.w("accept", "c", "--actor", "you");
  expect(a.code).toBe(0);
  const after2 = snap();
  expect(after2.length).toBe(after.length + 1);
  expect(after2.slice(0, after.length)).toEqual(after);
  const s2 = await h.out("show", "c");
  for (const t of ["T", "the body", "the why"]) expect(s2).toContain(t);
  expect(isGhost(s2)).toBe(false);
});

test("[62.2] accept without the person's claim refuses", async () => {
  const h = mk();
  h.real("root", "Root");
  await h.w("add", "c", "--title", "T");
  const n = h.count();
  const r = await h.w("accept", "c");
  expect(r.code).not.toBe(0);
  expect(h.count()).toBe(n);
  expect(isGhost(await h.out("show", "c"))).toBe(true);
  expect((await h.w("accept", "c", "--actor", "you")).code).toBe(0);
  expect(isGhost(await h.out("show", "c"))).toBe(false);
});

test("[62.3] ghost words are frozen", async () => {
  const h = mk();
  h.real("root", "Root");
  await h.w("add", "c", "--title", "Use a log");
  let n = h.count();
  const e = await h.w("edit", "c", "--body", "new body");
  expect(e.code).not.toBe(0);
  expect(h.count()).toBe(n);
  const t = await h.w("retitle", "c", "Use an append-only log");
  expect(t.code).not.toBe(0);
  expect(h.count()).toBe(n);
  const a = await h.w("add", "c", "--title", "Different");
  expect(a.code).not.toBe(0);
  expect(h.count()).toBe(n);
  const s = await h.out("show", "c");
  expect(s).toContain("Use a log");
  expect(s).not.toContain("append-only");
  expect(isGhost(s)).toBe(true);
});

test("[62.4] retitle on a real card keeps the old title in the log", async () => {
  const h = mk();
  h.real("root", "Root");
  await h.w("add", "c", "--title", "Use a log");
  await h.w("accept", "c", "--actor", "you");
  const n = h.count();
  const r = await h.w("retitle", "c", "Use an append-only log");
  expect(r.code).toBe(0);
  expect(h.count()).toBe(n + 1);
  const s = await h.out("show", "c");
  expect(s).toContain("Use an append-only log");
  expect(s).not.toContain("Use a log");
  expect(readFileSync(h.logFile, "utf8")).toContain("Use a log");
  const e = await h.w("edit", "c", "--body", "new body text");
  expect(e.code).toBe(0);
  const s2 = await h.out("show", "c");
  expect(s2).toContain("new body text");
  expect(s2).toContain("Use an append-only log");
});

test("[62.5] option, source, excerpt enter as ghosts", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("c", "Card", "root");
  withChat(h);
  let n = h.count();
  const o = await h.w("add", "o", "--kind", "option", "--title", "Opt", "--why_not", "too slow");
  expect(o.out).toContain("proposed");
  expect(h.count()).toBe(++n);
  const s = await h.w("add", "s", "--kind", "source", "--title", "Src", "--url", "http://x");
  expect(s.out).toContain("proposed");
  expect(h.count()).toBe(++n);
  const q = await h.w("quote", "c", "c1", "one log per conversation");
  expect(q.out).toContain("proposed");
  expect(h.count()).toBe(++n);
  for (const id of ["o", "s", "c:ex0"]) {
    const t = await h.out("show", id);
    expect(isGhost(t)).toBe(true);
  }
  expect(await h.out("show", "o")).toContain("why not: too slow");
  expect((await h.w("accept", "o", "--actor", "you")).code).toBe(0);
  const t = await h.out("show", "o");
  expect(isGhost(t)).toBe(false);
  expect(t).toContain("why not: too slow");
  expect(isGhost(await h.out("show", "s"))).toBe(true);
  expect(isGhost(await h.out("show", "c:ex0"))).toBe(true);
});

test("[63.1] link to a ghost is held, goes live on accept, no extra link event", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("storage", "Storage", "root");
  h.real("basis", "Basis", "root");
  await h.w("add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  await h.w("link", "sqlite", "basis", "--type", "depends_on", "--why", "basis");
  const s = await h.out("show", "sqlite");
  expect(s).toMatch(/-> depends_on\s+basis\s+Basis\s+\(held\)/);
  const st = await h.out("show", "basis");
  expect(st).toMatch(/<- depends_on\s+sqlite.*\(ghost, held\)/);
  await h.w("accept", "sqlite", "--actor", "you");
  const s2 = await h.out("show", "sqlite");
  expect(s2).toMatch(/-> depends_on\s+basis\s+Basis\s*\n/);
  expect(s2).not.toMatch(/depends_on.*\(held\)/);
  expect(h.events().filter((e) => e.type === "edge.added" && e.payload.type === "depends_on").length).toBe(1);
});

test("[63.2] accept takes ghost parent but not a ghost it depends on", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("platform", "Platform", "root");
  await h.w("add", "auth", "--title", "Auth", "--parent", "platform");
  await h.w("add", "ml", "--title", "Magic links", "--parent", "auth");
  await h.w("add", "email", "--title", "Email service", "--parent", "platform");
  await h.w("link", "ml", "email", "--type", "depends_on", "--why", "sends mail");
  await h.w("accept", "ml", "--actor", "you");
  expect(isGhost(await h.out("show", "ml"))).toBe(false);
  const a = await h.out("show", "auth");
  expect(isGhost(a)).toBe(false);
  expect(a).toContain("parent: platform  Platform");
  expect(isGhost(await h.out("show", "email"))).toBe(true);
  expect(await h.out("show", "ml")).toMatch(/depends_on\s+email\s+Email service\s+\(ghost, held\)/);
});

test("[63.3] accept takes the card's ghost options and sources", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("storage", "Storage", "root");
  h.real("basis", "Basis", "root");
  h.decide("basis");
  h.decide("storage");
  await h.w("add", "sq", "--title", "Use SQLite", "--parent", "storage");
  await h.w("add", "pg", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server");
  await h.w("link", "pg", "sq", "--type", "alternative_to");
  await h.w("add", "bench", "--kind", "source", "--title", "Benchmark notes");
  await h.w("link", "sq", "bench", "--type", "supported_by");
  const e1 = await h.w("edit", "sq", "--who", "you");
  expect(e1.code).toBe(0);
  await h.w("link", "sq", "basis", "--type", "depends_on", "--why", "basis");
  await h.w("kill", "sq", "--revisit");
  const d = await h.w("status", "sq", "decided");
  console.log("decide ghost:", all(d));
  expect(d.code).toBe(0);
  await h.w("accept", "sq", "--actor", "you");
  const s = await h.out("show", "sq");
  expect(isGhost(s)).toBe(false);
  expect(first(s)).toContain("[decided]");
  expect(s).toContain("who: you");
  const pg = await h.out("show", "pg");
  expect(isGhost(pg)).toBe(false);
  expect(pg).toContain("why not: needs a server");
  expect(isGhost(await h.out("show", "bench"))).toBe(false);
  expect(s).toMatch(/supported_by\s+bench\s+Benchmark notes\s*\n/);
});

test("[63.4] discarding a ghost parent discards its branch", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("platform", "Platform", "root");
  await h.w("add", "auth", "--title", "Auth", "--parent", "platform");
  await h.w("add", "ml", "--title", "Magic links", "--parent", "auth");
  await h.w("add", "pw", "--kind", "option", "--title", "Passwords", "--why_not", "weak");
  await h.w("link", "pw", "ml", "--type", "alternative_to");
  expect((await h.w("discard", "auth")).code).toBe(0);
  for (const id of ["auth", "ml", "pw"]) expect((await h.w("show", id)).code).not.toBe(0);
  const p = await h.out("show", "platform");
  expect(first(p)).not.toContain("proposed");
  expect(p).not.toMatch(/<- refines/);
});

test("[63.5] a ghost changes no count of a real card", async () => {
  const h = mk();
  h.real("root", "Root");
  h.real("storage", "Storage", "root");
  h.real("child", "Child", "storage");
  h.decide("child");
  const before = await h.out("show", "storage");
  const sub = (s: string) => s.split("\n").find((l) => l.startsWith("subtree:"));
  const beforeSub = sub(before);
  await h.w("add", "sq", "--title", "Use SQLite", "--parent", "storage", "--status", "open");
  await h.w("add", "o", "--kind", "option", "--title", "O", "--why_not", "x");
  await h.w("link", "o", "sq", "--type", "alternative_to");
  const mid = await h.out("show", "storage");
  expect(sub(mid)).toBe(beforeSub);
  expect(mid).not.toMatch(/stale|paused/);
  await h.w("accept", "sq", "--actor", "you");
  const after = await h.out("show", "storage");
  expect(sub(after)).not.toBe(beforeSub);
  console.log(beforeSub, "->", sub(after));
});

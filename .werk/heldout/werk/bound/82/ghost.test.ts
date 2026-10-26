import { expect, test } from "bun:test";
import { all, card, chat, events, freshProject, logLines, logText, root, seed, w } from "./helpers.ts";

const real = (p: ReturnType<typeof freshProject>, id: string, title: string, f: Record<string, unknown> = {}) =>
  card(p, id, { title, status: "decided", who: "me", ...f });

test("[04.1] a new card waits as a ghost until the person accepts it", async () => {
  const p = freshProject();
  root(p);
  real(p, "checkout", "Checkout flow");
  await w(p, "add", "other", "--title", "Other ghost", "--parent", "checkout");
  const before = logLines(p).length;
  const add = await w(p, "add", "retry", "--title", "Retry payment", "--parent", "checkout");
  expect(all(add)).toContain("proposed");
  expect(all(add)).not.toContain("added");
  expect(logLines(p).length).toBe(before + 1);
  const ev = events(p).at(-1);
  expect(ev.type).toBe("node.proposed");
  expect(ev.payload.parent).toBe("checkout");
  const shown = all(await w(p, "show", "retry"));
  expect(shown).toContain("proposed");
  expect(shown).toContain("checkout");
  const acc = await w(p, "accept", "retry", "--actor", "you");
  expect(acc.code).toBe(0);
  expect(logLines(p).length).toBe(before + 2);
  expect(events(p).at(-1).type).toBe("change.accepted");
  const after = all(await w(p, "show", "retry"));
  expect(after).not.toContain("proposed");
  expect(after).toContain("checkout");
  expect(all(await w(p, "show", "other"))).toContain("proposed");
});

test("[04.2] accepting a ghost child takes the ghost parent, and the held link goes live with no event", async () => {
  const p = freshProject();
  root(p);
  real(p, "payments", "Payments");
  real(p, "fraud", "Fraud rules");
  await w(p, "add", "refunds", "--title", "Refunds", "--parent", "payments");
  await w(p, "add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await w(p, "link", "partial", "fraud", "--type", "depends_on", "--why", "uses the fraud rules");
  await w(p, "add", "partial:opt0", "--kind", "option", "--title", "Full only", "--why_not", "too coarse");
  await w(p, "link", "partial:opt0", "partial", "--type", "alternative_to");
  await w(p, "add", "src1", "--kind", "source", "--title", "Notes", "--finding", "f");
  await w(p, "link", "partial", "src1", "--type", "supported_by");
  const held = all(await w(p, "show", "partial"));
  expect(held).toMatch(/depends_on\s+fraud.*\(held\)/);
  const n = logLines(p).length;
  const acc = await w(p, "accept", "partial", "--actor", "you");
  expect(acc.code).toBe(0);
  const fresh = events(p).slice(n);
  expect(fresh.length).toBeGreaterThan(0);
  expect(fresh.every((e) => e.type === "change.accepted")).toBe(true);
  expect(fresh.some((e) => e.type.startsWith("edge"))).toBe(false);
  expect(all(await w(p, "show", "refunds"))).not.toContain("proposed");
  const ps = all(await w(p, "show", "partial"));
  expect(ps).not.toContain("proposed");
  expect(ps).toMatch(/depends_on\s+fraud/);
  expect(ps).not.toContain("(held)");
  expect(all(await w(p, "show", "partial:opt0"))).not.toContain("proposed");
  expect(all(await w(p, "show", "src1"))).not.toContain("proposed");
});

test("[04.3] discarding a ghost parent drops its ghost children", async () => {
  const p = freshProject();
  root(p);
  real(p, "onboarding", "Onboarding");
  await w(p, "add", "email", "--title", "Email verification", "--parent", "onboarding");
  await w(p, "add", "resend", "--title", "Resend email", "--parent", "email");
  const d = await w(p, "discard", "email");
  expect(d.code).toBe(0);
  for (const id of ["email", "resend"]) {
    const s = await w(p, "show", id);
    expect(all(s)).toMatch(/no node .* in the map|not in the map/i);
  }
  const on = all(await w(p, "show", "onboarding"));
  expect(on).not.toContain("email");
  expect(on).not.toContain("resend");
});

test("[04.4] the words of a ghost are frozen", async () => {
  const p = freshProject();
  root(p);
  real(p, "search", "Search");
  await w(p, "add", "idx", "--title", "Search index", "--why", "first why", "--parent", "search");
  const n = logLines(p).length;
  const r = await w(p, "add", "idx", "--title", "Other words", "--why", "other why", "--parent", "search");
  expect(r.code).not.toBe(0);
  expect(all(r)).toMatch(/frozen/i);
  expect(logLines(p).length).toBe(n);
  const s = all(await w(p, "show", "idx"));
  expect(s).toContain("Search index");
  expect(s).toContain("first why");
});

test("[04.5] an accept from the command line needs --actor you", async () => {
  const p = freshProject();
  root(p);
  real(p, "base", "Base");
  await w(p, "add", "audit", "--title", "Audit log", "--parent", "base");
  const n = logLines(p).length;
  const r = await w(p, "accept", "audit");
  expect(r.code).not.toBe(0);
  expect(logLines(p).length).toBe(n);
  expect(all(await w(p, "show", "audit"))).toContain("proposed");
  const ok = await w(p, "accept", "audit", "--actor", "you");
  expect(ok.code).toBe(0);
  expect(all(await w(p, "show", "audit"))).not.toContain("proposed");
});

test("[62.1] an agent proposes a card and a person accepts it into the map", async () => {
  const p = freshProject();
  root(p);
  real(p, "base", "Base");
  const before = logText(p);
  const add = await w(p, "add", "uselog", "--title", "Use a log", "--body", "The body.", "--why", "The why.", "--parent", "base");
  expect(all(add)).toContain("proposed");
  let now = logText(p);
  expect(now.startsWith(before)).toBe(true);
  expect(now.split("\n").filter(Boolean).length).toBe(before.split("\n").filter(Boolean).length + 1);
  const s = all(await w(p, "show", "uselog"));
  for (const t of ["Use a log", "The body.", "The why.", "proposed"]) expect(s).toContain(t);
  const before2 = logText(p);
  const acc = await w(p, "accept", "uselog", "--actor", "you");
  expect(acc.code).toBe(0);
  now = logText(p);
  expect(now.startsWith(before2)).toBe(true);
  expect(now.split("\n").filter(Boolean).length).toBe(before2.split("\n").filter(Boolean).length + 1);
  const s2 = all(await w(p, "show", "uselog"));
  for (const t of ["Use a log", "The body.", "The why."]) expect(s2).toContain(t);
  expect(s2).not.toContain("proposed");
});

test("[62.2] an accept without the claim refuses and leaves the ghost waiting", async () => {
  const p = freshProject();
  root(p);
  await w(p, "add", "g", "--title", "G");
  const n = logLines(p).length;
  expect((await w(p, "accept", "g")).code).not.toBe(0);
  expect(logLines(p).length).toBe(n);
  expect(all(await w(p, "show", "g"))).toContain("proposed");
  expect((await w(p, "accept", "g", "--actor", "you")).code).toBe(0);
  expect(all(await w(p, "show", "g"))).not.toContain("proposed");
});

test("[62.3] the words of a ghost are frozen", async () => {
  const p = freshProject();
  root(p);
  await w(p, "add", "g", "--title", "Use a log");
  const n = logLines(p).length;
  for (const args of [
    ["edit", "g", "--body", "new body"],
    ["retitle", "g", "Use an append-only log"],
    ["add", "g", "--title", "Different title"],
  ]) {
    const r = await w(p, ...args);
    expect(r.code).not.toBe(0);
    expect(logLines(p).length).toBe(n);
  }
  const s = all(await w(p, "show", "g"));
  expect(s).toContain("Use a log");
  expect(s).toContain("proposed");
});

test("[62.4] a retitle on a real card shows the new title, the log keeps the old", async () => {
  const p = freshProject();
  root(p);
  await w(p, "add", "g", "--title", "Use a log");
  await w(p, "accept", "g", "--actor", "you");
  const n = logLines(p).length;
  const r = await w(p, "retitle", "g", "Use an append-only log");
  expect(r.code).toBe(0);
  expect(logLines(p).length).toBe(n + 1);
  const s = all(await w(p, "show", "g"));
  expect(s).toContain("Use an append-only log");
  expect(s).not.toContain("Use a log");
  expect(logText(p)).toContain("Use a log");
  const e = await w(p, "edit", "g", "--body", "A new body");
  expect(e.code).toBe(0);
  const s2 = all(await w(p, "show", "g"));
  expect(s2).toContain("A new body");
  expect(s2).toContain("Use an append-only log");
});

test("[62.5] an option, a source and an excerpt enter as ghosts", async () => {
  const p = freshProject();
  root(p);
  real(p, "base", "Base");
  let n = logLines(p).length;
  const o = await w(p, "add", "base:opt", "--kind", "option", "--title", "Alt", "--why_not", "too slow");
  expect(all(o)).toContain("proposed");
  expect(logLines(p).length).toBe(n + 1);
  n++;
  const s = await w(p, "add", "src", "--kind", "source", "--title", "Doc", "--url", "http://x", "--finding", "found");
  expect(all(s)).toContain("proposed");
  expect(logLines(p).length).toBe(n + 1);
  n++;
  chat(p, "talk", [{ kind: "spoken", text: "we should keep one log" }]);
  const x = await w(p, "quote", "base", "talk", "keep one log");
  expect(all(x)).toContain("proposed");
  expect(logLines(p).length).toBe(n + 1);
  for (const id of ["base:opt", "src", "base:ex0"]) expect(all(await w(p, "show", id))).toContain("proposed");
  expect((await w(p, "accept", "base:opt", "--actor", "you")).code).toBe(0);
  const os = all(await w(p, "show", "base:opt"));
  expect(os).not.toContain("proposed");
  expect(os).toContain("too slow");
  expect(all(await w(p, "show", "src"))).toContain("proposed");
  expect(all(await w(p, "show", "base:ex0"))).toContain("proposed");
});

test("[63.1] a link to a ghost is held, and goes live on accept with no extra link event", async () => {
  const p = freshProject();
  root(p);
  real(p, "storage", "Storage");
  await w(p, "add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  const l = await w(p, "link", "sqlite", "storage", "--type", "depends_on", "--why", "its basis");
  expect(l.code, all(l)).toBe(0);
  const s = all(await w(p, "show", "sqlite"));
  expect(s).toMatch(/depends_on\s+storage.*held/);
  await w(p, "accept", "sqlite", "--actor", "you");
  const s2 = all(await w(p, "show", "sqlite"));
  expect(s2).toMatch(/depends_on\s+storage/);
  expect(s2).not.toContain("held");
  expect(events(p).filter((e) => e.type === "edge.added").length).toBe(1);
});

test("[63.2] accepting a ghost child accepts its ghost parent, not a ghost it depends on", async () => {
  const p = freshProject();
  root(p);
  real(p, "platform", "Platform");
  await w(p, "add", "auth", "--title", "Auth", "--parent", "platform");
  await w(p, "add", "magic", "--title", "Magic links", "--parent", "auth");
  await w(p, "add", "email", "--title", "Email service", "--parent", "platform");
  await w(p, "link", "magic", "email", "--type", "depends_on", "--why", "sends the mail");
  await w(p, "accept", "magic", "--actor", "you");
  expect(all(await w(p, "show", "magic"))).not.toContain("proposed");
  const a = all(await w(p, "show", "auth"));
  expect(a).not.toContain("proposed");
  expect(a).toContain("platform");
  expect(all(await w(p, "show", "email"))).toContain("proposed");
  expect(all(await w(p, "show", "magic"))).toMatch(/depends_on\s+email.*held/);
});

test("[63.3] an accept takes the card's own ghost options and sources", async () => {
  const p = freshProject();
  root(p);
  real(p, "storage", "Storage");
  await w(p, "add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  await w(p, "add", "sqlite:pg", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server");
  await w(p, "link", "sqlite:pg", "sqlite", "--type", "alternative_to");
  await w(p, "add", "bench", "--kind", "source", "--title", "Benchmark notes");
  await w(p, "link", "sqlite", "bench", "--type", "supported_by");
  const who = await w(p, "edit", "sqlite", "--who", "you");
  expect(who.code).toBe(0);
  // status decided: the contract may demand facts; the step says the agent got no refusal for status/who on a ghost.
  const st = await w(p, "status", "sqlite", "decided");
  expect(st.code, all(st)).toBe(0);
  await w(p, "accept", "sqlite", "--actor", "you");
  const s = all(await w(p, "show", "sqlite"));
  expect(s).toContain("[decided]");
  expect(s).toMatch(/who/i);
  expect(all(await w(p, "show", "sqlite:pg"))).not.toContain("proposed");
  expect(all(await w(p, "show", "sqlite:pg"))).toContain("needs a server");
  expect(all(await w(p, "show", "bench"))).not.toContain("proposed");
  expect(s).toMatch(/supported_by\s+bench/);
  expect(s).not.toContain("(held)");
});

test("[63.4] discarding a ghost parent discards its whole ghost branch", async () => {
  const p = freshProject();
  root(p);
  real(p, "platform", "Platform");
  await w(p, "add", "auth", "--title", "Auth", "--parent", "platform");
  await w(p, "add", "magic", "--title", "Magic links", "--parent", "auth");
  await w(p, "add", "magic:pw", "--kind", "option", "--title", "Passwords", "--why_not", "weak");
  await w(p, "link", "magic:pw", "magic", "--type", "alternative_to");
  expect((await w(p, "discard", "auth")).code).toBe(0);
  for (const id of ["auth", "magic", "magic:pw"]) expect(all(await w(p, "show", id))).toMatch(/no node .* in the map|not in the map/i);
  const s = all(await w(p, "show", "platform"));
  expect(s).not.toContain("auth");
  expect(s).not.toContain("proposed");
});

test("[63.5] a ghost changes no count of a real card until accepted", async () => {
  const p = freshProject();
  root(p);
  real(p, "storage", "Storage");
  real(p, "child", "Child", { parent: "storage" });
  const b = all(await w(p, "show", "storage"));
  await w(p, "add", "sqlite", "--title", "Use SQLite", "--parent", "storage", "--status", "open");
  await w(p, "add", "sqlite:o", "--kind", "option", "--title", "O", "--why_not", "x");
  const a = all(await w(p, "show", "storage"));
  const pick = (t: string) => t.split("\n").filter((l) => /subtree|unchallenged|stale|paused/i.test(l));
  expect(pick(a)).toEqual(pick(b));
  await w(p, "accept", "sqlite", "--actor", "you");
  const c = all(await w(p, "show", "storage"));
  expect(c).toMatch(/subtree: 3 cards/);
});

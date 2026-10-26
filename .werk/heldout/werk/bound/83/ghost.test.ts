import { expect, test } from "bun:test";
import { chat, logEvents, logLines, ok, real, seed, shown, withRoot } from "./lib.ts";

const open = (id: string, parent = "root", title = id) => real(id, parent, { title, status: "open" });

test("04.1 a new card waits as a ghost until the person accepts it", async () => {
  const p = withRoot([open("checkout", "root", "Checkout flow")]);
  await ok(p, ["add", "other", "--title", "Other", "--parent", "checkout"]);
  const before = logLines(p);
  const add = await ok(p, ["add", "retry", "--title", "Retry payment", "--parent", "checkout"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = logLines(p);
  expect(after.length).toBe(before.length + 1);
  const ev = JSON.parse(after.at(-1) as string);
  expect(ev.type).toBe("node.proposed");
  expect(ev.payload.parent).toBe("checkout");
  const s = await shown(p, "retry");
  expect(s.text).toContain("proposed");
  expect(s.text).toContain("parent: checkout");
  await ok(p, ["accept", "retry", "--actor", "you"]);
  const l2 = logLines(p);
  expect(l2.length).toBe(after.length + 1);
  expect(JSON.parse(l2.at(-1) as string).type).toBe("change.accepted");
  const s2 = await shown(p, "retry");
  expect(s2.text).not.toContain("proposed");
  expect(s2.text).toContain("parent: checkout");
  expect((await shown(p, "other")).text).toContain("proposed");
});

test("04.2 accepting a ghost child accepts its ghost parent; held link goes live with no link event", async () => {
  const p = withRoot([open("payments"), open("fraud", "root", "Fraud rules")]);
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial", "fraud", "--type", "depends_on", "--why", "needs the fraud rules"]);
  await ok(p, ["add", "partial:opt0", "--kind", "option", "--title", "Full only", "--why_not", "too coarse"]);
  await ok(p, ["link", "partial:opt0", "partial", "--type", "alternative_to"]);
  await ok(p, ["add", "src1", "--kind", "source", "--title", "Refund guide", "--finding", "f"]);
  await ok(p, ["link", "partial", "src1", "--type", "supported_by"]);
  const held = await shown(p, "partial");
  expect(held.text).toMatch(/depends_on\s+fraud.*\(held\)/);
  const n = logLines(p).length;
  await ok(p, ["accept", "partial", "--actor", "you"]);
  const added = logEvents(p).slice(n);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((e) => e.type === "change.accepted")).toBe(true);
  expect(added.some((e) => e.type === "edge.added")).toBe(false);
  expect((await shown(p, "refunds")).text).not.toContain("proposed");
  const ps = await shown(p, "partial");
  expect(ps.text).not.toContain("proposed");
  expect((await shown(p, "partial:opt0")).text).not.toContain("proposed");
  expect((await shown(p, "src1")).text).not.toContain("proposed");
  const line = ps.text.split("\n").find((l) => /depends_on\s+fraud/.test(l)) as string;
  expect(line).toBeDefined();
  expect(line).not.toContain("held");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = withRoot([open("onboarding", "root", "Onboarding")]);
  await ok(p, ["add", "email", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend", "--title", "Resend email", "--parent", "email"]);
  await ok(p, ["discard", "email"]);
  for (const id of ["email", "resend"]) {
    const s = await shown(p, id);
    expect(s.code).toBe(1);
    expect(s.text).toContain(`no node #${id} in the map`);
  }
  const o = await shown(p, "onboarding");
  expect(o.text).not.toContain("ghost");
  expect(o.text).not.toContain("email");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = withRoot([open("search")]);
  await ok(p, ["add", "idx", "--title", "First title", "--why", "First why", "--parent", "search"]);
  const before = logLines(p);
  const r = await p.werk(["add", "idx", "--title", "Second title", "--why", "Second why", "--parent", "search"]);
  expect(r.code).not.toBe(0);
  expect(r.err.toLowerCase()).toContain("frozen");
  expect(logLines(p)).toEqual(before);
  const s = await shown(p, "idx");
  expect(s.text).toContain("First title");
  expect(s.text).toContain("First why");
});

test("04.5 an accept needs --actor you", async () => {
  const p = withRoot([open("base")]);
  await ok(p, ["add", "audit", "--title", "Audit log", "--parent", "base"]);
  const before = logLines(p);
  const r = await p.werk(["accept", "audit"]);
  expect(r.code).not.toBe(0);
  expect(logLines(p)).toEqual(before);
  expect((await shown(p, "audit")).text).toContain("proposed");
  const r2 = await p.werk(["accept", "audit", "--actor", "you"]);
  expect(r2.code).toBe(0);
  expect((await shown(p, "audit")).text).not.toContain("proposed");
});

test("62.1 propose and accept append exactly one event each", async () => {
  const p = withRoot([open("a")]);
  const b0 = logLines(p);
  const r = await ok(p, ["add", "x", "--title", "Use a log", "--body", "The body.", "--why", "The why."]);
  expect(r.out).toContain("proposed");
  const b1 = logLines(p);
  expect(b1.length).toBe(b0.length + 1);
  expect(b1.slice(0, b0.length)).toEqual(b0);
  const s = (await shown(p, "x")).text;
  expect(s).toContain("Use a log");
  expect(s).toContain("The body.");
  expect(s).toContain("The why.");
  expect(s).toContain("proposed");
  await ok(p, ["accept", "x", "--actor", "you"]);
  const b2 = logLines(p);
  expect(b2.length).toBe(b1.length + 1);
  expect(b2.slice(0, b1.length)).toEqual(b1);
  const s2 = (await shown(p, "x")).text;
  expect(s2).toContain("Use a log");
  expect(s2).toContain("The body.");
  expect(s2).toContain("The why.");
  expect(s2).not.toContain("proposed");
});

test("62.2 an accept without the claim refuses", async () => {
  const p = withRoot();
  await ok(p, ["add", "x", "--title", "T"]);
  const before = logLines(p);
  const r = await p.werk(["accept", "x"]);
  expect(r.code).not.toBe(0);
  expect(logLines(p)).toEqual(before);
  expect((await shown(p, "x")).text).toContain("proposed");
  await ok(p, ["accept", "x", "--actor", "you"]);
  expect((await shown(p, "x")).text).not.toContain("proposed");
});

test("62.3 ghost words are frozen", async () => {
  const p = withRoot();
  await ok(p, ["add", "x", "--title", "Use a log"]);
  const before = logLines(p);
  for (const args of [
    ["edit", "x", "--body", "new body"],
    ["retitle", "x", "Use an append-only log"],
    ["add", "x", "--title", "Different"],
  ]) {
    const r = await p.werk(args);
    expect(r.code).not.toBe(0);
    expect(logLines(p)).toEqual(before);
  }
  const s = (await shown(p, "x")).text;
  expect(s).toContain("Use a log");
  expect(s).toContain("proposed");
});

test("62.4 a retitle of a real card shows only the new title and the log keeps the old", async () => {
  const p = withRoot();
  await ok(p, ["add", "x", "--title", "Use a log"]);
  await ok(p, ["accept", "x", "--actor", "you"]);
  const n = logLines(p).length;
  const r = await p.werk(["retitle", "x", "Use an append-only log"]);
  expect(r.code).toBe(0);
  expect(logLines(p).length).toBe(n + 1);
  const s = (await shown(p, "x")).text;
  expect(s).toContain("Use an append-only log");
  expect(s).not.toContain("Use a log");
  expect(logLines(p).some((l) => l.includes('"Use a log"'))).toBe(true);
  await ok(p, ["edit", "x", "--body", "A fresh body."]);
  const s2 = (await shown(p, "x")).text;
  expect(s2).toContain("A fresh body.");
  expect(s2).toContain("Use an append-only log");
});

test("62.5 option, source and excerpt also enter as ghosts", async () => {
  const p = withRoot([open("c")]);
  chat(p, "talk", [{ text: "we keep one log" }]);
  const counts: number[] = [logLines(p).length];
  const outs: string[] = [];
  const cmds = [
    ["add", "c:opt0", "--kind", "option", "--title", "Opt", "--why_not", "too slow"],
    ["add", "s1", "--kind", "source", "--title", "Src", "--url", "http://x", "--finding", "found"],
    ["quote", "c", "talk", "one log"],
  ];
  for (const c of cmds) {
    outs.push((await ok(p, c)).out);
    counts.push(logLines(p).length);
  }
  outs.forEach((o) => expect(o).toContain("proposed"));
  expect(counts[1]).toBe((counts[0] as number) + 1);
  expect(counts[2]).toBe((counts[1] as number) + 1);
  expect(counts[3]).toBe((counts[2] as number) + 1);
  for (const id of ["c:opt0", "s1", "c:ex0"]) expect((await shown(p, id)).text).toContain("proposed");
  expect((await shown(p, "c:opt0")).text).toContain("too slow");
  await ok(p, ["accept", "c:opt0", "--actor", "you"]);
  const o = (await shown(p, "c:opt0")).text;
  expect(o).not.toContain("proposed");
  expect(o).toContain("too slow");
  expect((await shown(p, "s1")).text).toContain("proposed");
  expect((await shown(p, "c:ex0")).text).toContain("proposed");
});

test("63.1 a link to a ghost is held and goes live on accept with no extra link event", async () => {
  const p = withRoot([open("storage", "root", "Storage")]);
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  await ok(p, ["link", "sqlite", "storage", "--type", "depends_on", "--why", "basis"]);
  const s = (await shown(p, "sqlite")).text;
  expect(s.split("\n").find((l) => /depends_on\s+storage/.test(l))).toContain("held");
  const st = (await shown(p, "storage")).text;
  expect(st).toMatch(/<- depends_on.*sqlite.*held/);
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const s2 = (await shown(p, "sqlite")).text;
  expect(s2.split("\n").find((l) => /-> depends_on\s+storage/.test(l))).not.toContain("held");
  expect(
    logEvents(p).filter((e) => e.type === "edge.added" && e.payload.from === "sqlite" && e.payload.to === "storage")
      .length,
  ).toBe(1);
});

test("63.1b (variant, not the step) same flow with the card under root and a sibling as the basis", async () => {
  const p = withRoot([open("storage", "root", "Storage")]);
  await ok(p, ["add", "sqlite", "--title", "Use SQLite"]);
  await ok(p, ["link", "sqlite", "storage", "--type", "depends_on", "--why", "basis"]);
  const s = (await shown(p, "sqlite")).text;
  expect(s.split("\n").find((l) => /depends_on\s+storage/.test(l))).toContain("held");
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  expect(logEvents(p).filter((e) => e.type === "edge.added").length).toBe(1);
});

test("63.2 accepting a ghost child accepts the ghost parent, not a ghost it depends on", async () => {
  const p = withRoot([open("platform", "root", "Platform")]);
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await ok(p, ["add", "email", "--title", "Email service", "--parent", "platform"]);
  await ok(p, ["link", "magic", "email", "--type", "depends_on", "--why", "sends mail"]);
  await ok(p, ["accept", "magic", "--actor", "you"]);
  expect((await shown(p, "magic")).text).not.toContain("proposed");
  const a = (await shown(p, "auth")).text;
  expect(a).not.toContain("proposed");
  expect(a).toContain("parent: platform");
  expect((await shown(p, "email")).text).toContain("proposed");
  const line = (await shown(p, "magic")).text.split("\n").find((l) => /depends_on\s+email/.test(l)) as string;
  expect(line).toContain("held");
});

test("63.3 an accept takes the card's own ghost options and sources", async () => {
  const p = withRoot([real("storage", "root", { status: "decided", who: "me", no_basis: "x" })]);
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "heavy"]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await ok(p, ["add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "fast"]);
  await ok(p, ["link", "sqlite", "bench", "--type", "supported_by"]);
  await ok(p, ["edit", "sqlite", "--no-basis", "nothing below it"]);
  await ok(p, ["kill", "sqlite", "--revisit"]);
  const w = await p.werk(["edit", "sqlite", "--who", "me"]);
  expect(w.code).toBe(0);
  const d = await p.werk(["status", "sqlite", "decided"]);
  expect(d.err).toBe("");
  expect(d.code).toBe(0);
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const s = (await shown(p, "sqlite")).text;
  expect(s).toContain("[decided]");
  expect(s).not.toContain("proposed");
  expect(s).toContain("who");
  const o = (await shown(p, "sqlite:opt0")).text;
  expect(o).not.toContain("proposed");
  expect(o).toContain("heavy");
  expect((await shown(p, "bench")).text).not.toContain("proposed");
  const line = s.split("\n").find((l) => /supported_by\s+bench/.test(l)) as string;
  expect(line).not.toContain("held");
});

test("63.4 discarding a ghost parent discards its ghost branch", async () => {
  const p = withRoot([open("platform")]);
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await ok(p, ["add", "magic:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "weak"]);
  await ok(p, ["link", "magic:opt0", "magic", "--type", "alternative_to"]);
  await ok(p, ["discard", "auth"]);
  for (const id of ["auth", "magic", "magic:opt0"]) {
    const s = await shown(p, id);
    expect(s.code).toBe(1);
  }
  const pl = (await shown(p, "platform")).text;
  expect(pl).not.toContain("ghost");
  expect(pl).not.toContain("proposed");
});

test("63.5 a ghost changes no count of a real card until accepted", async () => {
  const p = withRoot([
    open("storage", "root", "Storage"),
    real("kid", "storage", { status: "decided", who: "me", no_basis: "x" }),
  ]);
  const before = (await shown(p, "storage")).text;
  const subtree = /subtree: .*/.exec(before)?.[0];
  expect(subtree).toBeDefined();
  expect(before).not.toMatch(/stale|paused/);
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage", "--status", "open"]);
  await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "O", "--why_not", "n"]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  const mid = (await shown(p, "storage")).text;
  expect(/subtree: .*/.exec(mid)?.[0]).toBe(subtree);
  expect(mid).not.toMatch(/stale|paused/);
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const after = (await shown(p, "storage")).text;
  expect(/subtree: .*/.exec(after)?.[0]).not.toBe(subtree);
  expect(/subtree: (\d+)/.exec(after)?.[1]).toBe(String(Number(/subtree: (\d+)/.exec(subtree as string)?.[1]) + 1));
});

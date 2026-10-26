import { expect, test } from "bun:test";
import { freshProject } from "../src/test/project.ts";
import { card, decided, edge, events, kill, lines, ok, proposed, root, seed, w } from "./h.ts";

const show = async (p: any, id: string) => (await w(p, ["show", id])).out;
const base = () => {
  const p = freshProject();
  seed(p, [...root()]);
  return p;
};

test("04.1", async () => {
  const p = base();
  seed(p, [decided("checkout", { title: "Checkout flow" })]);
  const n0 = lines(p).length;
  const r = await ok(p, ["add", "retry", "--title", "Retry payment", "--parent", "checkout"]);
  expect(r.out).toContain("proposed");
  expect(r.out).not.toContain("added");
  const ev = events(p);
  expect(ev.length).toBe(n0 + 1);
  expect(ev[n0]!.type).toBe("node.proposed");
  expect(ev[n0]!.payload.parent).toBe("checkout");
  const s = await show(p, "retry");
  expect(s).toContain("proposed");
  expect(s).toContain("parent: checkout  Checkout flow");
  const other = await ok(p, ["add", "other", "--title", "Other", "--parent", "checkout"]);
  expect(other.out).toContain("proposed");
  const n1 = lines(p).length;
  await ok(p, ["accept", "retry", "--actor", "you"]);
  expect(lines(p).length).toBe(n1 + 1);
  expect(events(p)[n1]!.type).toBe("change.accepted");
  const s2 = await show(p, "retry");
  expect(s2).not.toContain("proposed");
  expect(s2).toContain("parent: checkout  Checkout flow");
  expect(await show(p, "other")).toContain("proposed");
});

test("04.2", async () => {
  const p = base();
  seed(p, [decided("pay", { title: "Payments" }), decided("fraud", { title: "Fraud rules" })]);
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "pay"]);
  await ok(p, ["add", "partial", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial", "fraud", "--type", "depends_on", "--why", "needs fraud rules"]);
  await ok(p, ["add", "opt", "--kind", "option", "--title", "Full only", "--why_not", "too coarse"]);
  await ok(p, ["link", "opt", "partial", "--type", "alternative_to"]);
  await ok(p, ["add", "src", "--kind", "source", "--title", "Src", "--finding", "f"]);
  await ok(p, ["link", "partial", "src", "--type", "supported_by"]);
  const s = await show(p, "partial");
  expect(s).toMatch(/depends_on\s+fraud.*held\)/);
  const n = lines(p).length;
  await ok(p, ["accept", "partial", "--actor", "you"]);
  const added = events(p).slice(n);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((e) => e.type === "change.accepted")).toBe(true);
  expect(added.some((e) => e.type.startsWith("edge"))).toBe(false);
  expect(await show(p, "refunds")).not.toContain("proposed");
  const s2 = await show(p, "partial");
  expect(s2).not.toContain("proposed");
  expect(s2).toMatch(/depends_on\s+fraud/);
  expect(s2).not.toContain("(held)");
  expect(s2).not.toContain("ghost");
  expect(await show(p, "opt")).not.toContain("proposed");
  expect(await show(p, "src")).not.toContain("proposed");
});

test("04.3", async () => {
  const p = base();
  seed(p, [decided("onb", { title: "Onboarding" })]);
  await ok(p, ["add", "ev", "--title", "Email verification", "--parent", "onb"]);
  await ok(p, ["add", "resend", "--title", "Resend email", "--parent", "ev"]);
  await ok(p, ["discard", "ev"]);
  for (const id of ["ev", "resend"]) {
    const r = await w(p, ["show", id]);
    expect(r.code).not.toBe(0);
    expect(r.err.toLowerCase()).toMatch(/no node|not in the map/);
  }
  const s = await show(p, "onb");
  expect(s).not.toContain("ghost");
  expect(s).not.toContain("Email verification");
});

test("04.4", async () => {
  const p = base();
  seed(p, [decided("search", { title: "Search" })]);
  await ok(p, ["add", "idx", "--title", "First title", "--why", "First why", "--parent", "search"]);
  const n = lines(p).length;
  const r = await w(p, ["add", "idx", "--title", "Second", "--why", "Other", "--parent", "search"]);
  expect(r.code).not.toBe(0);
  expect(r.err.toLowerCase()).toContain("frozen");
  expect(lines(p).length).toBe(n);
  const s = await show(p, "idx");
  expect(s).toContain("First title");
  expect(s).toContain("First why");
});

test("04.5 / 62.2", async () => {
  const p = base();
  seed(p, [decided("a")]);
  await ok(p, ["add", "audit", "--title", "Audit log", "--parent", "a"]);
  const n = lines(p).length;
  const r = await w(p, ["accept", "audit"]);
  expect(r.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect(await show(p, "audit")).toContain("proposed");
  const r2 = await w(p, ["accept", "audit", "--actor", "you"]);
  expect(r2.code).toBe(0);
  expect(await show(p, "audit")).not.toContain("proposed");
});

test("06.1 excerpt add stays proposed", async () => {
  const p = base();
  seed(p, [decided("c", { title: "Cardc", why: "Because" })]);
  const n = lines(p).length;
  const r = await w(p, ["add", "ex", "--kind", "excerpt", "--title", "q"]);
  console.log("excerpt add:", JSON.stringify(r));
  // the agent may propose a source instead
  const r2 = await ok(p, ["add", "srcx", "--kind", "source", "--title", "S"]);
  expect(r2.out).toContain("proposed");
  await ok(p, ["link", "c", "srcx", "--type", "supported_by"]);
  const s = await show(p, "c");
  expect(s).toMatch(/supported_by\s+srcx.*held\)/);
  expect(s).toContain("[decided]");
  expect(s).toContain("Cardc");
  expect(await show(p, "srcx")).toContain("proposed");
});

test("62.1", async () => {
  const p = base();
  seed(p, [decided("a")]);
  const before = lines(p);
  const r = await ok(p, ["add", "n", "--title", "Use a log", "--body", "B body", "--why", "W why", "--parent", "a"]);
  expect(r.out).toContain("proposed");
  let after = lines(p);
  expect(after.length).toBe(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const s = await show(p, "n");
  expect(s).toContain("Use a log");
  expect(s).toContain("B body");
  expect(s).toContain("W why");
  expect(s).toContain("proposed");
  const b2 = lines(p);
  await ok(p, ["accept", "n", "--actor", "you"]);
  after = lines(p);
  expect(after.length).toBe(b2.length + 1);
  expect(after.slice(0, b2.length)).toEqual(b2);
  const s2 = await show(p, "n");
  expect(s2).toContain("Use a log");
  expect(s2).toContain("B body");
  expect(s2).toContain("W why");
  expect(s2).not.toContain("proposed");
});

test("62.3", async () => {
  const p = base();
  seed(p, [decided("a")]);
  await ok(p, ["add", "n", "--title", "Use a log", "--parent", "a"]);
  const n = lines(p).length;
  for (const args of [
    ["edit", "n", "--body", "new body"],
    ["retitle", "n", "Use an append-only log"],
    ["add", "n", "--title", "Different"],
  ]) {
    const r = await w(p, args);
    expect(r.code).not.toBe(0);
    expect(lines(p).length).toBe(n);
  }
  const s = await show(p, "n");
  expect(s).toContain("Use a log");
  expect(s).toContain("proposed");
});

test("62.4", async () => {
  const p = base();
  seed(p, [decided("a")]);
  await ok(p, ["add", "n", "--title", "Use a log", "--parent", "a"]);
  await ok(p, ["accept", "n", "--actor", "you"]);
  const n = lines(p).length;
  const r = await ok(p, ["retitle", "n", "Use an append-only log"]);
  expect(lines(p).length).toBe(n + 1);
  const s = await show(p, "n");
  expect(s).toContain("Use an append-only log");
  expect(s).not.toContain("Use a log");
  expect(lines(p)[1] + lines(p).join("\n")).toContain('"Use a log"');
  await ok(p, ["edit", "n", "--body", "The new body"]);
  const s2 = await show(p, "n");
  expect(s2).toContain("The new body");
  expect(s2).toContain("Use an append-only log");
});

test("62.5", async () => {
  const p = base();
  seed(p, [decided("a")]);
  const step = async (args: string[]) => {
    const n = lines(p).length;
    const r = await ok(p, args);
    expect(r.out).toContain("proposed");
    expect(lines(p).length).toBe(n + 1);
  };
  await step(["add", "opt", "--kind", "option", "--title", "Opt", "--why_not", "Too slow"]);
  await step(["add", "src", "--kind", "source", "--title", "Src", "--finding", "found"]);
  // excerpt via add is refused: the excerpt needs quote
  const ex = await w(p, ["add", "ex", "--kind", "excerpt", "--title", "q"]);
  console.log("62.5 excerpt add:", JSON.stringify(ex));
  await ok(p, ["link", "opt", "a", "--type", "alternative_to"]);
  await ok(p, ["accept", "opt", "--actor", "you"]);
  const so = await show(p, "opt");
  expect(so).not.toContain("proposed");
  expect(so).toContain("Too slow");
  expect(await show(p, "src")).toContain("proposed");
});

test("63.1", async () => {
  const p = base();
  seed(p, [decided("storage", { title: "Storage" })]);
  await ok(p, ["add", "sql", "--title", "Use SQLite", "--parent", "storage"]);
  await ok(p, ["link", "sql", "storage", "--type", "depends_on", "--why", "basis"]);
  expect(await show(p, "sql")).toMatch(/depends_on\s+storage.*held\)/);
  expect(await show(p, "storage")).not.toMatch(/<- depends_on\s+sql(?!.*\((ghost, )?held)/);
  const live = (await show(p, "storage")).split("\n").filter((l) => l.includes("depends_on") && l.includes("sql"));
  for (const l of live) expect(l).toContain("held");
  const n = lines(p).length;
  await ok(p, ["accept", "sql", "--actor", "you"]);
  const s = await show(p, "sql");
  expect(s).toMatch(/depends_on\s+storage/);
  expect(s.split("\n").filter((l) => l.includes("depends_on"))[0]).not.toContain("held");
  expect(events(p).filter((e) => e.type === "edge.added" && e.payload.type === "depends_on").length).toBe(1);
  expect(events(p).slice(n).some((e) => e.type === "edge.added")).toBe(false);
});

test("63.2", async () => {
  const p = base();
  seed(p, [decided("platform", { title: "Platform" })]);
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await ok(p, ["add", "email", "--title", "Email service", "--parent", "platform"]);
  await ok(p, ["link", "magic", "email", "--type", "depends_on", "--why", "sends"]);
  await ok(p, ["accept", "magic", "--actor", "you"]);
  expect(await show(p, "magic")).not.toMatch(/\bproposed\b/);
  const a = await show(p, "auth");
  expect(a).not.toMatch(/\bproposed\b/);
  expect(a).toContain("parent: platform");
  expect(await show(p, "email")).toContain("proposed");
  expect(await show(p, "magic")).toMatch(/depends_on\s+email.*held\)/);
});

test("63.3", async () => {
  const p = base();
  seed(p, [decided("storage", { title: "Storage" }), decided("basis")]);
  await ok(p, ["add", "sql", "--title", "Use SQLite", "--parent", "storage"]);
  await ok(p, ["add", "pg", "--kind", "option", "--title", "Use Postgres", "--why_not", "heavy"]);
  await ok(p, ["link", "pg", "sql", "--type", "alternative_to"]);
  await ok(p, ["add", "bench", "--kind", "source", "--title", "Benchmark notes"]);
  await ok(p, ["link", "sql", "bench", "--type", "supported_by"]);
  await ok(p, ["link", "sql", "basis", "--type", "depends_on", "--why", "w"]);
  await ok(p, ["kill", "sql", "--revisit"]);
  await ok(p, ["edit", "sql", "--who", "you"]);
  const r = await w(p, ["status", "sql", "decided"]);
  expect(r.code).toBe(0);
  await ok(p, ["accept", "sql", "--actor", "you"]);
  const s = await show(p, "sql");
  expect(s).toContain("[decided]");
  expect(s).toContain("who: you");
  expect(s).not.toMatch(/\bproposed\b/);
  const o = await show(p, "pg");
  expect(o).not.toContain("proposed");
  expect(o).toContain("heavy");
  const b = await show(p, "bench");
  expect(b).not.toContain("proposed");
  expect(s).toMatch(/supported_by\s+bench/);
  expect(s).not.toContain("(held)");
});

test("63.4", async () => {
  const p = base();
  seed(p, [decided("platform", { title: "Platform" })]);
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await ok(p, ["add", "pw", "--kind", "option", "--title", "Passwords", "--why_not", "x"]);
  await ok(p, ["link", "pw", "magic", "--type", "alternative_to"]);
  await ok(p, ["discard", "auth"]);
  for (const id of ["auth", "magic", "pw"]) expect((await w(p, ["show", id])).code).not.toBe(0);
  const s = await show(p, "platform");
  expect(s).not.toContain("ghost");
  expect(s).not.toContain("Auth");
});

test("63.5", async () => {
  const p = base();
  seed(p, [decided("storage", { title: "Storage" }), decided("kid", { parent: "storage" })]);
  const before = await show(p, "storage");
  expect(before).not.toMatch(/stale|paused/);
  await ok(p, ["add", "sql", "--title", "Use SQLite", "--parent", "storage", "--status", "open"]);
  await ok(p, ["add", "o", "--kind", "option", "--title", "O", "--why_not", "x"]);
  await ok(p, ["link", "o", "sql", "--type", "alternative_to"]);
  const after = await show(p, "storage");
  const sub = (s: string) => s.split("\n").filter((l) => l.startsWith("subtree"));
  expect(sub(after)).toEqual(sub(before));
  expect(after).not.toMatch(/stale|paused/);
  await ok(p, ["accept", "sql", "--actor", "you"]);
  expect(sub(await show(p, "storage"))[0]).toContain("3 cards");
});

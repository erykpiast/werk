import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
const ok = async (p: Project, args: string[]) => {
  const r = await p.werk(args);
  if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return r;
};
const show = async (p: Project, id: string) => (await ok(p, ["show", id])).out;
const Y = ["--actor", "you"];
/** A real root card. */
async function withReal(id: string, title: string): Promise<Project> {
  const p = freshProject();
  await ok(p, ["add", id, "--title", title]);
  await ok(p, ["accept", id, ...Y]);
  return p;
}
async function decidedStorage(): Promise<Project> {
  const p = freshProject();
  await ok(p, ["add", "storage", "--title", "Storage", "--who", "me"]);
  await ok(p, ["edit", "storage", "--no-basis", "top of tree"]);
  await ok(p, ["kill", "storage", "--revisit"]);
  await ok(p, ["status", "storage", "decided"]);
  await ok(p, ["accept", "storage", ...Y]);
  return p;
}
const seed = (p: Project, type: string, payload: object) =>
  appendFileSync(logOf(p), `${JSON.stringify({ seq: lines(p).length + 1, at: "t", actor: "you", type, payload })}\n`);

test("04.1", async () => {
  const p = await withReal("checkout", "Checkout flow");
  await ok(p, ["add", "other", "--title", "Other ghost", "--parent", "checkout"]);
  const b = lines(p);
  const add = await ok(p, ["add", "retry", "--title", "Retry payment", "--parent", "checkout"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const a = lines(p);
  expect(a.length).toBe(b.length + 1);
  expect(a.slice(0, b.length)).toEqual(b);
  expect(JSON.parse(a.at(-1)!)).toMatchObject({ type: "node.proposed", payload: { id: "retry", parent: "checkout" } });
  const s = await show(p, "retry");
  expect(s).toContain("proposed");
  expect(s).toContain("parent: checkout");
  await ok(p, ["accept", "retry", ...Y]);
  const a2 = lines(p);
  expect(a2.length).toBe(a.length + 1);
  expect(JSON.parse(a2.at(-1)!).type).toBe("change.accepted");
  const s2 = await show(p, "retry");
  expect(s2).not.toContain("proposed");
  expect(s2).toContain("parent: checkout");
  expect(await show(p, "other")).toContain("proposed");
}, 60_000);

test("04.2", async () => {
  const p = await withReal("payments", "Payments");
  await ok(p, ["add", "fraud", "--title", "Fraud rules", "--parent", "payments"]);
  await ok(p, ["accept", "fraud", ...Y]);
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial", "fraud", "--type", "depends_on", "--why", "uses the rules"]);
  await ok(p, ["add", "partial:opt0", "--kind", "option", "--title", "Full only", "--why_not", "too coarse"]);
  await ok(p, ["link", "partial:opt0", "partial", "--type", "alternative_to"]);
  await ok(p, ["add", "src", "--kind", "source", "--title", "Support tickets"]);
  await ok(p, ["link", "partial", "src", "--type", "supported_by"]);
  const s = await show(p, "partial");
  expect(s).toMatch(/depends_on\s+fraud.*\(held\)/);
  const b = lines(p).length;
  await ok(p, ["accept", "partial", ...Y]);
  const ev = lines(p).slice(b).map((l) => JSON.parse(l));
  expect(ev.length).toBeGreaterThan(0);
  expect(ev.every((e) => e.type === "change.accepted")).toBe(true);
  expect(ev.some((e) => e.type === "edge.added")).toBe(false);
  expect(await show(p, "refunds")).not.toContain("proposed");
  const s2 = await show(p, "partial");
  expect(s2).not.toContain("proposed");
  expect(await show(p, "partial:opt0")).not.toContain("proposed");
  expect(await show(p, "src")).not.toContain("proposed");
  expect(s2).toMatch(/depends_on\s+fraud/);
  expect(s2).not.toMatch(/depends_on\s+fraud.*held/);
}, 60_000);

test("04.3", async () => {
  const p = await withReal("onb", "Onboarding");
  await ok(p, ["add", "email", "--title", "Email verification", "--parent", "onb"]);
  await ok(p, ["add", "resend", "--title", "Resend email", "--parent", "email"]);
  await ok(p, ["discard", "email"]);
  for (const id of ["email", "resend"]) {
    const r = await p.werk(["show", id]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("no node");
  }
  const s = await show(p, "onb");
  expect(s).not.toContain("ghost");
  expect(s).not.toContain("Email verification");
}, 60_000);

test("04.4 and 62.3 add-again", async () => {
  const p = await withReal("search", "Search");
  await ok(p, ["add", "index", "--title", "Search index", "--why", "fast lookup", "--parent", "search"]);
  const b = lines(p);
  const r = await p.werk(["add", "index", "--title", "Other words", "--why", "other why", "--parent", "search"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("words are frozen");
  expect(lines(p)).toEqual(b);
  const s = await show(p, "index");
  expect(s).toContain("Search index");
  expect(s).toContain("fast lookup");
  expect(s).not.toContain("Other words");
}, 60_000);

test("04.5 and 62.2", async () => {
  const p = await withReal("root", "Root");
  await ok(p, ["add", "audit", "--title", "Audit log", "--parent", "root"]);
  const b = lines(p);
  const r = await p.werk(["accept", "audit"]);
  expect(r.code).not.toBe(0);
  expect(lines(p)).toEqual(b);
  expect(await show(p, "audit")).toContain("proposed");
  await ok(p, ["accept", "audit", ...Y]);
  expect(await show(p, "audit")).not.toContain("proposed");
}, 60_000);

test("62.1", async () => {
  const p = await withReal("root", "Root");
  await ok(p, ["add", "seed", "--title", "Seed", "--parent", "root"]);
  const b = lines(p);
  const r = await ok(p, ["add", "c", "--title", "Use a log", "--body", "The body text.", "--why", "Because history.", "--parent", "root"]);
  expect(r.out).toContain("proposed");
  const a = lines(p);
  expect(a.length).toBe(b.length + 1);
  expect(a.slice(0, b.length)).toEqual(b);
  const s = await show(p, "c");
  for (const t of ["Use a log", "The body text.", "Because history.", "proposed"]) expect(s).toContain(t);
  await ok(p, ["accept", "c", ...Y]);
  const a2 = lines(p);
  expect(a2.length).toBe(a.length + 1);
  expect(a2.slice(0, a.length)).toEqual(a);
  const s2 = await show(p, "c");
  for (const t of ["Use a log", "The body text.", "Because history."]) expect(s2).toContain(t);
  expect(s2).not.toContain("proposed");
}, 60_000);

test("62.3 edit and retitle", async () => {
  const p = await withReal("root", "Root");
  await ok(p, ["add", "c", "--title", "Use a log", "--parent", "root"]);
  const b = lines(p);
  const e = await p.werk(["edit", "c", "--body", "new body"]);
  expect(e.code).not.toBe(0);
  expect(lines(p)).toEqual(b);
  const t = await p.werk(["retitle", "c", "Use an append-only log"]);
  expect(t.code).not.toBe(0);
  expect(lines(p)).toEqual(b);
  const s = await show(p, "c");
  expect(s).toContain("Use a log");
  expect(s).toContain("proposed");
}, 60_000);

test("62.4", async () => {
  const p = await withReal("root", "Root");
  await ok(p, ["add", "c", "--title", "Use a log", "--parent", "root"]);
  await ok(p, ["accept", "c", ...Y]);
  const b = lines(p).length;
  await ok(p, ["retitle", "c", "Use an append-only log"]);
  expect(lines(p).length).toBe(b + 1);
  const s = await show(p, "c");
  expect(s).toContain("Use an append-only log");
  expect(s).not.toContain("Use a log");
  expect(readFileSync(logOf(p), "utf8")).toContain('"Use a log"');
  expect(lines(p).findIndex((l) => l.includes('"Use a log"'))).toBeLessThan(b);
  await ok(p, ["edit", "c", "--body", "A new body."]);
  const s2 = await show(p, "c");
  expect(s2).toContain("A new body.");
  expect(s2).toContain("Use an append-only log");
}, 60_000);

test("62.5", async () => {
  const p = await withReal("root", "Root");
  mkdirSync(join(p.dir, ".werk", "chats"));
  const m = (text: string) => JSON.stringify({ speaker: "person", at: "t", session: "6ae61be7", kind: "spoken", text });
  writeFileSync(join(p.dir, ".werk", "chats", "talk.jsonl"), `${m("we keep an append-only log")}\n`);
  let n = lines(p).length;
  const step = async (args: string[]) => {
    const r = await ok(p, args);
    expect(r.out).toContain("proposed");
    expect(lines(p).length).toBe(n + 1);
    n++;
  };
  await step(["add", "root:opt0", "--kind", "option", "--title", "Flat file", "--why_not", "No history"]);
  await step(["add", "src", "--kind", "source", "--title", "Survey", "--finding", "Most want history", "--url", "http://x"]);
  await step(["quote", "root", "talk", "append-only log"]);
  const ex = lines(p).at(-1)!;
  const exId = JSON.parse(ex).payload.id as string;
  const so = await show(p, "root:opt0");
  expect(so).toContain("No history");
  expect(so).toContain("proposed");
  expect(await show(p, "src")).toContain("Most want history");
  expect(await show(p, "src")).toContain("proposed");
  expect(await show(p, exId)).toContain("proposed");
  await ok(p, ["accept", "root:opt0", ...Y]);
  const so2 = await show(p, "root:opt0");
  expect(so2).not.toContain("proposed");
  expect(so2).toContain("No history");
  expect(await show(p, "src")).toContain("proposed");
  expect(await show(p, exId)).toContain("proposed");
}, 60_000);

test("63.1 link ghost to its parent as basis", async () => {
  const p = await withReal("root", "Root");
  await ok(p, ["add", "storage", "--title", "Storage", "--parent", "root"]);
  await ok(p, ["accept", "storage", ...Y]);
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  const r = await p.werk(["link", "sqlite", "storage", "--type", "depends_on", "--why", "SQLite is the store"]);
  console.log("63.1 link:", r.code, r.out, r.err);
  expect(r.code).toBe(0);
  expect(await show(p, "sqlite")).toMatch(/depends_on\s+storage.*held/);
  expect(await show(p, "storage")).not.toMatch(/<- depends_on\s+sqlite\s+Use SQLite\n/);
  await ok(p, ["accept", "sqlite", ...Y]);
  expect(await show(p, "sqlite")).not.toMatch(/depends_on\s+storage.*held/);
  expect(lines(p).filter((l) => JSON.parse(l).type === "edge.added" && JSON.parse(l).payload.type === "depends_on").length).toBe(1);
}, 60_000);

test("63.1 variant: basis in another subtree", async () => {
  const p = await withReal("root", "Root");
  await ok(p, ["add", "storage", "--title", "Storage", "--parent", "root"]);
  await ok(p, ["accept", "storage", ...Y]);
  await ok(p, ["add", "engines", "--title", "Engines", "--parent", "root"]);
  await ok(p, ["accept", "engines", ...Y]);
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "engines"]);
  await ok(p, ["link", "sqlite", "storage", "--type", "depends_on", "--why", "SQLite is the store"]);
  expect(await show(p, "sqlite")).toMatch(/depends_on\s+storage.*held/);
  expect(await show(p, "storage")).not.toMatch(/<- depends_on\s+sqlite\s+Use SQLite\n/);
  await ok(p, ["accept", "sqlite", ...Y]);
  expect(await show(p, "sqlite")).not.toMatch(/depends_on\s+storage.*held/);
  expect(lines(p).filter((l) => JSON.parse(l).type === "edge.added").length).toBe(1);
}, 60_000);

test("63.2", async () => {
  const p = await withReal("root", "Root");
  await ok(p, ["add", "platform", "--title", "Platform", "--parent", "root"]);
  await ok(p, ["accept", "platform", ...Y]);
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await ok(p, ["add", "email", "--title", "Email service", "--parent", "platform"]);
  await ok(p, ["link", "magic", "email", "--type", "depends_on", "--why", "sends the mail"]);
  await ok(p, ["accept", "magic", ...Y]);
  expect(await show(p, "magic")).not.toContain("proposed");
  const a = await show(p, "auth");
  expect(a).not.toContain("proposed");
  expect(a).toContain("parent: platform");
  expect(await show(p, "email")).toContain("proposed");
  expect(await show(p, "magic")).toMatch(/depends_on\s+email.*held/);
}, 60_000);

test("63.3", async () => {
  const p = await decidedStorage();
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "Too heavy"]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await ok(p, ["add", "bench", "--kind", "source", "--title", "Benchmark notes"]);
  await ok(p, ["link", "sqlite", "bench", "--type", "supported_by"]);
  const who = await p.werk(["edit", "sqlite", "--who", "you"]);
  expect(who.code).toBe(0);
  await ok(p, ["edit", "sqlite", "--no-basis", "top of its tree"]);
  await ok(p, ["kill", "sqlite", "--revisit"]);
  const st = await p.werk(["status", "sqlite", "decided"]);
  console.log("63.3 status:", st.code, st.out, st.err);
  expect(st.code).toBe(0);
  await ok(p, ["accept", "sqlite", ...Y]);
  const s = await show(p, "sqlite");
  expect(s).toContain("[decided]");
  expect(s).not.toContain("proposed");
  expect(s).toContain("who: you");
  const o = await show(p, "sqlite:opt0");
  expect(o).not.toContain("proposed");
  expect(o).toContain("Too heavy");
  expect(await show(p, "bench")).not.toContain("proposed");
  expect(s).toMatch(/supported_by\s+bench/);
  expect(s).not.toMatch(/supported_by\s+bench.*held/);
}, 60_000);

test("63.4", async () => {
  const p = await withReal("root", "Root");
  await ok(p, ["add", "platform", "--title", "Platform", "--parent", "root"]);
  await ok(p, ["accept", "platform", ...Y]);
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await ok(p, ["add", "magic:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "weak"]);
  await ok(p, ["link", "magic:opt0", "magic", "--type", "alternative_to"]);
  await ok(p, ["discard", "auth"]);
  for (const id of ["auth", "magic", "magic:opt0"]) expect((await p.werk(["show", id])).code).toBe(1);
  const s = await show(p, "platform");
  expect(s).not.toContain("ghost");
  expect(s).not.toContain("Auth");
  expect(s).toContain("[open]");
}, 60_000);

test("63.5", async () => {
  const p = await decidedStorage();
  await ok(p, ["add", "real", "--title", "Real child", "--parent", "storage", "--who", "me"]);
  await ok(p, ["edit", "real", "--no-basis", "top"]);
  await ok(p, ["kill", "real", "--revisit"]);
  await ok(p, ["status", "real", "decided"]);
  await ok(p, ["accept", "real", ...Y]);
  const before = await show(p, "storage");
  console.log("63.5 before:\n" + before);
  expect(before).not.toMatch(/stale|paused|waiting/);
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage", "--who", "you"]);
  await ok(p, ["edit", "sqlite", "--no-basis", "top"]);
  await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "PG", "--why_not", "heavy"]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await ok(p, ["kill", "sqlite", "--revisit"]);
  const st = await p.werk(["status", "sqlite", "decided"]);
  expect(st.code).toBe(0);
  const mid = await show(p, "storage");
  const strip = (s: string) => s.replace(/^.*(Use SQLite).*\n/gm, "");
  expect(strip(mid)).toBe(strip(before));
  expect(mid).not.toMatch(/stale|paused|waiting/);
  expect(mid.split("\n").filter((l) => /subtree|rollup|unchallenged/.test(l))).toEqual(
    before.split("\n").filter((l) => /subtree|rollup|unchallenged/.test(l)),
  );
  await ok(p, ["accept", "sqlite", ...Y]);
  const after = await show(p, "storage");
  console.log("63.5 after:\n" + after);
  expect(after).not.toBe(before);
  const count = (s: string) => /subtree: (\d+) cards?/.exec(s)![1];
  expect(Number(count(after))).toBe(Number(count(before)) + 1);
}, 90_000);

/** Seed: decided root, decided base. */
function seeded(): Project {
  const p = freshProject();
  seed(p, "node.added", { id: "root", kind: "card", title: "Root" });
  seed(p, "node.added", { id: "base", kind: "card", title: "Base", parent: "root", status: "decided", who: "me", no_basis: "top" });
  seed(p, "kill.added", { id: "base", criterion: { form: "revisit" } });
  return p;
}
const full = (p: Project, kill: boolean, decided: boolean) => {
  seed(p, "node.added", { id: "q", kind: "card", title: "Queue", body: "Jobs wait in a queue.", parent: "root", who: "you" });
  seed(p, "edge.added", { from: "q", to: "base", type: "depends_on", why: "Queue reads Base" });
  seed(p, "node.added", { id: "q:opt0", kind: "option", title: "A stack", why_not: "loses order" });
  seed(p, "edge.added", { from: "q:opt0", to: "q", type: "alternative_to" });
  if (kill) seed(p, "kill.added", { id: "q", criterion: { form: "revisit" } });
  if (decided) seed(p, "node.decided", { id: "q" });
};
/** Split a printed command into tokens, filling placeholders. */
function tokens(cmd: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  for (let m; (m = re.exec(cmd)); ) {
    let t = m[1] ?? m[2]!;
    if (t.includes("|")) t = t.split("|")[0]!;
    if (t === "<card>") t = "base";
    else if (t.includes("<")) t = "filled text";
    out.push(t);
  }
  return out;
}
const printed = (err: string, verb: string, pickNoPlaceholder = false): string[][] => {
  const cmds: string[][] = [];
  for (const l of err.split("\n")) {
    const m = /^\s+(?:or: |then: )?werk (.*)$/.exec(l);
    if (m && m[1]!.startsWith(verb + " ")) cmds.push(tokens(m[1]!));
  }
  return cmds;
};

test("64.1", async () => {
  const p = seeded();
  full(p, false, false);
  const b = lines(p);
  const r = await p.werk(["status", "q", "decided"]);
  expect(r.code).toBe(1);
  expect(r.err).toContain("kill criterion");
  expect(r.err).toMatch(/werk kill q /);
  expect(await show(p, "q")).toContain("[open]");
  expect(lines(p)).toEqual(b);
  const cmd = r.err.split("\n").find((l) => /werk kill q --revisit/.test(l))!;
  expect(cmd).toBeDefined();
  await ok(p, tokens(cmd.trim().replace(/^or: /, "").replace(/^werk /, "")));
  await ok(p, ["status", "q", "decided"]);
  expect(await show(p, "q")).toContain("[decided]");
}, 60_000);

test("64.2", async () => {
  const p = seeded();
  seed(p, "node.added", { id: "q", kind: "card", title: "Queue", body: "Jobs wait.", parent: "root" });
  const b = lines(p);
  const r = await p.werk(["status", "q", "decided"]);
  expect(r.code).toBe(1);
  for (const w of ["who", "basis", "option", "kill criterion"]) expect(r.err).toContain(w);
  expect(lines(p)).toEqual(b);
  expect(await show(p, "q")).toContain("[open]");
  const cmds = [
    ...printed(r.err, "edit").filter((c) => c.includes("--who")),
    ...printed(r.err, "link").filter((c) => c.includes("depends_on")),
    ...printed(r.err, "add"),
    ...printed(r.err, "link").filter((c) => c.includes("alternative_to")),
    ...printed(r.err, "kill").slice(-1),
  ];
  console.log("64.2 cmds:", JSON.stringify(cmds));
  for (const c of cmds) await ok(p, c);
  await ok(p, ["status", "q", "decided"]);
  expect(await show(p, "q")).toContain("[decided]");
}, 60_000);

test("64.3", async () => {
  const p = seeded();
  await ok(p, ["add", "g", "--title", "G", "--parent", "root", "--who", "you"]);
  await ok(p, ["link", "g", "base", "--type", "depends_on", "--why", "G reads Base"]);
  await ok(p, ["add", "g:opt0", "--kind", "option", "--title", "O", "--why_not", "slow"]);
  await ok(p, ["link", "g:opt0", "g", "--type", "alternative_to"]);
  await ok(p, ["kill", "g", "--revisit"]);
  await ok(p, ["add", "h", "--title", "H", "--parent", "root", "--who", "me"]);
  await ok(p, ["kill", "h", "--revisit"]);
  const g = await p.werk(["status", "g", "decided"]);
  expect(g.code).toBe(0);
  expect(await show(p, "g")).toContain("[decided]");
  const b = lines(p);
  const h = await p.werk(["status", "h", "decided"]);
  expect(h.code).toBe(1);
  expect(h.err).toContain("basis");
  expect(h.err).toMatch(/werk link h <card> --type depends_on/);
  expect(await show(p, "h")).not.toContain("[decided]");
  expect(lines(p)).toEqual(b);
}, 60_000);

test("64.4", async () => {
  const p = seeded();
  full(p, true, true);
  const b = lines(p);
  const sb = await show(p, "q");
  const r = await p.werk(["unlink", "q", "base", "--type", "depends_on"]);
  expect(r.code).toBe(1);
  expect(r.err).toContain("basis");
  expect(r.err).toMatch(/werk link q <card> --type depends_on/);
  expect(await show(p, "q")).toBe(sb);
  expect(sb).toContain("[decided]");
  expect(lines(p)).toEqual(b);
}, 60_000);

test("64.5", async () => {
  const p = seeded();
  full(p, true, true);
  const b = lines(p).length;
  await ok(p, ["propose", "q", "--ops", JSON.stringify([{ tag: "elaborated", old: "Jobs wait in a queue.", new: "Jobs queue." }])]);
  await ok(p, ["accept", "q", ...Y]);
  const s = await show(p, "q");
  expect(s).toContain("[decided]");
  expect(s).toContain("Jobs queue.");
  const types = lines(p).slice(b).map((l) => JSON.parse(l).type);
  console.log("64.5 types", types);
  expect(types).toContain("node.reopened");
  expect(types).toContain("node.decided");
}, 60_000);

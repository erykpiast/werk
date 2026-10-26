// Held-out steps that run werk's command line on a fresh project (04, 06, 08, 10, 12, 26).
// The map's view is `werk show`; a note the person types in the map is the note event the map
// writes with the person as actor; a ✓ in the map is an accept with --actor you.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fold } from "../repo/src/map/fold.ts";
import { freshProject, type Project } from "../repo/src/test/project.ts";

const folded = (p: Project, id: string) => fold(readFileSync(join(p.dir, ".werk", "log.jsonl"), "utf8")).nodes.get(id) as unknown as Payload | undefined;

type Payload = Record<string, unknown>;
const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as { seq: number; type: string; actor: string; payload: Payload });

/** Real cards and links, as a person's accepted map holds them. */
function withMap(events: [string, Payload][]): Project {
  const p = freshProject();
  const text = events.map(([type, payload], i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", type, payload }));
  if (text.length > 0) appendFileSync(logOf(p), `${text.join("\n")}\n`);
  return p;
}
const card = (id: string, title: string, parent?: string): [string, Payload] => [
  "node.added",
  { id, kind: "card", title, ...(parent ? { parent } : {}) },
];
const decided = (id: string): [string, Payload] => ["node.decided", { id }];
const edge = (from: string, to: string, type: string, why?: string): [string, Payload] => [
  "edge.added",
  { from, to, type, ...(why ? { why } : {}) },
];

/** A note the person types on a card's thread in the map. */
function personNote(p: Project, id: string, text: string): number {
  const seq = lines(p).length + 1;
  appendFileSync(
    logOf(p),
    `${JSON.stringify({ seq, at: new Date().toISOString(), actor: "you", type: "note.added", payload: { id, text } })}\n`,
  );
  return seq;
}

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run;
}
const show = (p: Project, id: string) => p.werk(["show", id]);

const chatLine = (kind: string, text: string, speaker: string, at: string) =>
  JSON.stringify({ speaker, at, session: "sess-42", kind, text });
function chat(p: Project, name: string, rows: string[]) {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${rows.join("\n")}\n`);
}

// ---------- 04 ----------

test("04.1", async () => {
  const p = withMap([card("checkout", "Checkout flow"), card("other", "Other"), ["node.proposed", { id: "other-ghost", kind: "card", title: "Other ghost", parent: "other" }]]);
  const before = lines(p).length;
  const add = await ok(p, ["add", "retry-payment", "--title", "Retry payment", "--parent", "checkout"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = lines(p);
  expect(after.length).toBe(before + 1);
  expect(after.at(-1)?.type).toBe("node.proposed");
  expect(after.at(-1)?.payload.parent).toBe("checkout");
  const s = (await ok(p, ["show", "retry-payment"])).out;
  expect(s).toContain("proposed");
  expect(s).toContain("parent: checkout  Checkout flow");
  const n = lines(p).length;
  await ok(p, ["accept", "retry-payment", "--actor", "you"]);
  const acc = lines(p);
  expect(acc.length).toBe(n + 1);
  expect(acc.at(-1)?.type).toBe("change.accepted");
  const s2 = (await ok(p, ["show", "retry-payment"])).out;
  expect(s2.split("\n")[0]).not.toContain("proposed");
  expect(s2).toContain("parent: checkout  Checkout flow");
  expect((await ok(p, ["show", "other-ghost"])).out.split("\n")[0]).toContain("proposed");
});

test("04.2", async () => {
  const p = withMap([card("payments", "Payments"), card("fraud-rules", "Fraud rules")]);
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial-refunds", "fraud-rules", "--type", "depends_on", "--why", "a partial refund passes the fraud rules"]);
  await ok(p, ["add", "partial-refunds:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "too coarse"]);
  await ok(p, ["link", "partial-refunds:opt0", "partial-refunds", "--type", "alternative_to"]);
  await ok(p, ["add", "src-refund", "--kind", "source", "--title", "Refund policy", "--url", "https://example.com/r"]);
  await ok(p, ["link", "partial-refunds", "src-refund", "--type", "supported_by"]);
  const held = (await ok(p, ["show", "partial-refunds"])).out;
  const depLine = held.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules")) ?? "";
  expect(depLine).toContain("held");
  const n = lines(p).length;
  await ok(p, ["accept", "partial-refunds", "--actor", "you"]);
  const added = lines(p).slice(n);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((e) => e.type === "change.accepted")).toBe(true);
  expect((await ok(p, ["show", "refunds"])).out.split("\n")[0]).not.toContain("proposed");
  const pr = (await ok(p, ["show", "partial-refunds"])).out;
  expect(pr.split("\n")[0]).not.toContain("proposed");
  expect((await ok(p, ["show", "partial-refunds:opt0"])).out.split("\n")[0]).not.toContain("proposed");
  expect((await ok(p, ["show", "src-refund"])).out.split("\n")[0]).not.toContain("proposed");
  const live = pr.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules")) ?? "";
  expect(live).not.toContain("held");
});

test("04.3", async () => {
  const p = withMap([card("onboarding", "Onboarding")]);
  await ok(p, ["add", "email-verification", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend-email", "--title", "Resend email", "--parent", "email-verification"]);
  await ok(p, ["discard", "email-verification"]);
  for (const id of ["email-verification", "resend-email"]) {
    const r = await show(p, id);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("no node");
  }
  const o = (await ok(p, ["show", "onboarding"])).out;
  expect(o).not.toContain("email-verification");
  expect(o).not.toContain("proposed");
});

test("04.4", async () => {
  const p = withMap([card("search", "Search")]);
  await ok(p, ["add", "search-index", "--title", "Search uses an index", "--why", "Scans are slow", "--parent", "search"]);
  const n = lines(p).length;
  const again = await p.werk(["add", "search-index", "--title", "Search uses no index", "--why", "Indexes are costly", "--parent", "search"]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("frozen");
  expect(lines(p).length).toBe(n);
  const s = (await ok(p, ["show", "search-index"])).out;
  expect(s).toContain("Search uses an index");
  expect(s).toContain("why: Scans are slow");
});

test("04.5", async () => {
  const p = withMap([card("platform", "Platform")]);
  await ok(p, ["add", "audit-log", "--title", "Audit log", "--parent", "platform"]);
  const n = lines(p).length;
  const no = await p.werk(["accept", "audit-log"]);
  expect(no.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect((await ok(p, ["show", "audit-log"])).out.split("\n")[0]).toContain("proposed");
  const yes = await p.werk(["accept", "audit-log", "--actor", "you"]);
  expect(yes.code).toBe(0);
  expect((await ok(p, ["show", "audit-log"])).out.split("\n")[0]).not.toContain("proposed");
});

// ---------- 06 ----------

function decidedWithChat(): Project {
  const p = withMap([card("retry", "Retry reuses the link"), decided("retry")]);
  chat(p, "talk", [
    chatLine("spoken", "should a retry send a new link?", "person", "2026-01-01T10:00:00Z"),
    chatLine("spoken", "a retry reuses the same link every time", "agent", "2026-01-01T10:01:00Z"),
  ]);
  return p;
}

test("06.1", async () => {
  const p = decidedWithChat();
  const before = (await ok(p, ["show", "retry"])).out;
  const q = await ok(p, ["quote", "retry", "talk", "reuses the same link"]);
  expect(q.out).toContain("proposed");
  expect(q.out).not.toContain("added");
  const ex = (await ok(p, ["show", "retry:ex0"])).out;
  expect(ex.split("\n")[0]).toContain("proposed");
  const c = (await ok(p, ["show", "retry"])).out;
  const linkLine = c.split("\n").find((l) => l.includes("supported_by") && l.includes("retry:ex0")) ?? "";
  expect(linkLine).toContain("held");
  expect(c.split("\n")[0]).toBe(before.split("\n")[0]);
  expect(c.split("\n")[1]).toBe(before.split("\n")[1]);
  expect(c).toContain("[decided]");
});

test("06.2", async () => {
  const p = decidedWithChat();
  await ok(p, ["quote", "retry", "talk", "reuses the same link"]);
  expect((await ok(p, ["show", "retry:ex0"])).out.split("\n")[0]).toContain("proposed");
  await ok(p, ["accept", "retry:ex0", "--actor", "you"]);
  expect((await ok(p, ["show", "retry:ex0"])).out.split("\n")[0]).not.toContain("proposed");
  const c = (await ok(p, ["show", "retry"])).out;
  const linkLine = c.split("\n").find((l) => l.includes("supported_by") && l.includes("retry:ex0")) ?? "";
  expect(linkLine).toContain("->");
  expect(linkLine).not.toContain("held");
});

// ---------- 08 ----------

const authTree = () =>
  withMap([
    card("root", "Root"),
    card("auth", "Auth"),
    card("login", "Login", "auth"),
    card("session", "Session", "auth"),
    card("audit", "Audit"),
    decided("auth"),
    edge("login", "audit", "supported_by"),
  ]);

test("08.1", async () => {
  // A card links to a card with depends_on; supported_by needs a source, so use depends_on.
  const p = withMap([
    card("auth", "Auth"),
    card("login", "Login", "auth"),
    card("session", "Session", "auth"),
    card("audit", "Audit"),
    decided("auth"),
    edge("login", "audit", "depends_on", "login writes the audit trail"),
  ]);
  const n = lines(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  for (const id of ["auth", "login", "session"]) expect((await show(p, id)).code).not.toBe(0);
  const ev = lines(p).slice(n);
  expect(ev.length).toBe(1);
  expect(ev[0]?.type).toBe("node.removed");
  const rem = (await ok(p, ["removed"])).out;
  expect(rem).toContain("auth");
  expect(rem).toContain("login");
  expect(rem).toContain("session");
  expect((await ok(p, ["show", "audit"])).out).not.toContain("login");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
  const a = (await ok(p, ["show", "audit"])).out;
  expect(a).toContain("login");
  expect((await ok(p, ["removed"])).out).toBe("no card is removed\n");
});

test("08.2", async () => {
  const p = withMap([card("platform", "Platform"), card("auth", "Auth", "platform"), card("login", "Login", "auth"), card("session", "Session", "auth")]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect((await show(p, "auth")).code).not.toBe(0);
  expect((await ok(p, ["show", "login"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: platform");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
});

test("08.3", async () => {
  const p = withMap([card("a", "A"), card("b", "B"), card("login", "Login", "a"), card("session", "Session", "b"), edge("login", "session", "depends_on", "login opens a session")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const l = (await ok(p, ["show", "login"])).out;
  expect(l).not.toContain("depends_on");
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toContain("depends_on");
});

test("08.4", async () => {
  const p = withMap([
    card("login", "Login"),
    card("billing", "Billing"),
    ["node.added", { id: "rfc-6749", kind: "source", title: "RFC 6749", url: "https://www.rfc-editor.org/rfc/rfc6749" }],
    edge("login", "rfc-6749", "supported_by"),
    edge("billing", "rfc-6749", "supported_by"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const src = (await ok(p, ["show", "rfc-6749"])).out;
  expect(src).toContain("billing");
  const n = lines(p).length;
  const add = await p.werk(["add", "login", "--title", "New login"]);
  expect(add.code).not.toBe(0);
  expect(add.err).toContain("restore #login");
  expect(lines(p).length).toBe(n);
  expect((await show(p, "login")).code).not.toBe(0);
});

test("08.5", async () => {
  const p = withMap([card("login", "Login")]);
  const n = lines(p).length;
  const r = await p.werk(["remove", "login"]);
  expect(r.code).not.toBe(0);
  expect((await show(p, "login")).code).toBe(0);
  expect(lines(p).length).toBe(n);
});

test("08.6", async () => {
  const p = withMap([card("login", "Login")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const n = lines(p).length;
  const r = await p.werk(["restore", "login"]);
  expect(r.code).not.toBe(0);
  expect((await show(p, "login")).code).not.toBe(0);
  expect(lines(p).length).toBe(n);
});

// ---------- 10 ----------

test("10.1", async () => {
  const p = withMap([card("auth-login", "Login uses magic links"), decided("auth-login")]);
  await ok(p, ["say", "auth-login", "Should expired links show a retry button?"]);
  const s = (await ok(p, ["show", "auth-login"])).out;
  const line = s.split("\n").find((l) => l.includes("Should expired links show a retry button?")) ?? "";
  expect(line).not.toBe("");
  expect(line).toContain("agent");
});

test("10.2", async () => {
  const p = withMap([card("auth-login", "Login")]);
  const seqs = ["first", "second", "third", "fourth"].map((t) => personNote(p, "auth-login", t));
  const all = (await ok(p, ["inbox"])).out;
  const order = ["first", "second", "third", "fourth"].map((t) => all.indexOf(`    ${t}\n`));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  for (const s of seqs) expect(all).toContain(`[${s}] #auth-login`);
  const since = (await ok(p, ["inbox", "--since", String(seqs[0])])).out;
  expect(since).not.toContain("    first\n");
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(`    ${t}\n`);
  const capped = (await ok(p, ["inbox", "--since", String(seqs[0]), "-n", "2"])).out;
  expect(capped).toContain("    second\n");
  expect(capped).toContain("    third\n");
  expect(capped).not.toContain("fourth");
  expect(capped).not.toContain("    first\n");
});

test("10.3", async () => {
  const p = withMap([card("auth", "Auth")]);
  await ok(p, ["add", "auth-retry", "--title", "Retry sends a new link", "--parent", "auth"]);
  expect((await ok(p, ["show", "auth-retry"])).out.split("\n")[0]).toContain("proposed");
  personNote(p, "auth-retry", "No — retry must reuse the same link");
  await ok(p, ["say", "auth-retry", "Understood, I will correct it"]);
  await ok(p, ["discard", "auth-retry"]);
  await ok(p, ["add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "auth"]);
  let s = (await ok(p, ["show", "auth-retry"])).out;
  const a = s.indexOf("No — retry must reuse the same link");
  const b = s.indexOf("Understood, I will correct it");
  const m = s.indexOf("proposed again");
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(-1);
  expect(m).toBeGreaterThan(Math.max(a, b));
  expect(s.split("proposed again").length - 1).toBe(1);
  expect(s).toContain("Retry reuses the same link");
  personNote(p, "auth-retry", "Good, accept");
  s = (await ok(p, ["show", "auth-retry"])).out;
  expect(s.indexOf("Good, accept")).toBeGreaterThan(s.indexOf("proposed again"));
});

test("10.4", async () => {
  const p = withMap([card("cache", "Cache")]);
  await ok(p, ["add", "cache-ttl", "--title", "Cache entries live 60 seconds", "--parent", "cache"]);
  personNote(p, "cache-ttl", "Why 60 seconds?");
  await ok(p, ["discard", "cache-ttl"]);
  const inbox = (await ok(p, ["inbox"])).out;
  expect(inbox).toContain("#cache-ttl");
  expect(inbox).toContain("Why 60 seconds?");
  await ok(p, ["add", "cache-ttl", "--title", "Cache entries live 30 seconds", "--parent", "cache"]);
  const s = (await ok(p, ["show", "cache-ttl"])).out;
  expect(s.indexOf("Why 60 seconds?")).toBeGreaterThan(-1);
  expect(s.indexOf("proposed again")).toBeGreaterThan(s.indexOf("Why 60 seconds?"));
  expect(s.split("proposed again").length - 1).toBe(1);
});

test("10.5", async () => {
  // An excerpt only comes from a quote, so the map's excerpt "#src-rfc-quote" is seeded as the quote event.
  const p = withMap([
    card("retry", "Retry"),
    ["node.added", { id: "src-rfc", kind: "source", title: "The RFC", url: "https://example.com/rfc" }],
    edge("retry", "src-rfc", "supported_by"),
  ]);
  chat(p, "rfc-talk", [chatLine("spoken", "the RFC says a client may retry once", "person", "2026-01-01T10:00:00Z")]);
  appendFileSync(
    logOf(p),
    `${JSON.stringify({ seq: 4, at: "t", actor: "agent", type: "excerpt.quoted", payload: { id: "src-rfc-quote", title: "a client may retry once", card: "retry", conversation: "rfc-talk", session: "sess-42", message: 0, start: 13, end: 36, speaker: "person", said_at: "2026-01-01T10:00:00Z" } })}\n`,
  );
  expect((await ok(p, ["show", "src-rfc-quote"])).out.split("\n")[0]).toContain("excerpt");
  const r = await p.werk(["say", "src-rfc-quote", "This quote supports the retry decision"]);
  expect(r.code).toBe(0);
  expect((await ok(p, ["show", "src-rfc-quote"])).out).toContain("This quote supports the retry decision");
});

// ---------- 12 ----------

function quoteChat(p: Project) {
  chat(p, "conv", [
    chatLine("tool_result", "listing files", "agent", "2026-01-01T09:00:00Z"),
    chatLine("spoken", "how do we store the history?", "person", "2026-01-01T09:01:00Z"),
    chatLine("spoken", "we keep one log per conversation and never rewrite it", "agent", "2026-01-01T09:02:00Z"),
  ]);
}

test("12.1", async () => {
  const p = withMap([card("store", "Store")]);
  quoteChat(p);
  await ok(p, ["add", "history", "--title", "History is one log", "--parent", "store"]);
  const n = lines(p).length;
  const q = await p.werk(["quote", "history", "conv", "one log per conversation"]);
  expect(q.code).toBe(0);
  const ex = (await ok(p, ["show", "history:ex0"])).out;
  expect(ex.split("\n")[0]).toContain("proposed");
  expect(ex).toContain("one log per conversation");
  const c = (await ok(p, ["show", "history"])).out;
  expect(c).toContain("supported_by");
  const ev = lines(p).slice(n);
  expect(ev.length).toBe(1);
  const pl = ev[0]?.payload ?? {};
  expect(pl.title).toBe("one log per conversation");
  expect(pl.speaker).toBe("agent");
  expect(pl.said_at).toBe("2026-01-01T09:02:00Z");
  expect(pl.session).toBe("sess-42");
  const text = "we keep one log per conversation and never rewrite it";
  expect(pl.start).toBe(text.indexOf("one log per conversation"));
  expect(pl.end).toBe(text.indexOf("one log per conversation") + "one log per conversation".length);
  expect(ev[0]?.payload.card).toBe("history");
  expect(folded(p, "history:ex0")).toMatchObject({ title: "one log per conversation", speaker: "agent", said_at: "2026-01-01T09:02:00Z", session: "sess-42", start: pl.start, end: pl.end });
  // The step: the message position is 3.
  expect(pl.message).toBe(3);
});

test("12.2", async () => {
  const p = withMap([card("plan", "Plan")]);
  chat(p, "conv", [
    chatLine("spoken", "ship the reader first", "person", "t1"),
    chatLine("spoken", "agreed, ship the reader first", "agent", "t2"),
    chatLine("spoken", "retry, then retry again", "person", "t3"),
  ]);
  await ok(p, ["add", "order", "--title", "Order", "--parent", "plan"]);
  const n = lines(p).length;
  const two = await p.werk(["quote", "order", "conv", "ship the reader first"]);
  expect(two.code).not.toBe(0);
  expect(two.err).toContain("2 messages");
  const inOne = await p.werk(["quote", "order", "conv", "retry"]);
  expect(inOne.code).not.toBe(0);
  expect(inOne.err).toMatch(/2 (matches|places|times)/);
  const none = await p.werk(["quote", "order", "conv", "a sentence nobody said"]);
  expect(none.code).not.toBe(0);
  expect(none.err).toMatch(/no (exact )?match/);
  expect(lines(p).length).toBe(n);
  expect((await show(p, "order:ex0")).code).not.toBe(0);
  expect((await ok(p, ["show", "order"])).out).not.toContain("supported_by");
});

test("12.3", async () => {
  const p = withMap([card("ops", "Ops")]);
  chat(p, "conv", [
    chatLine("spoken", "why did the job die?", "person", "t1"),
    chatLine("tool_call", "grep 'exit code 137' runner.log", "agent", "t2"),
    chatLine("tool_result", "exit code 137 from the runner", "agent", "t3"),
    chatLine("tooling", "note: exit code 137 means killed", "agent", "t4"),
    chatLine("spoken", "it ran out of memory", "agent", "t5"),
  ]);
  await ok(p, ["add", "oom", "--title", "OOM", "--parent", "ops"]);
  const n = lines(p).length;
  const r = await p.werk(["quote", "oom", "conv", "exit code 137"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/no (exact )?match/);
  expect(lines(p).length).toBe(n);
  expect((await show(p, "oom:ex0")).code).not.toBe(0);
});

test("12.4", async () => {
  const p = withMap([card("store", "Store")]);
  quoteChat(p);
  await ok(p, ["add", "history", "--title", "History is one log", "--parent", "store"]);
  await ok(p, ["quote", "history", "conv", "one log per conversation"]);
  const ex = "history:ex0";
  let n = lines(p).length;
  const plain = await p.werk(["add", "history:ex1", "--kind", "excerpt", "--title", "my own words"]);
  expect(plain.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  const retitle = await p.werk(["propose", ex, "--title", "other words"]);
  expect(retitle.code).not.toBe(0);
  const edit = await p.werk(["propose", ex, "--ops", JSON.stringify([{ tag: "new", new: "other words" }])]);
  expect(edit.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect((await ok(p, ["show", ex])).out.split("\n")[1]).toBe("one log per conversation");
  const say = await p.werk(["say", ex, "nice quote"]);
  expect(say.code).toBe(0);
  expect((await ok(p, ["show", ex])).out).toContain("nice quote");
  await ok(p, ["accept", "history", "--actor", "you"]);
  n = lines(p).length;
  const again = await p.werk(["propose", ex, "--title", "other words"]);
  expect(again.code).not.toBe(0);
  const again2 = await p.werk(["propose", ex, "--ops", JSON.stringify([{ tag: "new", new: "other words" }])]);
  expect(again2.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect((await ok(p, ["show", ex])).out.split("\n")[1]).toBe("one log per conversation");
});

test("12.5", async () => {
  const p = withMap([card("store", "Store")]);
  quoteChat(p);
  await ok(p, ["add", "first", "--title", "First", "--parent", "store"]);
  await ok(p, ["add", "second", "--title", "Second", "--parent", "store"]);
  await ok(p, ["quote", "first", "conv", "one log per conversation"]);
  await ok(p, ["quote", "second", "conv", "never rewrite it"]);
  await ok(p, ["discard", "first"]);
  expect((await show(p, "first")).code).not.toBe(0);
  expect((await show(p, "first:ex0")).code).not.toBe(0);
  await ok(p, ["accept", "second", "--actor", "you"]);
  expect((await ok(p, ["show", "second"])).out.split("\n")[0]).not.toContain("proposed");
  expect((await ok(p, ["show", "second:ex0"])).out.split("\n")[0]).not.toContain("proposed");
  const ev = lines(p).find((e) => e.type === "excerpt.quoted" && e.payload.id === "second:ex0");
  expect(ev?.payload).toMatchObject({ title: "never rewrite it", speaker: "agent", said_at: "2026-01-01T09:02:00Z", session: "sess-42" });
  // The excerpt's words, speaker, time, session, message position and span show on the accepted excerpt.
  expect((await ok(p, ["show", "second:ex0"])).out).toContain("never rewrite it");
  const t = "we keep one log per conversation and never rewrite it";
  expect(folded(p, "second:ex0")).toMatchObject({ title: "never rewrite it", speaker: "agent", said_at: "2026-01-01T09:02:00Z", session: "sess-42", message: 2, start: t.indexOf("never rewrite it"), end: t.length, proposed: false });
});

// ---------- 26 ----------

const SPEC3 = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nThe command line.\n`;

const ticket = (o: { title?: string; cites: string; blocked: string; stories: string; build?: string; checks?: string }) =>
  `${o.title === undefined ? "" : `title: ${o.title}\n`}cites: ${o.cites}
blocked_by: ${o.blocked}
stories: ${o.stories}
touches: map view, decision log

## What to build

${o.build ?? "A person opens a decided card and presses reopen."}

## Acceptance criteria

- [ ] A reopened card shows as open in the map.

## Checks

${o.checks ?? ""}
`;

function ticketProject(events: [string, Payload][], spec: string, files: Record<string, string>): Project {
  const p = withMap(events);
  writeFileSync(join(p.dir, "spec.md"), spec);
  mkdirSync(join(p.dir, "tickets"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", name), text);
  return p;
}
const tcheck = (p: Project, root = "#root", spec = "spec.md") => p.werk(["ticket-check", "tickets", "--root", root, "--spec", spec]);

const baseMap = (): [string, Payload][] => [card("root", "Root"), card("c1", "One", "root"), card("c2", "Two", "root"), decided("root"), decided("c1"), decided("c2")];
const validFiles = () => ({
  "01-one.md": ticket({ title: "A person can do one", cites: "root, c1", blocked: "", stories: "1", checks: "- `make test`" }),
  "02-two.md": ticket({ title: "A person can do two", cites: "#c2", blocked: "1", stories: "2" }),
});

test("26.1", async () => {
  const p = ticketProject(baseMap(), SPEC3(2), validFiles());
  const r = await tcheck(p);
  const outLines = r.out.trim().split("\n");
  expect(outLines.length).toBe(1);
  expect(outLines.at(-1)).toMatch(/\b0 failures/);
  expect(r.code).toBe(0);
});

test("26.2", async () => {
  const files = validFiles();
  // Line 9 of the What to build section names src/loop.ts.
  const build = ["Line one.", "Line two.", "Line three.", "Line four.", "Line five.", "Line six.", "Line seven.", "Line eight.", "The loop lives in src/loop.ts today.", "The Makefile holds the target."].join("\n");
  files["01-one.md"] = ticket({ title: "A person can do one", cites: "root, c1", blocked: "", stories: "1", checks: "- `make test`", build });
  files["02-two.md"] = ticket({ title: "A person can do two", cites: "#c2", blocked: "1", stories: "2", build: `A person does two. ${"pad ".repeat(1100)}` });
  const p = ticketProject(baseMap(), SPEC3(2), files);
  expect(readFileSync(join(p.dir, "tickets", "02-two.md"), "utf8").length).toBeGreaterThan(4000);
  const r = await tcheck(p);
  const out = r.out.split("\n");
  const fp = out.find((l) => l.startsWith("01-one.md") && l.includes("src/loop.ts")) ?? "";
  expect(fp).toMatch(/no-file-paths|file path/);
  expect(out.some((l) => l.includes("Makefile"))).toBe(false);
  const size = out.find((l) => l.startsWith("02-two.md")) ?? "";
  expect(size).toMatch(/size/);
  expect(out.filter((l) => l !== "").at(-1)).not.toMatch(/\b0 failures/);
  expect(r.code).toBe(1);
  console.log("26.2 output:\n" + r.out);
  // The step: src/loop.ts is listed with line 9 (its line in the What to build section).
  expect(fp).toMatch(/line 9\b/);
});

test("26.3", async () => {
  const events: [string, Payload][] = [...baseMap(), ["node.proposed", { id: "ghosty", kind: "card", title: "Ghost", parent: "root" }]];
  const p = ticketProject(events, SPEC3(3), {
    "01-one.md": ticket({ title: "A person can do one", cites: "root, c1", blocked: "", stories: "1" }),
    "02-two.md": ticket({ title: "A person can do two", cites: "c1", blocked: "3", stories: "2" }),
    "03-three.md": ticket({ title: "A person can do three", cites: "c1", blocked: "2", stories: "2" }),
  });
  const r = await tcheck(p);
  const out = r.out.split("\n");
  const set = out.filter((l) => l.startsWith("ticket set"));
  expect(set.filter((l) => l.includes("c2")).length).toBe(1);
  expect(set.filter((l) => /stor/.test(l) && /\b3\b/.test(l)).length).toBe(1);
  const cyc = out.find((l) => l.includes("blocked_by")) ?? "";
  expect(cyc).toMatch(/2/);
  expect(cyc).toMatch(/3/);
  expect(out.some((l) => l.includes("ghosty"))).toBe(false);
  expect(r.code).toBe(1);
});

test("26.4", async () => {
  const p = ticketProject([card("root", "Root"), card("c1", "One", "root"), decided("root"), decided("c1")], SPEC3(1), {
    "01-one.md": ticket({ cites: "root, c1", blocked: "", stories: "1" }),
  });
  const r = await tcheck(p);
  const out = r.out.split("\n").filter((l) => l !== "");
  const own = out.filter((l) => l.startsWith("01-one.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toMatch(/title/);
  expect(out.some((l) => l.startsWith("ticket set") && l.includes("c1"))).toBe(true);
  expect(out.some((l) => l.startsWith("ticket set") && /stor/.test(l) && /\b1\b/.test(l))).toBe(true);
  expect(r.code).toBe(1);
});

test("26.5", async () => {
  const p = ticketProject(baseMap(), SPEC3(2), validFiles());
  const missing = await tcheck(p, "#root", "no-such-spec.md");
  expect(`${missing.out}${missing.err}`).toMatch(/spec/i);
  expect(`${missing.out}${missing.err}`).toMatch(/no-such-spec\.md|missing|not found|does not exist|no file/i);
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad-spec.md"), "# Spec\n\n## Goals\n\nNone.\n");
  expect((await tcheck(p, "#root", "bad-spec.md")).code).toBe(2);
  expect((await tcheck(p, "#nope")).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--spec", "spec.md"])).code).toBe(2);
});

void authTree;

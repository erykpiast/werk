// Held-out steps 04.x, 06.x, 08.x, 10.x and 12.x, driven through werk's command line.
// The map has no browser view in this checkout; `werk show` is the card view the tests read.
import { expect, test } from "bun:test";
import { decided, project, real } from "./helpers.ts";

const header = (out: string) => out.split("\n")[0] ?? "";
const isGhost = (out: string) => /\bproposed\b/.test(header(out));
const linkLine = (out: string, type: string, to: string) =>
  out.split("\n").find((l) => l.includes(type) && new RegExp(`\\s${to.replace(/[:]/g, "\\$&")}\\s`).test(`${l} `));

test("04.1", async () => {
  const p = project();
  p.seed([real("checkout-flow", "Checkout flow"), { type: "node.proposed", actor: "agent", payload: { id: "other-ghost", kind: "card", title: "Other ghost" } }]);
  const before = p.events().length;
  const add = await p.w("add", "retry-payment", "--title", "Retry payment", "--why", "A failed payment can retry.", "--parent", "checkout-flow");
  expect(add.code).toBe(0);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const fresh = p.events().slice(before);
  expect(fresh).toHaveLength(1);
  expect(fresh[0]?.type).toBe("node.proposed");
  expect(fresh[0]?.payload.parent).toBe("checkout-flow");
  const shown = await p.w("show", "retry-payment");
  expect(isGhost(shown.out)).toBe(true);
  expect(shown.out).toContain("parent: checkout-flow");
  const n = p.events().length;
  const acc = await p.w("accept", "retry-payment", "--actor", "you");
  expect(acc.code).toBe(0);
  const accEvents = p.events().slice(n);
  expect(accEvents).toHaveLength(1);
  expect(accEvents[0]?.type).toBe("change.accepted");
  const after = await p.w("show", "retry-payment");
  expect(isGhost(after.out)).toBe(false);
  expect(after.out).toContain("parent: checkout-flow");
  expect(isGhost((await p.w("show", "other-ghost")).out)).toBe(true);
});

test("04.2", async () => {
  const p = project();
  p.seed([real("payments", "Payments"), real("fraud-rules", "Fraud rules")]);
  const ok = async (...a: string[]) => {
    const r = await p.w(...a);
    if (r.code !== 0) throw new Error(`${a.join(" ")}: ${r.err}`);
    return r;
  };
  await ok("add", "refunds", "--title", "Refunds", "--why", "w", "--parent", "payments");
  await ok("add", "partial-refunds", "--title", "Partial refunds", "--why", "w", "--parent", "refunds");
  await ok("link", "partial-refunds", "fraud-rules", "--type", "depends_on", "--why", "a partial refund passes the fraud rules");
  await ok("add", "partial-refunds:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "too coarse");
  await ok("link", "partial-refunds:opt0", "partial-refunds", "--type", "alternative_to");
  await ok("add", "src-refund-policy", "--kind", "source", "--title", "Refund policy", "--url", "https://example.com/p", "--finding", "partial refunds are allowed");
  await ok("link", "partial-refunds", "src-refund-policy", "--type", "supported_by");
  const held = await p.w("show", "partial-refunds");
  expect(linkLine(held.out, "depends_on", "fraud-rules")).toContain("held");
  const n = p.events().length;
  await ok("accept", "partial-refunds", "--actor", "you");
  const fresh = p.events().slice(n);
  expect(fresh.length).toBeGreaterThan(0);
  expect(fresh.every((e) => e.type === "change.accepted")).toBe(true);
  expect(isGhost((await p.w("show", "refunds")).out)).toBe(false);
  const live = await p.w("show", "partial-refunds");
  expect(isGhost(live.out)).toBe(false);
  expect(isGhost((await p.w("show", "partial-refunds:opt0")).out)).toBe(false);
  expect(isGhost((await p.w("show", "src-refund-policy")).out)).toBe(false);
  const dep = linkLine(live.out, "depends_on", "fraud-rules");
  expect(dep).toBeDefined();
  expect(dep).not.toContain("held");
});

test("04.3", async () => {
  const p = project();
  p.seed([real("onboarding", "Onboarding")]);
  expect((await p.w("add", "email-verification", "--title", "Email verification", "--why", "w", "--parent", "onboarding")).code).toBe(0);
  expect((await p.w("add", "resend-email", "--title", "Resend email", "--why", "w", "--parent", "email-verification")).code).toBe(0);
  expect((await p.w("discard", "email-verification")).code).toBe(0);
  for (const id of ["email-verification", "resend-email"]) {
    const r = await p.w("show", id);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("no node");
  }
  const on = await p.w("show", "onboarding");
  expect(on.out).not.toContain("ghost");
  expect(on.out).not.toContain("email-verification");
});

test("04.4", async () => {
  const p = project();
  p.seed([real("search", "Search")]);
  expect((await p.w("add", "search-index", "--title", "Search index", "--why", "Search reads one index.", "--parent", "search")).code).toBe(0);
  const n = p.events().length;
  const again = await p.w("add", "search-index", "--title", "Search index two", "--why", "A different why.", "--parent", "search");
  expect(again.code).not.toBe(0);
  expect(p.events().length).toBe(n);
  const shown = await p.w("show", "search-index");
  expect(shown.out).toContain("Search index\n");
  expect(shown.out).toContain("why: Search reads one index.");
  // The refusal names the rule that ghost words are frozen.
  expect(again.err.toLowerCase()).toContain("frozen");
});

test("04.5", async () => {
  const p = project();
  p.seed([real("platform", "Platform")]);
  expect((await p.w("add", "audit-log", "--title", "Audit log", "--why", "w", "--parent", "platform")).code).toBe(0);
  const n = p.events().length;
  const no = await p.w("accept", "audit-log");
  expect(no.code).not.toBe(0);
  expect(p.events().length).toBe(n);
  expect(isGhost((await p.w("show", "audit-log")).out)).toBe(true);
  const yes = await p.w("accept", "audit-log", "--actor", "you");
  expect(yes.code).toBe(0);
  expect(isGhost((await p.w("show", "audit-log")).out)).toBe(false);
});

const spoken = (speaker: string, text: string, at: string, session = "sess-1") => ({ speaker, at, session, kind: "spoken", text });

function withDecidedCard() {
  const p = project();
  p.seed([real("retry", "Retry policy"), decided("retry")]);
  p.chat("talk", [spoken("person", "should we retry?", "2026-10-25T09:00:00Z"), spoken("agent", "we retry three times with backoff", "2026-10-25T09:01:00Z")]);
  return p;
}

test("06.1", async () => {
  const p = withDecidedCard();
  const before = await p.w("show", "retry");
  const q = await p.w("quote", "retry", "talk", "retry three times");
  expect(q.code).toBe(0);
  expect(q.out).toContain("proposed");
  expect(q.out).not.toContain("added");
  const ex = await p.w("show", "retry:ex0");
  expect(isGhost(ex.out)).toBe(true);
  const card = await p.w("show", "retry");
  const link = card.out.split("\n").find((l) => l.includes("retry:ex0"));
  expect(link).toBeDefined();
  expect(link).toMatch(/held|pending/);
  expect(header(card.out)).toBe(header(before.out));
  expect(header(card.out)).toContain("[decided]");
  expect(card.out.split("\n")[1]).toBe("Retry policy");
});

test("06.2", async () => {
  const p = withDecidedCard();
  expect((await p.w("quote", "retry", "talk", "retry three times")).code).toBe(0);
  expect(isGhost((await p.w("show", "retry:ex0")).out)).toBe(true);
  // The ✓ in the map is the accept the person asks for.
  const n = p.events().length;
  expect((await p.w("accept", "retry:ex0", "--actor", "you")).code).toBe(0);
  expect(p.events().length - n).toBe(1);
  expect(isGhost((await p.w("show", "retry:ex0")).out)).toBe(false);
  const card = await p.w("show", "retry");
  const lines = card.out.split("\n").filter((l) => l.includes("retry:ex0") || l.includes("retry three times"));
  expect(lines.length).toBeGreaterThan(0);
  expect(card.out).toContain("retry three times");
  for (const l of lines) expect(l).not.toMatch(/held|pending|ghost/);
});

function authTree() {
  const p = project();
  p.seed([
    real("auth", "Auth"),
    real("login", "Login", "auth"),
    real("session", "Session", "auth"),
    real("audit", "Audit"),
    decided("auth"),
    { type: "edge.added", payload: { from: "login", to: "audit", type: "depends_on", why: "a login writes an audit line" } },
  ]);
  return p;
}

test("08.1", async () => {
  const p = authTree();
  const n = p.events().length;
  const rm = await p.w("remove", "auth", "--actor", "you");
  expect(rm.code).toBe(0);
  const fresh = p.events().slice(n);
  expect(fresh).toHaveLength(1);
  expect(fresh[0]?.type).toBe("node.removed");
  for (const id of ["auth", "login", "session"]) expect((await p.w("show", id)).code).not.toBe(0);
  const removed = await p.w("removed");
  expect(removed.out).toContain("auth");
  expect(removed.out).toContain("login");
  expect(removed.out).toContain("session");
  const audit = await p.w("show", "audit");
  expect(audit.out).not.toContain("login");
  expect((await p.w("restore", "auth", "--actor", "you")).code).toBe(0);
  expect((await p.w("show", "auth")).code).toBe(0);
  expect((await p.w("show", "login")).out).toContain("parent: auth");
  expect((await p.w("show", "session")).out).toContain("parent: auth");
  expect(linkLine((await p.w("show", "login")).out, "depends_on", "audit")).toBeDefined();
  expect((await p.w("show", "audit")).out).toContain("login");
  expect((await p.w("removed")).out).toBe("no card is removed\n");
});

test("08.2", async () => {
  const p = project();
  p.seed([real("platform", "Platform"), real("auth", "Auth", "platform"), real("login", "Login", "auth"), real("session", "Session", "auth")]);
  expect((await p.w("remove", "auth", "--actor", "you", "--reparent")).code).toBe(0);
  expect((await p.w("show", "auth")).code).not.toBe(0);
  expect((await p.w("show", "login")).out).toContain("parent: platform");
  expect((await p.w("show", "session")).out).toContain("parent: platform");
  expect((await p.w("restore", "auth", "--actor", "you")).code).toBe(0);
  expect((await p.w("show", "auth")).out).toContain("parent: platform");
  for (const id of ["login", "session"]) {
    const out = (await p.w("show", id)).out;
    expect(out).toContain("parent: auth");
    expect(out).not.toContain("parent: platform");
  }
});

test("08.3", async () => {
  const p = project();
  p.seed([
    real("identity", "Identity"),
    real("state", "State"),
    real("login", "Login", "identity"),
    real("session", "Session", "state"),
    { type: "edge.added", payload: { from: "login", to: "session", type: "depends_on", why: "a login opens a session" } },
  ]);
  expect((await p.w("remove", "login", "--actor", "you")).code).toBe(0);
  expect((await p.w("remove", "session", "--actor", "you")).code).toBe(0);
  expect((await p.w("restore", "login", "--actor", "you")).code).toBe(0);
  const login = await p.w("show", "login");
  expect(login.code).toBe(0);
  expect(login.out).not.toContain("session");
  expect((await p.w("restore", "session", "--actor", "you")).code).toBe(0);
  expect(linkLine((await p.w("show", "login")).out, "depends_on", "session")).toBeDefined();
});

test("08.4", async () => {
  const p = project();
  p.seed([
    real("login", "Login"),
    real("billing", "Billing"),
    { type: "node.added", payload: { id: "rfc-6749", kind: "source", title: "RFC 6749", url: "https://www.rfc-editor.org/rfc/rfc6749", finding: "OAuth 2.0" } },
    { type: "edge.added", payload: { from: "login", to: "rfc-6749", type: "supported_by" } },
    { type: "edge.added", payload: { from: "billing", to: "rfc-6749", type: "supported_by" } },
  ]);
  expect((await p.w("remove", "login", "--actor", "you")).code).toBe(0);
  const src = await p.w("show", "rfc-6749");
  expect(src.code).toBe(0);
  expect(src.out).toContain("billing");
  const n = p.events().length;
  const add = await p.w("add", "login", "--title", "Login again", "--why", "w");
  expect(add.code).not.toBe(0);
  expect(add.err).toContain("restore");
  expect(p.events().length).toBe(n);
  expect((await p.w("show", "login")).code).not.toBe(0);
});

test("08.5", async () => {
  const p = project();
  p.seed([real("login", "Login")]);
  const n = p.events().length;
  const rm = await p.w("remove", "login");
  expect(rm.code).not.toBe(0);
  expect((await p.w("show", "login")).code).toBe(0);
  expect(p.events().length).toBe(n);
});

test("08.6", async () => {
  const p = project();
  p.seed([real("login", "Login")]);
  expect((await p.w("remove", "login", "--actor", "you")).code).toBe(0);
  const n = p.events().length;
  const rs = await p.w("restore", "login");
  expect(rs.code).not.toBe(0);
  expect((await p.w("show", "login")).code).not.toBe(0);
  expect(p.events().length).toBe(n);
});

const personNote = (id: string, text: string) => ({ type: "note.added", actor: "you", payload: { id, text } });

test("10.1", async () => {
  const p = project();
  p.seed([real("auth-login", "Login uses magic links"), decided("auth-login")]);
  const say = await p.w("say", "auth-login", "Should expired links show a retry button?");
  expect(say.code).toBe(0);
  const shown = await p.w("show", "#auth-login");
  expect(shown.out).toContain("Login uses magic links");
  const line = shown.out.split("\n").find((l) => l.includes("Should expired links show a retry button?"));
  expect(line).toBeDefined();
  expect(line).toContain("agent");
});

test("10.2", async () => {
  const p = project();
  p.seed([real("auth-login", "Login")]);
  p.seed(["first", "second", "third", "fourth"].map((t) => personNote("auth-login", t)));
  const seqOf = (t: string) => p.events().find((e) => e.type === "note.added" && e.payload.text === t)?.seq as number;
  const all = await p.w("inbox");
  expect(all.code).toBe(0);
  const order = ["first", "second", "third", "fourth"].map((t) => all.out.indexOf(t));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  for (const t of ["first", "second", "third", "fourth"]) expect(all.out).toContain(`[${seqOf(t)}] #auth-login`);
  const since = await p.w("inbox", "--since", String(seqOf("first")));
  expect(since.out).toContain("second");
  expect(since.out).toContain("third");
  expect(since.out).toContain("fourth");
  expect(since.out).not.toContain("first");
  const capped = await p.w("inbox", "--since", String(seqOf("first")), "-n", "2");
  expect(capped.out).toContain("second");
  expect(capped.out).toContain("third");
  expect(capped.out).not.toContain("fourth");
  expect(capped.out).not.toContain("first");
});

test("10.3", async () => {
  const p = project();
  expect((await p.w("add", "auth-retry", "--title", "Retry sends a new link", "--why", "Retry sends a new link")).code).toBe(0);
  expect(isGhost((await p.w("show", "auth-retry")).out)).toBe(true);
  p.seed([personNote("auth-retry", "No — retry must reuse the same link")]);
  expect((await p.w("say", "auth-retry", "Understood, I will correct it")).code).toBe(0);
  expect((await p.w("discard", "auth-retry")).code).toBe(0);
  expect((await p.w("add", "auth-retry", "--title", "Retry reuses the same link", "--why", "Retry reuses the same link")).code).toBe(0);
  const out = (await p.w("show", "auth-retry")).out;
  const a = out.indexOf("No — retry must reuse the same link");
  const b = out.indexOf("Understood, I will correct it");
  const m = out.indexOf("proposed again");
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(-1);
  expect(m).toBeGreaterThan(Math.max(a, b));
  expect(out.split("proposed again").length - 1).toBe(1);
  expect(out).toContain("Retry reuses the same link");
  p.seed([personNote("auth-retry", "Good, accept")]);
  const out2 = (await p.w("show", "auth-retry")).out;
  expect(out2.indexOf("Good, accept")).toBeGreaterThan(out2.indexOf("proposed again"));
});

test("10.4", async () => {
  const p = project();
  expect((await p.w("add", "cache-ttl", "--title", "Cache entries live 60 seconds", "--why", "w")).code).toBe(0);
  p.seed([personNote("cache-ttl", "Why 60 seconds?")]);
  expect((await p.w("discard", "cache-ttl")).code).toBe(0);
  const inbox = await p.w("inbox");
  expect(inbox.out).toContain("Why 60 seconds?");
  expect(inbox.out).toContain("#cache-ttl");
  expect((await p.w("add", "cache-ttl", "--title", "Cache entries live 30 seconds", "--why", "w")).code).toBe(0);
  const out = (await p.w("show", "cache-ttl")).out;
  const note = out.indexOf("Why 60 seconds?");
  expect(note).toBeGreaterThan(-1);
  expect(out.indexOf("proposed again")).toBeGreaterThan(note);
  expect(out.split("proposed again").length - 1).toBe(1);
});

test("10.5", async () => {
  const p = project();
  p.seed([
    real("retry", "Retry"),
    { type: "node.added", payload: { id: "src-rfc", kind: "source", title: "RFC 9110", url: "https://www.rfc-editor.org/rfc/rfc9110", finding: "idempotent requests may retry" } },
    {
      type: "excerpt.quoted",
      payload: { id: "src-rfc-quote", title: "a client may retry an idempotent request", card: "retry", conversation: "rfc", session: "s-1", message: 0, start: 0, end: 40, speaker: "person", said_at: "2026-10-25T09:00:00Z" },
    },
  ]);
  const seeded = await p.w("show", "src-rfc-quote");
  if (seeded.code !== 0) throw new Error(seeded.err);
  const say = await p.w("say", "src-rfc-quote", "This quote supports the retry decision");
  expect(say.code).toBe(0);
  expect((await p.w("show", "src-rfc-quote")).out).toContain("This quote supports the retry decision");
});

const chat3 = (p: ReturnType<typeof project>) =>
  p.chat("design", [
    { speaker: "agent", at: "2026-10-25T09:00:00Z", session: "s-42", kind: "tool_result", text: "ls output" },
    spoken("person", "how do we store the chat?", "2026-10-25T09:01:00Z", "s-42"),
    spoken("agent", "we keep one log per conversation and never rewrite it", "2026-10-25T09:02:00Z", "s-42"),
  ]);

test("12.1", async () => {
  const p = project();
  chat3(p);
  expect((await p.w("add", "chat-log", "--title", "Each conversation has one log", "--why", "w")).code).toBe(0);
  const n = p.events().length;
  const q = await p.w("quote", "chat-log", "design", "one log per conversation");
  expect(q.code).toBe(0);
  const fresh = p.events().slice(n);
  expect(fresh).toHaveLength(1);
  const pl = fresh[0]?.payload;
  expect(pl.card).toBe("chat-log");
  const card = await p.w("show", "chat-log");
  expect(linkLine(card.out, "supported_by", pl.id)).toBeDefined();
  const ex = await p.w("show", pl.id);
  expect(isGhost(ex.out)).toBe(true);
  const views = `${card.out}\n${ex.out}`;
  const misses: string[] = [];
  const want = (ok: boolean, what: string) => ok || misses.push(what);
  want(views.includes("one log per conversation"), "quoted words");
  want(/agent: "one log per conversation"/.test(views), "agent as speaker");
  want(views.includes("2026-10-25T09:02:00Z"), "message time in show");
  want(views.includes("s-42"), "session id in show");
  const text = "we keep one log per conversation and never rewrite it";
  want(pl.start === text.indexOf("one log per conversation"), `span start (log has ${pl.start})`);
  want(pl.end === text.indexOf("one log per conversation") + "one log per conversation".length, `span end (log has ${pl.end})`);
  want(pl.message === 3, `message position 3 (log has ${pl.message})`);
  expect(misses).toEqual([]);
});

test("12.2", async () => {
  const p = project();
  p.chat("plan", [
    spoken("person", "I say ship the reader first", "2026-10-25T09:00:00Z"),
    spoken("agent", "agreed, ship the reader first", "2026-10-25T09:01:00Z"),
    spoken("person", "retry, then retry again", "2026-10-25T09:02:00Z"),
  ]);
  expect((await p.w("add", "reader", "--title", "The reader goes first", "--why", "w")).code).toBe(0);
  const n = p.events().length;
  const a = await p.w("quote", "reader", "plan", "ship the reader first");
  expect(a.code).not.toBe(0);
  expect(a.err).toContain("2 messages");
  const b = await p.w("quote", "reader", "plan", "retry");
  expect(b.code).not.toBe(0);
  expect(b.err).toMatch(/2 times in message|2 matches/);
  const c = await p.w("quote", "reader", "plan", "a sentence nobody said");
  expect(c.code).not.toBe(0);
  expect(c.err).toMatch(/no (exact )?match/);
  expect(p.events().length).toBe(n);
  expect((await p.w("show", "reader:ex0")).code).not.toBe(0);
  expect((await p.w("show", "reader")).out).not.toContain("supported_by");
});

test("12.3", async () => {
  const p = project();
  p.chat("run", [
    spoken("person", "why did the runner die?", "2026-10-25T09:00:00Z"),
    { speaker: "agent", at: "2026-10-25T09:01:00Z", session: "s", kind: "tool_call", text: "grep 'exit code 137' log" },
    { speaker: "agent", at: "2026-10-25T09:02:00Z", session: "s", kind: "tool_result", text: "exit code 137 from the runner" },
    { speaker: "agent", at: "2026-10-25T09:03:00Z", session: "s", kind: "tooling", text: "note: exit code 137 seen" },
    spoken("agent", "the runner ran out of memory", "2026-10-25T09:04:00Z"),
  ]);
  expect((await p.w("add", "oom", "--title", "The runner gets more memory", "--why", "w")).code).toBe(0);
  const n = p.events().length;
  const q = await p.w("quote", "oom", "run", "exit code 137");
  expect(q.code).not.toBe(0);
  expect(q.err).toMatch(/no (exact )?match/);
  expect(p.events().length).toBe(n);
  expect((await p.w("show", "oom:ex0")).code).not.toBe(0);
});

test("12.4", async () => {
  const p = project();
  chat3(p);
  expect((await p.w("add", "chat-log", "--title", "Each conversation has one log", "--why", "w")).code).toBe(0);
  expect((await p.w("quote", "chat-log", "design", "one log per conversation")).code).toBe(0);
  const ex = "chat-log:ex0";
  let n = p.events().length;
  const plain = await p.w("add", "chat-log:ex1", "--kind", "excerpt", "--title", "my own words");
  expect(plain.code).not.toBe(0);
  expect(p.events().length).toBe(n);
  const retitle = await p.w("propose", ex, "--title", "other words");
  expect(retitle.code).not.toBe(0);
  const edit = await p.w("propose", ex, "--ops", JSON.stringify([{ tag: "new", new: "other text" }]));
  expect(edit.code).not.toBe(0);
  expect(p.events().length).toBe(n);
  expect((await p.w("show", ex)).out).toContain("one log per conversation");
  expect((await p.w("say", ex, "Is this the right quote?")).code).toBe(0);
  expect((await p.w("show", ex)).out).toContain("Is this the right quote?");
  expect((await p.w("accept", "chat-log", "--actor", "you")).code).toBe(0);
  n = p.events().length;
  const edit2 = await p.w("propose", ex, "--ops", JSON.stringify([{ tag: "new", new: "other text" }]));
  expect(edit2.code).not.toBe(0);
  expect(p.events().length).toBe(n);
  expect((await p.w("show", ex)).out).toContain("one log per conversation");
});

test("12.5", async () => {
  const p = project();
  chat3(p);
  expect((await p.w("add", "card-a", "--title", "Card A", "--why", "w")).code).toBe(0);
  expect((await p.w("add", "card-b", "--title", "Card B", "--why", "w")).code).toBe(0);
  expect((await p.w("quote", "card-a", "design", "one log per conversation")).code).toBe(0);
  expect((await p.w("quote", "card-b", "design", "never rewrite it")).code).toBe(0);
  expect((await p.w("discard", "card-a")).code).toBe(0);
  expect((await p.w("show", "card-a")).code).not.toBe(0);
  expect((await p.w("show", "card-a:ex0")).code).not.toBe(0);
  expect((await p.w("accept", "card-b", "--actor", "you")).code).toBe(0);
  expect(isGhost((await p.w("show", "card-b")).out)).toBe(false);
  const ex = await p.w("show", "card-b:ex0");
  expect(isGhost(ex.out)).toBe(false);
  const views = `${(await p.w("show", "card-b")).out}\n${ex.out}`;
  const text = "we keep one log per conversation and never rewrite it";
  const start = text.indexOf("never rewrite it");
  const misses: string[] = [];
  const want = (ok: boolean, what: string) => ok || misses.push(what);
  want(views.includes("never rewrite it"), "quoted words");
  want(/agent: "never rewrite it"/.test(views), "speaker");
  want(views.includes("2026-10-25T09:02:00Z"), "time");
  want(views.includes("s-42"), "session");
  want(/message \d/.test(views), "message position");
  want(views.includes(`${start}..${start + "never rewrite it".length}`), "span");
  expect(misses).toEqual([]);
});

// Held-out command-line steps: 04.x, 06.1, 08.x, 12.x, 19.x, 26.x.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const events = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l));

function seed(p: Project, type: string, payload: object, actor = "you") {
  const seq = events(p).length + 1;
  appendFileSync(logOf(p), `${JSON.stringify({ seq, at: "2026-10-25T10:00:00.000Z", actor, type, payload })}\n`);
}

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run;
}

/** A real card, made the way the map makes one: an agent's add and the person's accept. */
async function realCard(p: Project, id: string, title: string, parent?: string) {
  await ok(p, ["add", id, "--title", title, ...(parent ? ["--parent", parent] : [])]);
  await ok(p, ["accept", id, "--actor", "you"]);
}

const header = (out: string) => out.split("\n")[0] as string;

// ---------- 04 ----------

test("04.1", async () => {
  const p = freshProject();
  await realCard(p, "checkout-flow", "Checkout flow");
  await ok(p, ["add", "other-ghost", "--title", "Some other ghost", "--parent", "checkout-flow"]);
  const before = events(p).length;
  const add = await ok(p, ["add", "retry-payment", "--title", "Retry payment", "--parent", "checkout-flow"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = events(p);
  expect(after.length).toBe(before + 1);
  expect(after.at(-1)).toMatchObject({ type: "node.proposed", payload: { id: "retry-payment", parent: "checkout-flow" } });
  const show = await ok(p, ["show", "retry-payment"]);
  expect(header(show.out)).toContain("proposed");
  expect(show.out).toContain("parent: checkout-flow  Checkout flow");
  const n = events(p).length;
  await ok(p, ["accept", "retry-payment", "--actor", "you"]);
  const accepted = events(p);
  expect(accepted.length).toBe(n + 1);
  expect(accepted.at(-1)).toMatchObject({ type: "change.accepted", payload: { id: "retry-payment" } });
  const real = await ok(p, ["show", "retry-payment"]);
  expect(header(real.out)).not.toContain("proposed");
  expect(real.out).toContain("parent: checkout-flow  Checkout flow");
  expect(header((await ok(p, ["show", "other-ghost"])).out)).toContain("proposed");
});

test("04.2", async () => {
  const p = freshProject();
  await realCard(p, "payments", "Payments");
  await realCard(p, "fraud-rules", "Fraud rules");
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial-refunds", "fraud-rules", "--type", "depends_on", "--why", "a partial refund passes the fraud rules"]);
  await ok(p, ["add", "partial-refunds:opt0", "--kind", "option", "--title", "Only full refunds", "--why_not", "customers return single items"]);
  await ok(p, ["link", "partial-refunds:opt0", "partial-refunds", "--type", "alternative_to"]);
  await ok(p, ["add", "src-returns", "--kind", "source", "--title", "Returns study", "--url", "https://example.com/returns", "--finding", "most returns are partial"]);
  await ok(p, ["link", "partial-refunds", "src-returns", "--type", "supported_by"]);
  const held = await ok(p, ["show", "partial-refunds"]);
  const depLine = held.out.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules")) ?? "";
  expect(depLine).toMatch(/\(.*held\)/);
  const before = events(p).length;
  await ok(p, ["accept", "partial-refunds", "--actor", "you"]);
  const added = events(p).slice(before);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((e) => e.type === "change.accepted")).toBe(true);
  for (const id of ["refunds", "partial-refunds", "partial-refunds:opt0", "src-returns"])
    expect(header((await ok(p, ["show", id])).out)).not.toContain("proposed");
  const live = await ok(p, ["show", "partial-refunds"]);
  const liveLine = live.out.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules")) ?? "";
  expect(liveLine).not.toBe("");
  expect(liveLine).not.toContain("held");
});

test("04.3", async () => {
  const p = freshProject();
  await realCard(p, "onboarding", "Onboarding");
  await ok(p, ["add", "email-verification", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend-email", "--title", "Resend email", "--parent", "email-verification"]);
  await ok(p, ["discard", "email-verification"]);
  for (const id of ["email-verification", "resend-email"]) {
    const run = await p.werk(["show", id]);
    expect(run.code).not.toBe(0);
    expect(run.err).toContain("no node");
  }
  const show = await ok(p, ["show", "onboarding"]);
  expect(show.out).not.toContain("refines");
  expect(show.out).not.toContain("ghost");
});

test("04.4", async () => {
  const p = freshProject();
  await realCard(p, "search", "Search");
  await ok(p, ["add", "search-index", "--title", "Search uses one index", "--why", "one index is simple", "--parent", "search"]);
  const before = events(p).length;
  const again = await p.werk(["add", "search-index", "--title", "Search uses two indexes", "--why", "two are fast", "--parent", "search"]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("a ghost's words are frozen");
  expect(events(p).length).toBe(before);
  const show = await ok(p, ["show", "search-index"]);
  expect(show.out).toContain("Search uses one index");
  expect(show.out).toContain("why: one index is simple");
});

test("04.5", async () => {
  const p = freshProject();
  await realCard(p, "compliance", "Compliance");
  await ok(p, ["add", "audit-log", "--title", "Audit log", "--parent", "compliance"]);
  const before = events(p).length;
  const refused = await p.werk(["accept", "audit-log"]);
  expect(refused.code).not.toBe(0);
  expect(events(p).length).toBe(before);
  expect(header((await ok(p, ["show", "audit-log"])).out)).toContain("proposed");
  const accepted = await p.werk(["accept", "audit-log", "--actor", "you"]);
  expect(accepted.code).toBe(0);
  expect(header((await ok(p, ["show", "audit-log"])).out)).not.toContain("proposed");
});

// ---------- 08 ----------

function decided(p: Project, id: string, title: string, parent?: string) {
  seed(p, "node.added", { id, kind: "card", title, ...(parent ? { parent } : {}) });
  seed(p, "node.decided", { id });
}

test("08.1", async () => {
  const p = freshProject();
  decided(p, "root", "Root");
  decided(p, "auth", "Auth", "root");
  decided(p, "login", "Login", "auth");
  decided(p, "session", "Session", "auth");
  decided(p, "audit", "Audit", "root");
  seed(p, "edge.added", { from: "login", to: "audit", type: "depends_on", why: "login writes audit entries" });
  const before = events(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  for (const id of ["auth", "login", "session"]) expect((await p.werk(["show", id])).code).not.toBe(0);
  expect((await ok(p, ["show", "root"])).out).not.toContain("auth");
  const added = events(p).slice(before);
  expect(added.length).toBe(1);
  expect(added[0].type).toBe("node.removed");
  const removed = await ok(p, ["removed"]);
  expect(removed.out).toContain("auth");
  expect(removed.out).toContain("login");
  expect(removed.out).toContain("session");
  expect((await ok(p, ["show", "audit"])).out).not.toContain("login");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).out).toContain("parent: root");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
  const audit = await ok(p, ["show", "audit"]);
  expect(audit.out).toMatch(/<- depends_on\s+login/);
  const none = await ok(p, ["removed"]);
  expect(none.out).not.toContain("auth");
  expect(none.out).not.toContain("login");
});

test("08.2", async () => {
  const p = freshProject();
  decided(p, "platform", "Platform");
  decided(p, "auth", "Auth", "platform");
  decided(p, "login", "Login", "auth");
  decided(p, "session", "Session", "auth");
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect((await p.werk(["show", "auth"])).code).not.toBe(0);
  expect((await ok(p, ["show", "login"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: platform");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
});

test("08.3", async () => {
  const p = freshProject();
  decided(p, "a", "Branch A");
  decided(p, "b", "Branch B");
  decided(p, "login", "Login", "a");
  decided(p, "session", "Session", "b");
  seed(p, "edge.added", { from: "login", to: "session", type: "depends_on", why: "login opens a session" });
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const login = await ok(p, ["show", "login"]);
  expect(login.out).not.toContain("session");
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toMatch(/-> depends_on\s+session/);
});

test("08.4", async () => {
  const p = freshProject();
  decided(p, "root", "Root");
  decided(p, "login", "Login", "root");
  decided(p, "billing", "Billing", "root");
  seed(p, "node.added", { id: "rfc-6749", kind: "source", title: "RFC 6749", url: "https://www.rfc-editor.org/rfc/rfc6749" });
  seed(p, "edge.added", { from: "login", to: "rfc-6749", type: "supported_by" });
  seed(p, "edge.added", { from: "billing", to: "rfc-6749", type: "supported_by" });
  await ok(p, ["remove", "login", "--actor", "you"]);
  const src = await ok(p, ["show", "rfc-6749"]);
  expect(src.out).toMatch(/<- supported_by\s+billing/);
  const before = events(p).length;
  const add = await p.werk(["add", "login", "--title", "A new login", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  expect(add.err).toContain("restore");
  expect(events(p).length).toBe(before);
  expect((await p.werk(["show", "login"])).code).not.toBe(0);
});

test("08.5", async () => {
  const p = freshProject();
  decided(p, "login", "Login");
  const before = events(p).length;
  const run = await p.werk(["remove", "login"]);
  expect(run.code).not.toBe(0);
  expect((await p.werk(["show", "login"])).code).toBe(0);
  expect(events(p).length).toBe(before);
});

test("08.6", async () => {
  const p = freshProject();
  decided(p, "login", "Login");
  await ok(p, ["remove", "login", "--actor", "you"]);
  const before = events(p).length;
  const run = await p.werk(["restore", "login"]);
  expect(run.code).not.toBe(0);
  expect((await p.werk(["show", "login"])).code).not.toBe(0);
  expect(events(p).length).toBe(before);
});

// ---------- 06.1 / 12 ----------

type ChatLine = { speaker: string; at: string; session: string; kind: string; text: string };
function chat(p: Project, name: string, lines: ChatLine[]) {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}
const S = "sess-42";
const line = (kind: string, speaker: string, text: string, at: string): ChatLine => ({ speaker, at, session: S, kind, text });

test("06.1", async () => {
  const p = freshProject();
  decided(p, "log-model", "The map is one append-only log");
  chat(p, "c1", [line("spoken", "agent", "we keep one log per conversation and never rewrite it", "2026-10-25T09:00:00Z")]);
  const before = (await ok(p, ["show", "log-model"])).out;
  const run = await ok(p, ["quote", "log-model", "c1", "one log per conversation"]);
  expect(run.out).toContain("proposed");
  expect(run.out).not.toContain("added");
  const ex = await ok(p, ["show", "log-model:ex0"]);
  expect(header(ex.out)).toContain("proposed");
  const card = await ok(p, ["show", "log-model"]);
  const link = card.out.split("\n").find((l) => l.includes("supported_by") && l.includes("log-model:ex0")) ?? "";
  expect(link).toMatch(/held/);
  expect(header(card.out)).toBe(header(before));
  expect(header(card.out)).toContain("[decided]");
  expect(card.out.split("\n")[1]).toBe("The map is one append-only log");
});

test("12.1", async () => {
  const p = freshProject();
  chat(p, "conv1", [
    line("tool_result", "tool", "ok", "2026-10-25T09:00:00Z"),
    line("spoken", "you", "how many logs do we keep?", "2026-10-25T09:00:05Z"),
    line("spoken", "agent", "we keep one log per conversation and never rewrite it", "2026-10-25T09:00:10Z"),
  ]);
  await ok(p, ["add", "log-per-conv", "--title", "One log per conversation"]);
  const before = events(p).length;
  const run = await ok(p, ["quote", "log-per-conv", "conv1", "one log per conversation"]);
  const added = events(p).slice(before);
  expect(added.length).toBe(1);
  expect(added[0]).toMatchObject({ type: "excerpt.quoted", payload: { card: "log-per-conv" } });
  const card = await ok(p, ["show", "log-per-conv"]);
  expect(card.out).toMatch(/-> supported_by\s+log-per-conv:ex0/);
  const ex = await ok(p, ["show", "log-per-conv:ex0"]);
  const text = `${run.out}\n${ex.out}\n${card.out}`;
  expect(ex.out).toContain("one log per conversation");
  expect(header(ex.out)).toContain("proposed");
  expect(text).toContain("agent");
  const start = "we keep one log per conversation and never rewrite it".indexOf("one log per conversation");
  expect(run.out).toContain(`span ${start}..${start + "one log per conversation".length}`);
  // The message position, counting the hidden tool result line.
  expect(run.out).toContain("message 3");
  // The excerpt shows its time and its session.
  expect(ex.out).toContain("2026-10-25T09:00:10Z");
  expect(ex.out).toContain(S);
});

test("12.2", async () => {
  const p = freshProject();
  chat(p, "conv2", [
    line("spoken", "you", "ship the reader first", "2026-10-25T09:00:00Z"),
    line("spoken", "agent", "ship the reader first, then the writer", "2026-10-25T09:00:05Z"),
    line("spoken", "you", "retry, then retry again", "2026-10-25T09:00:10Z"),
  ]);
  await ok(p, ["add", "order", "--title", "The reader ships first"]);
  const before = events(p).length;
  const twoMsgs = await p.werk(["quote", "order", "conv2", "ship the reader first"]);
  expect(twoMsgs.code).not.toBe(0);
  expect(twoMsgs.err).toMatch(/2 messages/);
  const twoIn = await p.werk(["quote", "order", "conv2", "retry"]);
  expect(twoIn.code).not.toBe(0);
  expect(twoIn.err).toMatch(/2 times in message/);
  const none = await p.werk(["quote", "order", "conv2", "a sentence nobody said"]);
  expect(none.code).not.toBe(0);
  expect(none.err).toMatch(/no exact match/);
  expect(events(p).length).toBe(before);
  expect((await ok(p, ["show", "order"])).out).not.toContain("supported_by");
  expect((await p.werk(["show", "order:ex0"])).code).not.toBe(0);
});

test("12.3", async () => {
  const p = freshProject();
  chat(p, "conv3", [
    line("tool_call", "agent", "run tests; expect exit code 137", "2026-10-25T09:00:00Z"),
    line("tool_result", "tool", "exit code 137 from the runner", "2026-10-25T09:00:01Z"),
    line("tooling", "system", "note: exit code 137 seen", "2026-10-25T09:00:02Z"),
    line("spoken", "agent", "the runner was killed", "2026-10-25T09:00:03Z"),
  ]);
  await ok(p, ["add", "runner", "--title", "The runner gets more memory"]);
  const before = events(p).length;
  const run = await p.werk(["quote", "runner", "conv3", "exit code 137"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toMatch(/no exact match/);
  expect(events(p).length).toBe(before);
  expect((await p.werk(["show", "runner:ex0"])).code).not.toBe(0);
});

test("12.4", async () => {
  const p = freshProject();
  chat(p, "conv4", [line("spoken", "you", "quotes are never typed by hand", "2026-10-25T09:00:00Z")]);
  await ok(p, ["add", "quotes", "--title", "Quotes come from the transcript"]);
  await ok(p, ["quote", "quotes", "conv4", "never typed by hand"]);
  const ex = "quotes:ex0";
  const n0 = events(p).length;
  const plain = await p.werk(["add", "quotes:ex1", "--kind", "excerpt", "--title", "my own words"]);
  expect(plain.code).not.toBe(0);
  expect(events(p).length).toBe(n0);
  const retitle = await p.werk(["propose", ex, "--title", "other words"]);
  expect(retitle.code).not.toBe(0);
  const edit = await p.werk(["propose", ex, "--ops", JSON.stringify([{ tag: "new", new: "other words" }])]);
  expect(edit.code).not.toBe(0);
  expect(events(p).length).toBe(n0);
  expect((await ok(p, ["show", ex])).out.split("\n")[1]).toBe("never typed by hand");
  await ok(p, ["say", ex, "This is the source of the rule"]);
  expect((await ok(p, ["show", ex])).out).toContain("This is the source of the rule");
  await ok(p, ["accept", "quotes", "--actor", "you"]);
  const n1 = events(p).length;
  const again = await p.werk(["propose", ex, "--ops", JSON.stringify([{ tag: "new", new: "other words" }])]);
  expect(again.code).not.toBe(0);
  expect(events(p).length).toBe(n1);
  expect((await ok(p, ["show", ex])).out.split("\n")[1]).toBe("never typed by hand");
});

test("12.5", async () => {
  const p = freshProject();
  chat(p, "conv5", [
    line("spoken", "you", "the first rule is short", "2026-10-25T09:00:00Z"),
    line("spoken", "agent", "the second rule is long", "2026-10-25T09:00:07Z"),
  ]);
  await ok(p, ["add", "first", "--title", "First card"]);
  await ok(p, ["add", "second", "--title", "Second card"]);
  await ok(p, ["quote", "first", "conv5", "first rule"]);
  const q2 = await ok(p, ["quote", "second", "conv5", "second rule"]);
  await ok(p, ["discard", "first"]);
  expect((await p.werk(["show", "first"])).code).not.toBe(0);
  expect((await p.werk(["show", "first:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "second", "--actor", "you"]);
  const card = await ok(p, ["show", "second"]);
  expect(header(card.out)).not.toContain("proposed");
  const ex = await ok(p, ["show", "second:ex0"]);
  expect(header(ex.out)).not.toContain("proposed");
  expect(q2.out).toContain("message 1");
  expect(ex.out).toContain("second rule");
  expect(ex.out).toContain("agent");
  expect(ex.out).toContain("2026-10-25T09:00:07Z");
  expect(ex.out).toContain("conv5");
  expect(ex.out).toContain("sess-42");
  expect(ex.out).toMatch(/message 1/);
  expect(ex.out).toMatch(/4\.\.15/);
});

// ---------- 19 ----------
// A build pass and a sample are started by the person. The checks below look for a way to start
// one from the werk command line, which is the only entry point besides the map server.

test("19.1 / 19.3 / 19.4: a person can start a build pass on a ticket", async () => {
  const p = freshProject();
  const help = await ok(p, ["help"]);
  expect(help.out).toMatch(/^ {2}(build|ticket|pass|run)( |$)/m);
});

test("19.2: a person can sample options for an open card", async () => {
  const p = freshProject();
  const help = await ok(p, ["help"]);
  expect(help.out).toMatch(/^ {2}sample\b/m);
});

// ---------- 26 ----------

const SPEC = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nThe command line.\n`;

const ticket = (o: { title?: string; cites: string; blocked?: string; stories: string; what?: string; checks?: string }) =>
  `${o.title === undefined ? "" : `title: ${o.title}\n`}cites: ${o.cites}
blocked_by: ${o.blocked ?? ""}
stories: ${o.stories}
touches: map view, decision log

## What to build

${o.what ?? "A person opens a decided card and presses reopen."}

## Acceptance criteria

- [ ] A reopened card shows as open in the map.

## Checks

${o.checks ?? ""}
`;

function ticketProject(stories: number, ghost = false) {
  const p = freshProject();
  decided(p, "root", "Root");
  decided(p, "card-a", "Card A", "root");
  decided(p, "card-b", "Card B", "root");
  if (ghost) seed(p, "node.proposed", { id: "card-ghost", kind: "card", title: "Ghost", parent: "root" }, "agent");
  writeFileSync(join(p.dir, "spec.md"), SPEC(stories));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}
const put = (p: Project, files: Record<string, string>) => {
  for (const [n, t] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", n), t);
};
const tc = (p: Project, ...args: string[]) => p.werk(["ticket-check", "tickets", ...args]);

const validTickets = {
  "01-first.md": ticket({ title: "First slice", cites: "root, card-a", stories: "1", checks: "- `make test`" }),
  "02-second.md": ticket({ title: "Second slice", cites: "#card-b", blocked: "1", stories: "2" }),
};

test("26.1", async () => {
  const p = ticketProject(2);
  put(p, validTickets);
  const run = await tc(p, "--root", "root", "--spec", "spec.md");
  const lines = run.out.trimEnd().split("\n");
  expect(lines.length).toBe(1);
  expect(lines.at(-1)).toMatch(/\b0 failures\b/);
  expect(run.code).toBe(0);
});

test("26.2", async () => {
  const p = ticketProject(2);
  // Line 9 of the ticket, the first line of its What to build section, names src/loop.ts.
  const what = ["Change src/loop.ts to retry.", "Also update the Makefile."].join("\n");
  put(p, {
    "01-first.md": ticket({ title: "First slice", cites: "root, card-a", stories: "1", what }),
    "02-second.md": ticket({ title: "Second slice", cites: "#card-b", blocked: "1", stories: "2", what: "pad ".repeat(1100) }),
  });
  const run = await tc(p, "--root", "root", "--spec", "spec.md");
  const lines = run.out.trimEnd().split("\n");
  const paths = lines.find((l) => l.startsWith("01-first.md") && l.includes("no-file-paths")) ?? "";
  expect(paths).toContain("src/loop.ts");
  expect(paths).toMatch(/line 9\b/);
  expect(lines.filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(lines.some((l) => l.startsWith("02-second.md") && l.includes("size"))).toBe(true);
  expect(lines.at(-1)).toMatch(/[1-9]\d* failures?/);
  expect(run.code).toBe(1);
});

test("26.3", async () => {
  const p = ticketProject(3, true);
  put(p, {
    "01-first.md": ticket({ title: "First slice", cites: "root, card-a", stories: "1" }),
    "02-second.md": ticket({ title: "Second slice", cites: "card-a", blocked: "3", stories: "2" }),
    "03-third.md": ticket({ title: "Third slice", cites: "card-a", blocked: "2", stories: "1" }),
  });
  const run = await tc(p, "--root", "root", "--spec", "spec.md");
  const lines = run.out.trimEnd().split("\n");
  const cited = lines.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toContain("card-b");
  const stories = lines.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories.length).toBe(1);
  expect(stories[0]).toContain("3");
  const cycle = lines.find((l) => l.includes("blocked_by") && l.includes("cycle")) ?? "";
  expect(cycle).toContain("02-second.md");
  expect(cycle).toContain("03-third.md");
  expect(lines.some((l) => l.includes("card-ghost"))).toBe(false);
  expect(run.code).toBe(1);
});

test("26.4", async () => {
  const p = freshProject();
  decided(p, "root", "Root");
  decided(p, "card-a", "Card A", "root");
  writeFileSync(join(p.dir, "spec.md"), SPEC(1));
  mkdirSync(join(p.dir, "tickets"));
  put(p, { "01-untitled.md": ticket({ cites: "root, card-a", stories: "1" }) });
  const run = await tc(p, "--root", "root", "--spec", "spec.md");
  const lines = run.out.trimEnd().split("\n");
  const own = lines.filter((l) => l.startsWith("01-untitled.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain("title");
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("card-a"))).toBe(true);
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("stories") && l.includes("1"))).toBe(true);
  expect(run.code).toBe(1);
});

test("26.5", async () => {
  const p = ticketProject(2);
  put(p, validTickets);
  const missing = await tc(p, "--root", "root", "--spec", "nope.md");
  expect(`${missing.out}${missing.err}`).toMatch(/spec/);
  expect(`${missing.out}${missing.err}`).toMatch(/nope\.md/);
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "plain.md"), "# Spec\n\n1. A line.\n");
  expect((await tc(p, "--root", "root", "--spec", "plain.md")).code).toBe(2);
  expect((await tc(p, "--root", "no-such-root", "--spec", "spec.md")).code).toBe(2);
  expect((await tc(p, "--spec", "spec.md")).code).toBe(2);
});

// ---------- 19 probe: the prompt library that a launcher would call ----------
import { projectAgentArgs } from "../src/agent/launch.ts";

test("19 probe: builder and sample prompts from the launch library", () => {
  const p = freshProject();
  decided(p, "how", "Build rules");
  decided(p, "rule-a", "Rule A title", "how");
  decided(p, "rule-b", "Rule B title", "how");
  decided(p, "rule-c", "Rule C title", "how");
  const werk = "/opt/werk/bin/bun /opt/werk/src/cli.ts";
  const b = projectAgentArgs({ role: "builder", base: "BUILDER BASE PROMPT", project: p.dir }, werk);
  const prompt = b[1] as string;
  expect(prompt.startsWith("BUILDER BASE PROMPT\n\n# werk")).toBe(true);
  expect(prompt).toContain(`${werk} add`);
  expect(prompt.indexOf("Rule A title")).toBeGreaterThan(prompt.indexOf("# werk"));
  const agents = JSON.parse(b[3] as string);
  expect(Object.keys(agents).sort()).toEqual(["prototyper", "test-scope"]);
  expect(agents.prototyper.prompt).toContain(werk);
  expect(agents["test-scope"].prompt + agents["test-scope"].description).toBeDefined();
  expect(/#werk-[a-z]/.test(prompt)).toBe(false);
  const s = projectAgentArgs({ role: "sample", base: "SAMPLE", project: p.dir }, werk);
  expect(s[1]).toBe("SAMPLE\n");
  const c = projectAgentArgs({ role: "chat", base: "CHAT", project: p.dir }, werk);
  expect(c[1]).toContain("Rule B title");
  // werk's own checkout: the include line in AGENTS.md means the text appears once.
  writeFileSync(join(p.dir, "AGENTS.md"), "# Working\n\n@src/agent/instructions.md\n");
  const own = projectAgentArgs({ role: "builder", base: "B", project: p.dir }, werk)[1] as string;
  expect(own).not.toContain("# werk — how to work");
  expect(own).toContain("Rule C title");
  // no build rules under #how
  const q = freshProject();
  decided(q, "how", "Build rules");
  const none = projectAgentArgs({ role: "builder", base: "B", project: q.dir }, werk)[1] as string;
  expect(none).toContain("# werk");
  expect(none).not.toContain("build rules\n");
});

// Held-out steps at the command line: ghosts (04), removal (08), quotes (12), ticket-check (26).
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const events = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { seq: number; type: string; actor: string; payload: Record<string, unknown> });

/** Seed events as the person's, as a map that already holds them. */
function seed(p: Project, list: { type: string; payload: object }[]): void {
  const start = events(p).length;
  appendFileSync(
    logOf(p),
    list.map((e, i) => `${JSON.stringify({ seq: start + i + 1, at: "t", actor: "you", ...e })}\n`).join(""),
  );
}
const realCard = (id: string, title: string, parent?: string, status = "open") => ({
  type: "node.added",
  payload: { id, kind: "card", title, status, ...(parent ? { parent } : {}) },
});

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run;
}
const firstLine = (s: string) => s.split("\n")[0] as string;
const isGhost = (show: string) => firstLine(show).includes("proposed");

// ---------- 04 ----------

test("04.1", async () => {
  const p = freshProject();
  seed(p, [realCard("checkout", "Checkout flow")]);
  await ok(p, ["add", "other-ghost", "--title", "Other ghost"]);
  const before = events(p).length;
  const add = await ok(p, ["add", "retry-payment", "--title", "Retry payment", "--parent", "checkout"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = events(p);
  expect(after.length).toBe(before + 1);
  expect(after.at(-1)?.type).toBe("node.proposed");
  expect(after.at(-1)?.payload.parent).toBe("checkout");
  const show = await ok(p, ["show", "retry-payment"]);
  expect(isGhost(show.out)).toBe(true);
  expect(show.out).toContain("parent: checkout  Checkout flow");
  const n = events(p).length;
  await ok(p, ["accept", "retry-payment", "--actor", "you"]);
  expect(events(p).length).toBe(n + 1);
  expect(events(p).at(-1)?.type).toContain("accept");
  const real = await ok(p, ["show", "retry-payment"]);
  expect(isGhost(real.out)).toBe(false);
  expect(real.out).toContain("parent: checkout  Checkout flow");
  expect(isGhost((await ok(p, ["show", "other-ghost"])).out)).toBe(true);
});

test("04.2", async () => {
  const p = freshProject();
  seed(p, [realCard("payments", "Payments"), realCard("fraud-rules", "Fraud rules")]);
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial-refunds", "fraud-rules", "--type", "depends_on", "--why", "uses the fraud limits"]);
  await ok(p, ["add", "partial-refunds:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "x"]);
  await ok(p, ["link", "partial-refunds:opt0", "partial-refunds", "--type", "alternative_to"]);
  await ok(p, ["add", "refund-src", "--kind", "source", "--title", "Refund study", "--url", "https://example.com"]);
  await ok(p, ["link", "partial-refunds", "refund-src", "--type", "supported_by"]);
  const held = await ok(p, ["show", "partial-refunds"]);
  const dep = held.out.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules")) ?? "";
  expect(dep).toContain("held");
  const before = events(p).length;
  await ok(p, ["accept", "partial-refunds", "--actor", "you"]);
  const added = events(p).slice(before);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((e) => e.type.includes("accept"))).toBe(true);
  expect(isGhost((await ok(p, ["show", "refunds"])).out)).toBe(false);
  const pr = await ok(p, ["show", "partial-refunds"]);
  expect(isGhost(pr.out)).toBe(false);
  expect(isGhost((await ok(p, ["show", "partial-refunds:opt0"])).out)).toBe(false);
  expect(isGhost((await ok(p, ["show", "refund-src"])).out)).toBe(false);
  const live = pr.out.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules")) ?? "";
  expect(live).not.toBe("");
  expect(live).not.toContain("held");
});

test("04.3", async () => {
  const p = freshProject();
  seed(p, [realCard("onboarding", "Onboarding")]);
  await ok(p, ["add", "email-verification", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend-email", "--title", "Resend email", "--parent", "email-verification"]);
  await ok(p, ["discard", "email-verification"]);
  const a = await p.werk(["show", "email-verification"]);
  const b = await p.werk(["show", "resend-email"]);
  expect(a.code).not.toBe(0);
  expect(a.err).toContain("no node");
  expect(b.code).not.toBe(0);
  expect(b.err).toContain("no node");
  const onb = await ok(p, ["show", "onboarding"]);
  expect(onb.out).not.toContain("<- refines");
});

test("04.4", async () => {
  const p = freshProject();
  seed(p, [realCard("search", "Search")]);
  await ok(p, ["add", "search-index", "--title", "Search index", "--why", "Queries need speed", "--parent", "search"]);
  const before = events(p).length;
  const again = await p.werk(["add", "search-index", "--title", "Another index", "--why", "Other words"]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("frozen");
  expect(events(p).length).toBe(before);
  const show = await ok(p, ["show", "search-index"]);
  expect(show.out).toContain("Search index\n");
  expect(show.out).toContain("why: Queries need speed");
});

test("04.5", async () => {
  const p = freshProject();
  seed(p, [realCard("platform", "Platform")]);
  await ok(p, ["add", "audit-log", "--title", "Audit log", "--parent", "platform"]);
  const before = events(p).length;
  const no = await p.werk(["accept", "audit-log"]);
  expect(no.code).not.toBe(0);
  expect(events(p).length).toBe(before);
  expect(isGhost((await ok(p, ["show", "audit-log"])).out)).toBe(true);
  const yes = await p.werk(["accept", "audit-log", "--actor", "you"]);
  expect(yes.code).toBe(0);
  expect(isGhost((await ok(p, ["show", "audit-log"])).out)).toBe(false);
});

// ---------- 08 ----------

const shows = async (p: Project, id: string) => (await p.werk(["show", id])).code === 0;

test("08.1", async () => {
  const p = freshProject();
  seed(p, [
    realCard("auth", "auth", undefined, "decided"),
    realCard("login", "login", "auth"),
    realCard("session", "session", "auth"),
    realCard("audit", "audit"),
  ]);
  await ok(p, ["link", "login", "audit", "--type", "depends_on", "--why", "login writes audit records"]);
  const before = events(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  for (const id of ["auth", "login", "session"]) expect(await shows(p, id)).toBe(false);
  const added = events(p).slice(before);
  expect(added.length).toBe(1);
  expect(added[0]?.type).toContain("remove");
  const removed = await ok(p, ["removed"]);
  expect(removed.out).toContain("auth");
  expect(removed.out).toContain("login");
  expect(removed.out).toContain("session");
  expect((await ok(p, ["show", "audit"])).out).not.toContain("login");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  const auth = await ok(p, ["show", "auth"]);
  expect(auth.out).toContain("<- refines         login");
  expect(auth.out).toContain("<- refines         session");
  expect((await ok(p, ["show", "audit"])).out).toContain("login");
  const after = await ok(p, ["removed"]);
  expect(after.out).not.toContain("auth");
});

test("08.2", async () => {
  const p = freshProject();
  seed(p, [
    realCard("platform", "platform"),
    realCard("auth", "auth", "platform"),
    realCard("login", "login", "auth"),
    realCard("session", "session", "auth"),
  ]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect(await shows(p, "auth")).toBe(false);
  expect((await ok(p, ["show", "login"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: platform");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "platform"])).out).not.toContain("login");
});

test("08.3", async () => {
  const p = freshProject();
  seed(p, [
    realCard("a", "a"),
    realCard("b", "b"),
    realCard("login", "login", "a"),
    realCard("session", "session", "b"),
  ]);
  await ok(p, ["link", "login", "session", "--type", "depends_on", "--why", "login opens a session"]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const login = await ok(p, ["show", "login"]);
  expect(login.out).not.toContain("session");
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toContain("depends_on      session");
});

test("08.4", async () => {
  const p = freshProject();
  seed(p, [
    realCard("login", "login"),
    realCard("billing", "billing"),
    { type: "node.added", payload: { id: "rfc-6749", kind: "source", title: "RFC 6749", url: "https://x" } },
  ]);
  await ok(p, ["link", "login", "rfc-6749", "--type", "supported_by"]);
  await ok(p, ["link", "billing", "rfc-6749", "--type", "supported_by"]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const src = await ok(p, ["show", "rfc-6749"]);
  expect(src.out).toContain("billing");
  const before = events(p).length;
  const add = await p.werk(["add", "login", "--title", "A new login"]);
  expect(add.code).not.toBe(0);
  expect(add.err).toContain("restore");
  expect(events(p).length).toBe(before);
  expect(await shows(p, "login")).toBe(false);
});

test("08.5", async () => {
  const p = freshProject();
  seed(p, [realCard("login", "login")]);
  const before = events(p).length;
  const run = await p.werk(["remove", "login"]);
  expect(run.code).not.toBe(0);
  expect(await shows(p, "login")).toBe(true);
  expect(events(p).length).toBe(before);
});

test("08.6", async () => {
  const p = freshProject();
  seed(p, [realCard("login", "login")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const before = events(p).length;
  const run = await p.werk(["restore", "login"]);
  expect(run.code).not.toBe(0);
  expect(await shows(p, "login")).toBe(false);
  expect(events(p).length).toBe(before);
});

// ---------- 12 ----------

const line = (kind: string, text: string, speaker: string, at: string) =>
  JSON.stringify({ speaker, at, session: "sess-42", kind, text });
function chat(p: Project, name: string, lines: string[]): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${lines.join("\n")}\n`);
}

test("12.1", async () => {
  const p = freshProject();
  const said = "we keep one log per conversation and never rewrite it";
  chat(p, "c1", [
    line("tool_result", "ok", "agent", "2026-01-01T10:00:00Z"),
    line("spoken", "how do we store chats?", "person", "2026-01-01T10:01:00Z"),
    line("spoken", said, "agent", "2026-01-01T10:02:00Z"),
  ]);
  seed(p, [realCard("root", "Root")]);
  await ok(p, ["add", "chat-log", "--title", "Chats are logs", "--parent", "root"]);
  const before = events(p).length;
  const run = await p.werk(["quote", "chat-log", "c1", "one log per conversation"]);
  expect(run.code).toBe(0);
  const added = events(p).slice(before);
  expect(added.length).toBe(1);
  const id = String(added[0]?.payload.id);
  const card = await ok(p, ["show", "chat-log"]);
  expect(card.out).toMatch(new RegExp(`supported_by\\s+${id}`));
  const ex = await ok(p, ["show", id]);
  expect(isGhost(ex.out)).toBe(true);
  expect(ex.out).toContain("one log per conversation");
  // The excerpt shows its speaker, time and session.
  console.log("12.1 payload", JSON.stringify(added[0]?.payload));
  expect(ex.out).toContain("agent");
  expect(ex.out).toContain("2026-01-01T10:02:00Z");
  expect(ex.out).toContain("sess-42");
  const at = said.indexOf("one log per conversation");
  expect(added[0]?.payload.message).toBe(3);
  expect(added[0]?.payload.start).toBe(at);
  expect(added[0]?.payload.end).toBe(at + "one log per conversation".length);
});

test("12.2", async () => {
  const p = freshProject();
  chat(p, "c2", [
    line("spoken", "ship the reader first", "person", "t1"),
    line("spoken", "ok: ship the reader first", "agent", "t2"),
    line("spoken", "retry, then retry again", "person", "t3"),
  ]);
  seed(p, [realCard("root", "Root")]);
  await ok(p, ["add", "plan", "--title", "Plan", "--parent", "root"]);
  const before = events(p).length;
  const two = await p.werk(["quote", "plan", "c2", "ship the reader first"]);
  expect(two.code).not.toBe(0);
  expect(two.err).toContain("2 messages");
  const twice = await p.werk(["quote", "plan", "c2", "retry"]);
  expect(twice.code).not.toBe(0);
  expect(twice.err).toMatch(/2 (matches|times)/);
  const none = await p.werk(["quote", "plan", "c2", "a sentence nobody said"]);
  expect(none.code).not.toBe(0);
  expect(none.err).toContain("no exact match");
  expect(events(p).length).toBe(before);
  expect((await ok(p, ["show", "plan"])).out).not.toContain("supported_by");
});

test("12.3", async () => {
  const p = freshProject();
  chat(p, "c3", [
    line("tool_call", "run tests; expect exit code 137", "agent", "t1"),
    line("tool_result", "exit code 137 from the runner", "agent", "t2"),
    line("tooling", "note: exit code 137 seen", "agent", "t3"),
    line("spoken", "the run failed", "person", "t4"),
  ]);
  seed(p, [realCard("root", "Root")]);
  await ok(p, ["add", "runner", "--title", "Runner", "--parent", "root"]);
  const before = events(p).length;
  const run = await p.werk(["quote", "runner", "c3", "exit code 137"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("no exact match");
  expect(events(p).length).toBe(before);
});

test("12.4", async () => {
  const p = freshProject();
  chat(p, "c4", [line("spoken", "the cache keeps entries for one minute", "person", "t1")]);
  seed(p, [realCard("root", "Root")]);
  await ok(p, ["add", "cache", "--title", "Cache", "--parent", "root"]);
  await ok(p, ["quote", "cache", "c4", "one minute"]);
  const ex = "cache:ex0";
  let before = events(p).length;
  const add = await p.werk(["add", "hand-ex", "--kind", "excerpt", "--title", "my own words"]);
  expect(add.code).not.toBe(0);
  expect(events(p).length).toBe(before);
  const retitle = await p.werk(["propose", ex, "--title", "two minutes"]);
  expect(retitle.code).not.toBe(0);
  const edit = await p.werk(["propose", ex, "--ops", JSON.stringify([{ tag: "new", new: "two minutes" }])]);
  expect(edit.code).not.toBe(0);
  expect(events(p).length).toBe(before);
  expect((await ok(p, ["show", ex])).out).toContain("one minute");
  await ok(p, ["say", ex, "this is the TTL"]);
  expect((await ok(p, ["show", ex])).out).toContain("this is the TTL");
  await ok(p, ["accept", "cache", "--actor", "you"]);
  before = events(p).length;
  const again = await p.werk(["propose", ex, "--title", "two minutes"]);
  expect(again.code).not.toBe(0);
  expect(events(p).length).toBe(before);
  expect((await ok(p, ["show", ex])).out).toContain("one minute");
});

test("12.5", async () => {
  const p = freshProject();
  chat(p, "c5", [
    line("spoken", "first card words here", "person", "2026-02-02T09:00:00Z"),
    line("spoken", "second card words here", "agent", "2026-02-02T09:01:00Z"),
  ]);
  seed(p, [realCard("root", "Root")]);
  await ok(p, ["add", "one", "--title", "One", "--parent", "root"]);
  await ok(p, ["add", "two", "--title", "Two", "--parent", "root"]);
  await ok(p, ["quote", "one", "c5", "first card"]);
  await ok(p, ["quote", "two", "c5", "second card"]);
  await ok(p, ["discard", "one"]);
  expect(await shows(p, "one")).toBe(false);
  expect(await shows(p, "one:ex0")).toBe(false);
  await ok(p, ["accept", "two", "--actor", "you"]);
  expect(isGhost((await ok(p, ["show", "two"])).out)).toBe(false);
  const ex = await ok(p, ["show", "two:ex0"]);
  expect(isGhost(ex.out)).toBe(false);
  expect(ex.out).toContain("second card");
  // speaker, time, session, message position and span
  for (const part of ["agent", "2026-02-02T09:01:00Z", "sess-42", "1", "0..11"]) expect(ex.out).toContain(part);
});

// ---------- 26 ----------

const ticket = (o: {
  title?: string;
  cites: string;
  blocked: string;
  stories: string;
  build?: string;
  checks?: string;
}) =>
  `${o.title === undefined ? "" : `title: ${o.title}\n`}cites: ${o.cites}
blocked_by: ${o.blocked}
stories: ${o.stories}
touches: map view

## What to build

${o.build ?? "A person opens the card and sees its state."}

## Acceptance criteria

- [ ] The card shows its state.

## Checks

${o.checks ?? ""}
`;

function ticketProject(stories: number, cards: { id: string; ghost?: boolean }[]): Project {
  const p = freshProject();
  seed(p, [
    { type: "node.added", payload: { id: "root", kind: "card", title: "Root", status: "decided" } },
    ...cards.map((c) => ({
      type: c.ghost ? "node.proposed" : "node.added",
      payload: { id: c.id, kind: "card", title: c.id, status: "decided", parent: "root" },
    })),
  ]);
  const list = Array.from({ length: stories }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`);
  writeFileSync(join(p.dir, "spec.md"), `# Spec\n\n## User stories\n\n${list.join("\n")}\n\n## Other\n\nx\n`);
  mkdirSync(join(p.dir, "tickets"));
  return p;
}
const put = (p: Project, files: Record<string, string>) => {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", name), text);
};
const tcheck = (p: Project, ...args: string[]) => p.werk(["ticket-check", "tickets", ...args]);

test("26.1", async () => {
  const p = ticketProject(2, [{ id: "card-a" }, { id: "card-b" }]);
  put(p, {
    "01-a.md": ticket({
      title: "First slice",
      cites: "root, card-a",
      blocked: "",
      stories: "1",
      checks: "- `make test`",
    }),
    "02-b.md": ticket({ title: "Second slice", cites: "#card-b", blocked: "1", stories: "2" }),
  });
  const run = await tcheck(p, "--root", "root", "--spec", "spec.md");
  const lines = run.out.trimEnd().split("\n");
  expect(lines.length).toBe(1);
  expect(lines.at(-1)).toMatch(/\b0 failures\b/);
  expect(run.code).toBe(0);
});

test("26.2", async () => {
  const p = ticketProject(2, [{ id: "card-a" }, { id: "card-b" }]);
  // Line 9 of the What to build section names src/loop.ts.
  const build = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `Step ${n} of the work.`).join("\n");
  const first = ticket({
    title: "First slice",
    cites: "root, card-a",
    blocked: "",
    stories: "1",
    build: `${build}\nThe loop lives in src/loop.ts.\nThe Makefile gets a target.`,
  });
  const second = ticket({
    title: "Second slice",
    cites: "card-b",
    blocked: "1",
    stories: "2",
    build: `${"pad words here ".repeat(300)}`,
  });
  put(p, { "01-a.md": first, "02-b.md": second });
  expect(second.length).toBeGreaterThan(4000);
  const run = await tcheck(p, "--root", "root", "--spec", "spec.md");
  const lines = run.out.trimEnd().split("\n");
  const paths = lines.find((l) => l.startsWith("01-a.md") && l.includes("no-file-paths")) ?? "";
  expect(paths).toContain("src/loop.ts");
  expect(paths).toContain("line 9");
  expect(lines.filter((l) => l !== lines.at(-1)).some((l) => l.includes("Makefile"))).toBe(false);
  expect(lines.some((l) => l.startsWith("02-b.md") && l.includes("size"))).toBe(true);
  expect(lines.at(-1)).toMatch(/[1-9]\d* failures?/);
  expect(run.code).toBe(1);
});

test("26.3", async () => {
  const p = ticketProject(3, [{ id: "card-a" }, { id: "card-b" }, { id: "card-ghost", ghost: true }]);
  put(p, {
    "01-a.md": ticket({ title: "One", cites: "card-a", blocked: "", stories: "1" }),
    "02-a.md": ticket({ title: "Two", cites: "card-a", blocked: "3", stories: "2" }),
    "03-a.md": ticket({ title: "Three", cites: "card-a", blocked: "2", stories: "1" }),
  });
  const run = await tcheck(p, "--root", "root", "--spec", "spec.md");
  const lines = run.out.trimEnd().split("\n");
  const cited = lines.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toContain("card-b");
  const stories = lines.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories.length).toBe(1);
  expect(stories[0]).toContain("story 3");
  const cycle = lines.find((l) => l.includes("blocked_by") && l.includes("cycle")) ?? "";
  expect(cycle).toContain("02-a.md");
  expect(cycle).toContain("03-a.md");
  expect(run.out).not.toContain("card-ghost");
  expect(run.code).toBe(1);
});

test("26.4", async () => {
  const p = ticketProject(1, [{ id: "card-a" }]);
  put(p, { "01-a.md": ticket({ cites: "card-a", blocked: "", stories: "1" }) });
  const run = await tcheck(p, "--root", "root", "--spec", "spec.md");
  const lines = run.out.trimEnd().split("\n");
  const own = lines.filter((l) => l.startsWith("01-a.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain("title");
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("card-a"))).toBe(true);
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("story 1"))).toBe(true);
  expect(run.code).toBe(1);
});

test("26.5", async () => {
  const p = ticketProject(1, [{ id: "card-a" }]);
  put(p, { "01-a.md": ticket({ title: "One", cites: "card-a", blocked: "", stories: "1" }) });
  const missing = await tcheck(p, "--root", "root", "--spec", "nope.md");
  expect(`${missing.out}${missing.err}`).toMatch(/nope\.md/);
  expect(`${missing.out}${missing.err}`).toMatch(/missing|not found|no such|does not exist|no spec file/i);
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad-spec.md"), "# Spec\n\n## Goals\n\n1. x\n");
  expect((await tcheck(p, "--root", "root", "--spec", "bad-spec.md")).code).toBe(2);
  expect((await tcheck(p, "--root", "no-such-root", "--spec", "spec.md")).code).toBe(2);
  expect((await tcheck(p, "--spec", "spec.md")).code).toBe(2);
});

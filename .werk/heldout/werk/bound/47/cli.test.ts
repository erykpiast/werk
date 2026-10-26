// Held-out steps that run at the command line: ghosts (04), removal (08), quotes (12),
// ticket checks (26), and the agent prompts (19.1-19.4).
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((line) => line !== "");
const events = (p: Project) => lines(p).map((line) => JSON.parse(line));

function seed(p: Project, list: { type: string; payload: object }[]): void {
  const start = lines(p).length;
  const text = list.map((e, i) => JSON.stringify({ seq: start + i + 1, at: "t", actor: "you", ...e }));
  appendFileSync(logOf(p), `${text.join("\n")}\n`);
}
const card = (id: string, title: string, parent?: string) => ({
  type: "node.added",
  payload: { id, kind: "card", title, ...(parent ? { parent } : {}) },
});
const decided = (id: string) => ({ type: "node.decided", payload: { id } });

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}
const head = async (p: Project, id: string) => (await ok(p, ["show", id])).out.split("\n")[0] as string;

// ---------- 04 ghosts ----------

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = freshProject();
  seed(p, [card("checkout-flow", "Checkout flow")]);
  await ok(p, ["add", "other-ghost", "--title", "Another ghost", "--parent", "checkout-flow"]);
  const before = lines(p).length;
  const add = await ok(p, ["add", "retry-payment", "--title", "Retry payment", "--parent", "checkout-flow"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = events(p).slice(before);
  expect(after).toHaveLength(1);
  expect(after[0].type).toBe("node.proposed");
  expect(after[0].payload.parent).toBe("checkout-flow");
  const show = (await ok(p, ["show", "retry-payment"])).out;
  expect(show.split("\n")[0]).toContain("proposed");
  expect(show).toContain("parent: checkout-flow");

  const n = lines(p).length;
  await ok(p, ["accept", "retry-payment", "--actor", "you"]);
  const acc = events(p).slice(n);
  expect(acc).toHaveLength(1);
  expect(acc[0].type).toBe("change.accepted");
  const real = (await ok(p, ["show", "retry-payment"])).out;
  expect(real.split("\n")[0]).not.toContain("proposed");
  expect(real).toContain("parent: checkout-flow");
  expect(await head(p, "other-ghost")).toContain("proposed");
});

test("04.2 accepting a ghost child accepts its ghost parent, and its held link goes live", async () => {
  const p = freshProject();
  seed(p, [card("payments", "Payments"), card("fraud-rules", "Fraud rules")]);
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, [
    "link",
    "partial-refunds",
    "fraud-rules",
    "--type",
    "depends_on",
    "--why",
    "a partial refund passes the fraud rules",
  ]);
  await ok(p, ["add", "partial-refunds:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "x"]);
  await ok(p, ["link", "partial-refunds:opt0", "partial-refunds", "--type", "alternative_to"]);
  await ok(p, ["add", "src-refund", "--kind", "source", "--title", "Refund study", "--url", "https://x.invalid"]);
  await ok(p, ["link", "partial-refunds", "src-refund", "--type", "supported_by"]);
  const held = (await ok(p, ["show", "partial-refunds"])).out;
  const dep = held.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules")) as string;
  expect(dep).toContain("held");

  const n = lines(p).length;
  await ok(p, ["accept", "partial-refunds", "--actor", "you"]);
  const acc = events(p).slice(n);
  expect(acc.length).toBeGreaterThan(0);
  expect(acc.every((e) => e.type === "change.accepted")).toBe(true);
  for (const id of ["refunds", "partial-refunds", "partial-refunds:opt0", "src-refund"])
    expect(await head(p, id)).not.toContain("proposed");
  const live = (await ok(p, ["show", "partial-refunds"])).out;
  const dep2 = live.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules")) as string;
  expect(dep2).toBeDefined();
  expect(dep2).not.toContain("held");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = freshProject();
  seed(p, [card("onboarding", "Onboarding")]);
  await ok(p, ["add", "email-verification", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend-email", "--title", "Resend email", "--parent", "email-verification"]);
  await ok(p, ["discard", "email-verification"]);
  for (const id of ["email-verification", "resend-email"]) {
    const run = await p.werk(["show", id]);
    expect(run.code).not.toBe(0);
    expect(run.err).toContain("no node");
  }
  const show = (await ok(p, ["show", "onboarding"])).out;
  expect(show).not.toContain("ghost");
  expect(show).not.toContain("email-verification");
  expect(show).not.toContain("resend-email");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = freshProject();
  seed(p, [card("search", "Search")]);
  await ok(p, ["add", "search-index", "--title", "Search index", "--why", "Fast lookup", "--parent", "search"]);
  const before = lines(p).length;
  const again = await p.werk(["add", "search-index", "--title", "Other index", "--why", "Other why", "--parent", "search"]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("frozen");
  expect(lines(p).length).toBe(before);
  const show = (await ok(p, ["show", "search-index"])).out;
  expect(show).toContain("Search index");
  expect(show).toContain("why: Fast lookup");
});

test("04.5 an accept from the command line needs --actor you", async () => {
  const p = freshProject();
  seed(p, [card("compliance", "Compliance")]);
  await ok(p, ["add", "audit-log", "--title", "Audit log", "--parent", "compliance"]);
  const before = lines(p).length;
  const bare = await p.werk(["accept", "audit-log"]);
  expect(bare.code).not.toBe(0);
  expect(lines(p).length).toBe(before);
  expect(await head(p, "audit-log")).toContain("proposed");
  await ok(p, ["accept", "audit-log", "--actor", "you"]);
  expect(await head(p, "audit-log")).not.toContain("proposed");
});

// ---------- 08 removal ----------

async function serve(p: Project): Promise<{ url: string }> {
  const proc = p.start([process.execPath, join(import.meta.dir, "..", "src", "cli.ts"), "serve", "--port", "0"]);
  const reader = proc.stdout.getReader();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`serve ended: ${out}`);
    out += new TextDecoder().decode(value);
    const m = /http:\/\/\S+/.exec(out);
    if (m) return { url: m[0].replace(/\/map$/, "") };
  }
}
const page = async (url: string, id: string) => (await fetch(`${url}/map/${id}`)).text();

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const p = freshProject();
  seed(p, [
    card("root", "Root"),
    card("auth", "Auth", "root"),
    card("login", "Login", "auth"),
    card("session", "Session", "auth"),
    card("audit", "Audit", "root"),
    decided("auth"),
    { type: "edge.added", payload: { from: "login", to: "audit", type: "depends_on", why: "login writes audit" } },
  ]);
  const { url } = await serve(p);
  const before = lines(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  for (const id of ["auth", "login", "session"]) {
    expect((await p.werk(["show", id])).code).not.toBe(0);
    expect(await page(url, id)).toContain("data-missing");
  }
  const rootPage = await page(url, "root");
  expect(rootPage).not.toContain("/map/auth");
  const added = events(p).slice(before);
  expect(added).toHaveLength(1);
  expect(added[0].type).toBe("node.removed");
  const removed = (await ok(p, ["removed"])).out;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect((await ok(p, ["show", "audit"])).out).not.toContain("login");

  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).out).toContain("auth");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
  expect(await page(url, "auth")).toContain("/map/login");
  expect((await ok(p, ["show", "audit"])).out).toContain("login");
  expect((await ok(p, ["removed"])).out).not.toMatch(/auth|login|session/);
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  const p = freshProject();
  seed(p, [
    card("platform", "Platform"),
    card("auth", "Auth", "platform"),
    card("login", "Login", "auth"),
    card("session", "Session", "auth"),
  ]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect((await p.werk(["show", "auth"])).code).not.toBe(0);
  expect((await ok(p, ["show", "login"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: platform");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
});

test("08.3 a link waits until both of its ends are back", async () => {
  const p = freshProject();
  seed(p, [
    card("root", "Root"),
    card("a", "A", "root"),
    card("b", "B", "root"),
    card("login", "Login", "a"),
    card("session", "Session", "b"),
    { type: "edge.added", payload: { from: "login", to: "session", type: "depends_on", why: "login opens a session" } },
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const show = (await ok(p, ["show", "login"])).out;
  expect(show).not.toContain("session");
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toMatch(/depends_on\s+session/);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const p = freshProject();
  seed(p, [
    card("root", "Root"),
    card("login", "Login", "root"),
    card("billing", "Billing", "root"),
    { type: "node.added", payload: { id: "rfc-6749", kind: "source", title: "RFC 6749", url: "https://x.invalid" } },
    { type: "edge.added", payload: { from: "login", to: "rfc-6749", type: "supported_by" } },
    { type: "edge.added", payload: { from: "billing", to: "rfc-6749", type: "supported_by" } },
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const src = (await ok(p, ["show", "rfc-6749"])).out;
  expect(src).toMatch(/supported_by\s+billing/);
  const before = lines(p).length;
  const add = await p.werk(["add", "login", "--title", "New login", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  expect(add.err).toContain("restore #login");
  expect(lines(p).length).toBe(before);
  expect((await p.werk(["show", "login"])).code).not.toBe(0);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const p = freshProject();
  seed(p, [card("login", "Login")]);
  const before = lines(p).length;
  const run = await p.werk(["remove", "login"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("refused");
  await ok(p, ["show", "login"]);
  expect(lines(p).length).toBe(before);
});

test("08.6 restore refuses without the person's say-so", async () => {
  const p = freshProject();
  seed(p, [card("login", "Login")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const before = lines(p).length;
  const run = await p.werk(["restore", "login"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("refused");
  expect((await p.werk(["show", "login"])).code).not.toBe(0);
  expect(lines(p).length).toBe(before);
});

// ---------- 12 quotes ----------

const msg = (kind: string, text: string, speaker: string, at: string) =>
  JSON.stringify({ speaker, at, session: "sess-42", kind, text });

function chat(p: Project, name: string, rows: string[]): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${rows.join("\n")}\n`);
}

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = freshProject();
  const said = "we keep one log per conversation and never rewrite it";
  chat(p, "conv1", [
    msg("tool_result", "ls output", "agent", "2026-10-01T10:00:00Z"),
    msg("spoken", "how do we store chats?", "person", "2026-10-01T10:01:00Z"),
    msg("spoken", said, "agent", "2026-10-01T10:02:00Z"),
  ]);
  await ok(p, ["add", "chat-log", "--title", "One log per conversation"]);
  const before = lines(p).length;
  await ok(p, ["quote", "chat-log", "conv1", "one log per conversation"]);
  const added = events(p).slice(before);
  expect(added).toHaveLength(1);
  const ex = added[0].payload;
  expect(added[0].type).toBe("excerpt.quoted");
  expect(ex.card).toBe("chat-log");
  const show = (await ok(p, ["show", "chat-log"])).out;
  expect(show).toMatch(new RegExp(`supported_by\\s+${ex.id}`));
  const exShow = (await ok(p, ["show", ex.id])).out;
  const views = `${exShow}\n${show}`;
  const issues: string[] = [];
  if (!exShow.split("\n")[0]?.includes("proposed")) issues.push("excerpt is not a ghost");
  if (!exShow.includes("one log per conversation")) issues.push("no quoted words");
  if (!/agent/.test(views)) issues.push("no speaker");
  if (!views.includes("2026-10-01T10:02:00Z")) issues.push("no message time");
  if (!views.includes("sess-42")) issues.push("no session id");
  if (ex.message !== 3) issues.push(`message position is ${ex.message}, not 3`);
  const at = said.indexOf("one log per conversation");
  if (ex.start !== at || ex.end !== at + "one log per conversation".length) issues.push(`span ${ex.start}..${ex.end}`);
  expect({ issues, views }).toEqual({ issues: [], views });
});

test("12.2 a quote that is not unique fails, says which case, and writes nothing", async () => {
  const p = freshProject();
  chat(p, "conv2", [
    msg("spoken", "ship the reader first", "person", "t0"),
    msg("spoken", "ok, ship the reader first", "agent", "t1"),
    msg("spoken", "retry, then retry again", "person", "t2"),
  ]);
  await ok(p, ["add", "reader", "--title", "The reader ships first"]);
  const before = lines(p).length;
  const two = await p.werk(["quote", "reader", "conv2", "ship the reader first"]);
  expect(two.code).not.toBe(0);
  expect(two.err).toContain("2 messages");
  const twice = await p.werk(["quote", "reader", "conv2", "retry"]);
  expect(twice.code).not.toBe(0);
  expect(twice.err).toMatch(/2 times in message/);
  const none = await p.werk(["quote", "reader", "conv2", "a sentence nobody said"]);
  expect(none.code).not.toBe(0);
  expect(none.err).toContain("no exact match");
  expect((await ok(p, ["show", "reader"])).out).not.toContain("supported_by");
  expect(lines(p).length).toBe(before);
});

test("12.3 text that appears only in tool output is never quotable", async () => {
  const p = freshProject();
  chat(p, "conv3", [
    msg("spoken", "run the job", "person", "t0"),
    msg("tool_call", "run job; expect exit code 137", "agent", "t1"),
    msg("tool_result", "exit code 137 from the runner", "agent", "t2"),
    msg("tooling", "note: exit code 137 means killed", "agent", "t3"),
    msg("spoken", "the job was killed", "agent", "t4"),
  ]);
  await ok(p, ["add", "oom", "--title", "The runner gets more memory"]);
  const before = lines(p).length;
  const run = await p.werk(["quote", "oom", "conv3", "exit code 137"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("no exact match");
  expect(lines(p).length).toBe(before);
  expect((await ok(p, ["show", "oom"])).out).not.toContain("supported_by");
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = freshProject();
  chat(p, "conv4", [msg("spoken", "always cache the tokens", "person", "t0")]);
  await ok(p, ["add", "cache", "--title", "Tokens are cached"]);
  await ok(p, ["quote", "cache", "conv4", "cache the tokens"]);
  const ex = "cache:ex0";
  let before = lines(p).length;
  const plain = await p.werk(["add", "cache:ex9", "--kind", "excerpt", "--title", "my own words"]);
  expect(plain.code).not.toBe(0);
  expect(lines(p).length).toBe(before);
  const retitle = await p.werk(["propose", ex, "--title", "other words"]);
  expect(retitle.code).not.toBe(0);
  const edit = await p.werk(["propose", ex, "--ops", JSON.stringify([{ tag: "new", new: "x" }])]);
  expect(edit.code).not.toBe(0);
  expect(lines(p).length).toBe(before);
  expect((await ok(p, ["show", ex])).out).toContain("cache the tokens");
  await ok(p, ["say", ex, "a note on the excerpt"]);
  expect((await ok(p, ["show", ex])).out).toContain("a note on the excerpt");
  await ok(p, ["accept", "cache", "--actor", "you"]);
  before = lines(p).length;
  const edit2 = await p.werk(["propose", ex, "--ops", JSON.stringify([{ tag: "new", new: "x" }])]);
  expect(edit2.code).not.toBe(0);
  expect(lines(p).length).toBe(before);
  expect((await ok(p, ["show", ex])).out.split("\n")[1]).toBe("cache the tokens");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = freshProject();
  chat(p, "conv5", [
    msg("spoken", "first we drop the cache", "person", "2026-10-02T09:00:00Z"),
    msg("spoken", "then we warm the index", "agent", "2026-10-02T09:01:00Z"),
  ]);
  await ok(p, ["add", "drop", "--title", "Drop the cache"]);
  await ok(p, ["add", "warm", "--title", "Warm the index"]);
  await ok(p, ["quote", "drop", "conv5", "drop the cache"]);
  await ok(p, ["quote", "warm", "conv5", "warm the index"]);
  await ok(p, ["discard", "drop"]);
  expect((await p.werk(["show", "drop"])).code).not.toBe(0);
  expect((await p.werk(["show", "drop:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "warm", "--actor", "you"]);
  expect(await head(p, "warm")).not.toContain("proposed");
  const ex = (await ok(p, ["show", "warm:ex0"])).out;
  const views = `${ex}\n${(await ok(p, ["show", "warm"])).out}`;
  const issues: string[] = [];
  if (ex.split("\n")[0]?.includes("proposed")) issues.push("excerpt still a ghost");
  if (!ex.includes("warm the index")) issues.push("no quoted words");
  if (!/agent/.test(views)) issues.push("no speaker");
  if (!views.includes("2026-10-02T09:01:00Z")) issues.push("no time");
  if (!views.includes("sess-42")) issues.push("no session");
  if (!/message\D*1/.test(views)) issues.push("no message position");
  if (!/8\D+22/.test(views)) issues.push("no span");
  expect({ issues, views }).toEqual({ issues: [], views });
});

// ---------- 26 ticket-check ----------

const SPEC = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nNone.\n`;

const ticket = (o: { title?: string; cites: string; blocked: string; stories: string; build?: string; checks?: string }) =>
  `${o.title === undefined ? "" : `title: ${o.title}\n`}cites: ${o.cites}
blocked_by: ${o.blocked}
stories: ${o.stories}
touches: map view

## What to build

${o.build ?? "A person does the thing."}

## Acceptance criteria

- [ ] The thing shows in the map.

## Checks

${o.checks ?? ""}`;

function ticketProject(withGhost = false, nDecided = 2, stories = 2): Project {
  const p = freshProject();
  const list = [card("root", "Root"), decided("root")];
  for (let i = 1; i <= nDecided; i++) list.push(card(`c${i}`, `Card ${i}`, "root"), decided(`c${i}`));
  if (withGhost) list.push({ type: "node.proposed", payload: { id: "ghosty", kind: "card", title: "G", parent: "root" } });
  seed(p, list);
  writeFileSync(join(p.dir, "spec.md"), SPEC(stories));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}
const put = (p: Project, files: Record<string, string>) => {
  for (const [n, t] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", n), t);
};
const tcheck = (p: Project) => p.werk(["ticket-check", "tickets", "--root", "root", "--spec", "spec.md"]);

const validTickets = () => ({
  "01-first.md": ticket({ title: "First slice", cites: "root, c1", blocked: "", stories: "1", checks: "- `make test`\n" }),
  "02-second.md": ticket({ title: "Second slice", cites: "#c2", blocked: "1", stories: "2" }),
});

test("26.1 a folder of valid hand-written tickets gets a clean pass", async () => {
  const p = ticketProject();
  put(p, validTickets());
  const run = await tcheck(p);
  const out = run.out.trim().split("\n");
  expect(out).toHaveLength(1);
  expect(out[0]).toMatch(/\b0 failures\b/);
  expect(run.code).toBe(0);
});

test("26.2 a file path and an oversized ticket are named with their ticket and place", async () => {
  const p = ticketProject();
  const t = validTickets();
  put(p, t);
  expect((await tcheck(p)).code).toBe(0);
  // Line 9 of the file sits in the What to build section (heading on line 7).
  const first = ticket({
    title: "First slice",
    cites: "root, c1",
    blocked: "",
    stories: "1",
    build: "It changes src/loop.ts.\nIt also edits the Makefile.",
    checks: "- `make test`\n",
  });
  expect(first.split("\n")[8]).toContain("src/loop.ts");
  const second = `${t["02-second.md"]}\n${"padding words here. ".repeat(220)}\n`;
  expect(second.length).toBeGreaterThan(4000);
  put(p, { "01-first.md": first, "02-second.md": second });
  const run = await tcheck(p);
  const out = run.out.split("\n");
  expect(out.some((l) => l.startsWith("01-first.md") && l.includes("no-file-paths") && l.includes("src/loop.ts") && l.includes("line 9"))).toBe(true);
  expect(out.some((l) => l.includes("Makefile"))).toBe(false);
  expect(out.some((l) => l.startsWith("02-second.md") && l.includes("size"))).toBe(true);
  expect(out.filter(Boolean).at(-1)).toMatch(/[1-9]\d* failures?/);
  expect(run.code).toBe(1);
});

test("26.3 the set checks report an uncited card, a missing story and a blocker cycle, not a ghost", async () => {
  const p = ticketProject(true, 2, 3);
  put(p, {
    "01-a.md": ticket({ title: "A", cites: "root, c1", blocked: "", stories: "1" }),
    "02-b.md": ticket({ title: "B", cites: "c1", blocked: "3", stories: "2" }),
    "03-c.md": ticket({ title: "C", cites: "c1", blocked: "2", stories: "1" }),
  });
  const run = await tcheck(p);
  const out = run.out.split("\n");
  const cited = out.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited).toHaveLength(1);
  expect(cited[0]).toContain("c2");
  const stories = out.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories).toHaveLength(1);
  expect(stories[0]).toContain("story 3");
  const cycle = out.find((l) => l.includes("blocked_by") && l.includes("cycle")) as string;
  expect(cycle).toContain("02-b.md");
  expect(cycle).toContain("03-c.md");
  expect(run.out).not.toContain("ghosty");
  expect(run.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, and its cites do not count for the set", async () => {
  const p = ticketProject(false, 1, 1);
  put(p, { "01-notitle.md": ticket({ cites: "root, c1", blocked: "", stories: "1" }) });
  const run = await tcheck(p);
  const out = run.out.split("\n").filter(Boolean);
  const own = out.filter((l) => l.startsWith("01-notitle.md"));
  expect(own).toHaveLength(1);
  expect(own[0]).toContain("title");
  expect(out.some((l) => l.startsWith("ticket set") && l.includes("c1"))).toBe(true);
  expect(out.some((l) => l.startsWith("ticket set") && l.includes("story 1"))).toBe(true);
  expect(run.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const p = ticketProject();
  put(p, validTickets());
  const missing = await p.werk(["ticket-check", "tickets", "--root", "root", "--spec", "nope.md"]);
  expect(`${missing.out}${missing.err}`).toMatch(/spec/);
  expect(`${missing.out}${missing.err}`).toContain("nope.md");
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad.md"), "# Spec\n\n1. A line.\n");
  expect((await p.werk(["ticket-check", "tickets", "--root", "root", "--spec", "bad.md"])).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--root", "zzz", "--spec", "spec.md"])).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--spec", "spec.md"])).code).toBe(2);
});

// ---------- 19.1-19.4 agent prompts ----------
// A build pass, a chat agent and a sample agent start from the command line or the map. The help
// lists every verb; the server's routes are the map's actions.

const help = async (p: Project) => (await ok(p, ["help"])).out;

test("19.x the person can start a build pass, send a chat message and sample options", async () => {
  const p = freshProject();
  const verbs = [...(await help(p)).matchAll(/^ {2}([a-z-]+)/gm)].map((m) => m[1]);
  const server = readFileSync(join(import.meta.dir, "..", "src", "serve", "server.ts"), "utf8");
  const found = {
    build: verbs.some((v) => /build|loop|run/.test(v as string)) || /\/api\/build/.test(server),
    chat: verbs.includes("chat") || /\/api\/chat/.test(server),
    sample: verbs.includes("sample") || /\/api\/sample/.test(server),
  };
  expect(found).toEqual({ build: true, chat: true, sample: true });
});

// Held-out steps 04.x, 08.x and 10.x at the command-line seam. Each test runs werk on a fresh
// project from the repository's own harness.
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project, type Run } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const events = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as { seq: number; type: string; actor: string; payload: Record<string, unknown> });

async function ok(p: Project, args: string[]): Promise<Run> {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run;
}

/** A real card: the agent proposes it, the person accepts it. */
async function realCard(p: Project, id: string, title: string, parent?: string): Promise<void> {
  await ok(p, ["add", id, "--title", title, ...(parent ? ["--parent", parent] : [])]);
  await ok(p, ["accept", id, "--actor", "you"]);
}

async function decide(p: Project, id: string): Promise<void> {
  await ok(p, ["edit", id, "--who", "you", "--no-basis", "a root decision", "--unchallenged", "no other way was seen"]);
  await ok(p, ["kill", id, "--revisit"]);
  await ok(p, ["status", id, "decided"]);
}

const isGhost = (show: string) => (show.split("\n")[0] ?? "").includes("proposed");

// ---------- 04 ----------

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = freshProject();
  await realCard(p, "checkout-flow", "Checkout flow");
  await ok(p, ["add", "other-ghost", "--title", "Some other ghost", "--parent", "checkout-flow"]);
  const before = events(p).length;
  const add = await ok(p, ["add", "retry-payment", "--title", "Retry payment", "--parent", "checkout-flow"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const afterAdd = events(p);
  expect(afterAdd.length).toBe(before + 1);
  expect(afterAdd.at(-1)?.type).toBe("node.proposed");
  expect(afterAdd.at(-1)?.payload.parent).toBe("checkout-flow");
  const ghost = (await ok(p, ["show", "retry-payment"])).out;
  expect(isGhost(ghost)).toBe(true);
  expect(ghost).toContain("parent: checkout-flow  Checkout flow");

  await ok(p, ["accept", "retry-payment", "--actor", "you"]);
  const afterAccept = events(p);
  expect(afterAccept.length).toBe(afterAdd.length + 1);
  expect(afterAccept.at(-1)?.type).toBe("change.accepted");
  const real = (await ok(p, ["show", "retry-payment"])).out;
  expect(isGhost(real)).toBe(false);
  expect(real).toContain("parent: checkout-flow  Checkout flow");
  expect(isGhost((await ok(p, ["show", "other-ghost"])).out)).toBe(true);
});

test("04.2 accepting a ghost child also accepts its ghost parent, and its held link goes live", async () => {
  const p = freshProject();
  await realCard(p, "payments", "Payments");
  await realCard(p, "fraud-rules", "Fraud rules");
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial-refunds", "fraud-rules", "--type", "depends_on", "--why", "uses the fraud score"]);
  await ok(p, ["add", "pr-opt", "--kind", "option", "--title", "Full refunds only", "--why_not", "too strict"]);
  await ok(p, ["link", "pr-opt", "partial-refunds", "--type", "alternative_to"]);
  await ok(p, ["add", "pr-src", "--kind", "source", "--title", "Refund policy", "--url", "https://example.com"]);
  await ok(p, ["link", "partial-refunds", "pr-src", "--type", "supported_by"]);
  const held = (await ok(p, ["show", "partial-refunds"])).out;
  const depLine = (s: string) => s.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud-rules")) ?? "";
  expect(depLine(held)).toContain("held");

  const before = events(p).length;
  await ok(p, ["accept", "partial-refunds", "--actor", "you"]);
  const added = events(p).slice(before);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((e) => e.type === "change.accepted")).toBe(true);
  for (const id of ["refunds", "partial-refunds", "pr-opt", "pr-src"]) {
    expect({ id, ghost: isGhost((await ok(p, ["show", id])).out) }).toEqual({ id, ghost: false });
  }
  const live = (await ok(p, ["show", "partial-refunds"])).out;
  expect(depLine(live)).not.toBe("");
  expect(depLine(live)).not.toContain("held");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = freshProject();
  await realCard(p, "onboarding", "Onboarding");
  await ok(p, ["add", "email-verification", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend-email", "--title", "Resend email", "--parent", "email-verification"]);
  await ok(p, ["discard", "email-verification"]);
  for (const id of ["email-verification", "resend-email"]) {
    const show = await p.werk(["show", id]);
    expect(show.code).not.toBe(0);
    expect(show.err).toContain("no node");
  }
  const onboarding = (await ok(p, ["show", "onboarding"])).out;
  expect(onboarding).not.toContain("ghost");
  expect(onboarding).not.toContain("<- refines");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = freshProject();
  await realCard(p, "search", "Search");
  await ok(p, ["add", "search-index", "--title", "Search index", "--why", "Find cards fast", "--parent", "search"]);
  const before = events(p).length;
  const again = await p.werk(["add", "search-index", "--title", "A different index", "--why", "Other words"]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("a ghost's words are frozen");
  expect(events(p).length).toBe(before);
  const show = (await ok(p, ["show", "search-index"])).out;
  expect(show).toContain("Search index");
  expect(show).toContain("why: Find cards fast");
});

test("04.5 an accept from the command line needs the statement that the person asked for it", async () => {
  const p = freshProject();
  await realCard(p, "compliance", "Compliance");
  await ok(p, ["add", "audit-log", "--title", "Audit log", "--parent", "compliance"]);
  const before = events(p).length;
  const refused = await p.werk(["accept", "audit-log"]);
  expect(refused.code).not.toBe(0);
  expect(events(p).length).toBe(before);
  expect(isGhost((await ok(p, ["show", "audit-log"])).out)).toBe(true);
  const accepted = await p.werk(["accept", "audit-log", "--actor", "you"]);
  expect(accepted.code).toBe(0);
  expect(isGhost((await ok(p, ["show", "audit-log"])).out)).toBe(false);
});

// ---------- 08 ----------

const showsIn = async (p: Project, id: string) => (await p.werk(["show", id])).code === 0;

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const p = freshProject();
  await realCard(p, "auth", "Auth");
  await decide(p, "auth");
  await realCard(p, "login", "Login", "auth");
  await realCard(p, "session", "Session", "auth");
  await realCard(p, "audit", "Audit");
  await ok(p, ["link", "login", "audit", "--type", "depends_on", "--why", "login writes audit entries"]);
  expect((await ok(p, ["show", "auth"])).out).toContain("[decided]");
  expect((await ok(p, ["show", "audit"])).out).toContain("login");

  const before = events(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  for (const id of ["auth", "login", "session"]) expect({ id, shows: await showsIn(p, id) }).toEqual({ id, shows: false });
  const added = events(p).slice(before);
  expect(added.length).toBe(1);
  expect(added[0]?.type).toBe("node.removed");
  const removed = (await ok(p, ["removed"])).out;
  expect(removed).toContain("auth: removed");
  expect(removed).toContain("and login");
  expect(removed).toContain("and session");
  expect((await ok(p, ["show", "audit"])).out).not.toContain("login");

  await ok(p, ["restore", "auth", "--actor", "you"]);
  const auth = (await ok(p, ["show", "auth"])).out;
  expect(auth).toContain("<- refines         login");
  expect(auth).toContain("<- refines         session");
  expect((await ok(p, ["show", "audit"])).out).toContain("login");
  const none = (await ok(p, ["removed"])).out;
  expect(none).not.toContain("auth");
  expect(none).not.toContain("login");
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  const p = freshProject();
  await realCard(p, "platform", "Platform");
  await realCard(p, "auth", "Auth", "platform");
  await realCard(p, "login", "Login", "auth");
  await realCard(p, "session", "Session", "auth");
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect(await showsIn(p, "auth")).toBe(false);
  for (const id of ["login", "session"]) expect((await ok(p, ["show", id])).out).toContain("parent: platform");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).out).toContain("parent: platform");
  for (const id of ["login", "session"]) expect((await ok(p, ["show", id])).out).toContain("parent: auth");
  const platform = (await ok(p, ["show", "platform"])).out;
  expect(platform).not.toContain("login");
  expect(platform).not.toContain("session");
});

test("08.3 a link waits until both of its ends are back", async () => {
  const p = freshProject();
  await realCard(p, "branch-a", "Branch A");
  await realCard(p, "branch-b", "Branch B");
  await realCard(p, "login", "Login", "branch-a");
  await realCard(p, "session", "Session", "branch-b");
  await ok(p, ["link", "login", "session", "--type", "depends_on", "--why", "login opens a session"]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const login = await ok(p, ["show", "login"]);
  expect(login.out).not.toContain("session");
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toContain("depends_on      session");
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const p = freshProject();
  await realCard(p, "root", "Root");
  await realCard(p, "login", "Login", "root");
  await realCard(p, "billing", "Billing", "root");
  await ok(p, ["add", "rfc-6749", "--kind", "source", "--title", "OAuth 2.0", "--url", "https://www.rfc-editor.org/rfc/rfc6749"]);
  await ok(p, ["accept", "rfc-6749", "--actor", "you"]);
  await ok(p, ["link", "login", "rfc-6749", "--type", "supported_by"]);
  await ok(p, ["link", "billing", "rfc-6749", "--type", "supported_by"]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const source = (await ok(p, ["show", "rfc-6749"])).out;
  expect(source).toContain("<- supported_by    billing");
  const before = events(p).length;
  const add = await p.werk(["add", "login", "--title", "A new login"]);
  expect(add.code).not.toBe(0);
  expect(add.err).toContain("restore #login");
  expect(events(p).length).toBe(before);
  expect(await showsIn(p, "login")).toBe(false);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const p = freshProject();
  await realCard(p, "login", "Login");
  const before = events(p).length;
  const run = await p.werk(["remove", "login"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("refused");
  expect(await showsIn(p, "login")).toBe(true);
  expect(events(p).length).toBe(before);
});

test("08.6 restore refuses without the person's say-so", async () => {
  const p = freshProject();
  await realCard(p, "login", "Login");
  await ok(p, ["remove", "login", "--actor", "you"]);
  const before = events(p).length;
  const run = await p.werk(["restore", "login"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("refused");
  expect(await showsIn(p, "login")).toBe(false);
  expect(events(p).length).toBe(before);
});

// ---------- 10 (command-line half) ----------

/** No map UI exists to type a note in, so a person's note is the event the map would append. */
function personNote(p: Project, id: string, text: string): number {
  const seq = (events(p).at(-1)?.seq ?? 0) + 1;
  const event = { seq, at: new Date().toISOString(), actor: "you", type: "note.added", payload: { id, text } };
  appendFileSync(logOf(p), `${JSON.stringify(event)}\n`);
  return seq;
}

test("10.1 cli half: the agent's say writes a note on the card's thread", async () => {
  const p = freshProject();
  await realCard(p, "auth-login", "Login uses magic links");
  await decide(p, "auth-login");
  const say = await p.werk(["say", "auth-login", "Should expired links show a retry button?"]);
  expect(say.code).toBe(0);
  const show = (await ok(p, ["show", "auth-login"])).out;
  console.log("10.1 show:\n" + show);
  expect(show).toContain("agent: Should expired links show a retry button?");
});

test("10.2 the agent reads the person's notes in the inbox, after a position and capped by count", async () => {
  const p = freshProject();
  await realCard(p, "auth-login", "Login uses magic links");
  const seqs = ["first", "second", "third", "fourth"].map((t) => personNote(p, "auth-login", t));
  const all = (await ok(p, ["inbox"])).out;
  console.log("10.2 inbox:\n" + all);
  const order = ["first", "second", "third", "fourth"].map((t) => all.indexOf(`    ${t}\n`));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  for (const seq of seqs) expect(all).toContain(`[${seq}] #auth-login`);
  const since = (await ok(p, ["inbox", "--since", String(seqs[0])])).out;
  expect(since).not.toContain("    first\n");
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(`    ${t}\n`);
  const capped = (await ok(p, ["inbox", "--since", String(seqs[0]), "-n", "2"])).out;
  expect(capped).toContain("    second\n");
  expect(capped).toContain("    third\n");
  expect(capped).not.toContain("    first\n");
  expect(capped).not.toContain("    fourth\n");
});

test("10.3 cli half: a corrected ghost keeps its earlier notes, with one marker", async () => {
  const p = freshProject();
  await ok(p, ["add", "auth-retry", "--title", "Retry sends a new link"]);
  personNote(p, "auth-retry", "No — retry must reuse the same link");
  await ok(p, ["say", "auth-retry", "Understood, I will correct it"]);
  await ok(p, ["discard", "auth-retry"]);
  await ok(p, ["add", "auth-retry", "--title", "Retry reuses the same link"]);
  const show = (await ok(p, ["show", "auth-retry"])).out;
  const a = show.indexOf("No — retry must reuse the same link");
  const b = show.indexOf("Understood, I will correct it");
  const m = show.indexOf("proposed again");
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(-1);
  expect(m).toBeGreaterThan(Math.max(a, b));
  expect(show.split("proposed again").length - 1).toBe(1);
  expect(show).toContain("Retry reuses the same link");
  personNote(p, "auth-retry", "Good, accept");
  expect((await ok(p, ["show", "auth-retry"])).out.indexOf("Good, accept")).toBeGreaterThan(m);
});

test("10.4 cli half: a note on a discarded ghost stays in the inbox", async () => {
  const p = freshProject();
  await ok(p, ["add", "cache-ttl", "--title", "Cache entries live 60 seconds"]);
  personNote(p, "cache-ttl", "Why 60 seconds?");
  await ok(p, ["discard", "cache-ttl"]);
  const inbox = (await ok(p, ["inbox"])).out;
  console.log("10.4 inbox:\n" + inbox);
  expect(inbox).toContain("#cache-ttl");
  expect(inbox).toContain("Why 60 seconds?");
  await ok(p, ["add", "cache-ttl", "--title", "Cache entries live 30 seconds"]);
  const show = (await ok(p, ["show", "cache-ttl"])).out;
  expect(show.indexOf("Why 60 seconds?")).toBeLessThan(show.indexOf("proposed again"));
  expect(show.split("proposed again").length - 1).toBe(1);
});

test("10.5 cli half: the agent writes a note on an excerpt", async () => {
  const p = freshProject();
  // An excerpt comes only from a quote; the command line has no verb for it, so the log holds it.
  const seed = [
    { type: "node.added", payload: { id: "src-rfc", kind: "source", title: "RFC 6749", url: "https://example.com" } },
    { type: "node.added", payload: { id: "src-rfc-quote", kind: "excerpt", title: "Clients retry with the same code" } },
  ];
  appendFileSync(
    logOf(p),
    seed.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e })).join("\n") + "\n",
  );
  const say = await p.werk(["say", "src-rfc-quote", "This quote supports the retry decision"]);
  console.log("10.5 say:", say);
  expect(say.code).toBe(0);
  expect((await ok(p, ["show", "src-rfc-quote"])).out).toContain("agent: This quote supports the retry decision");
});

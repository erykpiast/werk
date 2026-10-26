// Held-out tests for the ghost, accept and discard steps (04.x, 62.x, 63.x).
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logFile = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) => readFileSync(logFile(p), "utf8").split("\n").filter(Boolean);
const events = (p: Project) => lines(p).map((line) => JSON.parse(line));

function seed(p: Project, type: string, payload: object): void {
  const seq = lines(p).length + 1;
  appendFileSync(logFile(p), `${JSON.stringify({ seq, at: new Date().toISOString(), actor: "you", type, payload })}\n`);
}

async function ok(p: Project, ...args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run.out;
}

async function realCard(p: Project, id: string, title: string, parent?: string) {
  await ok(p, "add", id, "--title", title, ...(parent ? ["--parent", parent] : []));
  await ok(p, "accept", id, "--actor", "you");
}

/** The header line of show: `card <id>  [status]  marks`. */
async function header(p: Project, id: string): Promise<string> {
  return (await ok(p, "show", id)).split("\n")[0] as string;
}
const isGhost = (h: string) => /\bproposed\b/.test(h);

/** The line of show that lists a link to `to` with the given type and direction. */
function linkLine(out: string, dir: "->" | "<-", type: string, to: string): string | undefined {
  return out.split("\n").find((line) => new RegExp(`^\\s+${dir}\\s+${type}\\s+${to}\\s`).test(line));
}

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = freshProject();
  await realCard(p, "checkout-flow", "Checkout flow");
  await ok(p, "add", "other-ghost", "--title", "Other ghost");
  const before = lines(p).length;
  const out = await ok(p, "add", "retry-payment", "--title", "Retry payment", "--parent", "checkout-flow");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");
  const fresh = events(p).slice(before);
  expect(fresh).toHaveLength(1);
  expect(fresh[0].type).toBe("node.proposed");
  expect(fresh[0].payload.parent).toBe("checkout-flow");
  const shown = await ok(p, "show", "retry-payment");
  expect(isGhost(shown.split("\n")[0] as string)).toBe(true);
  expect(shown).toMatch(/parent: checkout-flow\s+Checkout flow/);

  const beforeAccept = lines(p).length;
  await ok(p, "accept", "retry-payment", "--actor", "you");
  const accepted = events(p).slice(beforeAccept);
  expect(accepted).toHaveLength(1);
  expect(accepted[0].type).toBe("change.accepted");
  const real = await ok(p, "show", "retry-payment");
  expect(isGhost(real.split("\n")[0] as string)).toBe(false);
  expect(real).toMatch(/parent: checkout-flow\s+Checkout flow/);
  expect(isGhost(await header(p, "other-ghost"))).toBe(true);
});

test("04.2 accepting a ghost child accepts its ghost parent, and its held link goes live with no further event", async () => {
  const p = freshProject();
  await realCard(p, "payments", "Payments");
  await realCard(p, "fraud-rules", "Fraud rules");
  await ok(p, "add", "refunds", "--title", "Refunds", "--parent", "payments");
  await ok(p, "add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds");
  await ok(
    p,
    "link",
    "partial-refunds",
    "fraud-rules",
    "--type",
    "depends_on",
    "--why",
    "refund limits follow the fraud rules",
  );
  await ok(
    p,
    "add",
    "partial-refunds:opt0",
    "--kind",
    "option",
    "--title",
    "Full refunds only",
    "--why_not",
    "Too coarse",
  );
  await ok(p, "link", "partial-refunds:opt0", "partial-refunds", "--type", "alternative_to");
  await ok(
    p,
    "add",
    "refund-study",
    "--kind",
    "source",
    "--title",
    "Refund study",
    "--finding",
    "Partial refunds cut churn",
  );
  await ok(p, "link", "partial-refunds", "refund-study", "--type", "supported_by");
  const held = linkLine(await ok(p, "show", "partial-refunds"), "->", "depends_on", "fraud-rules");
  expect(held).toContain("(held)");

  const before = lines(p).length;
  await ok(p, "accept", "partial-refunds", "--actor", "you");
  const fresh = events(p).slice(before);
  expect(fresh.length).toBeGreaterThan(0);
  expect(fresh.every((event) => event.type === "change.accepted")).toBe(true);
  expect(isGhost(await header(p, "refunds"))).toBe(false);
  expect(isGhost(await header(p, "partial-refunds"))).toBe(false);
  expect(isGhost(await header(p, "partial-refunds:opt0"))).toBe(false);
  expect(isGhost(await header(p, "refund-study"))).toBe(false);
  const live = linkLine(await ok(p, "show", "partial-refunds"), "->", "depends_on", "fraud-rules");
  expect(live).toBeDefined();
  expect(live).not.toContain("held");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = freshProject();
  await realCard(p, "onboarding", "Onboarding");
  await ok(p, "add", "email-verification", "--title", "Email verification", "--parent", "onboarding");
  await ok(p, "add", "resend-email", "--title", "Resend email", "--parent", "email-verification");
  await ok(p, "discard", "email-verification");
  for (const id of ["email-verification", "resend-email"]) {
    const run = await p.werk(["show", id]);
    expect(run.code).not.toBe(0);
    expect(run.err + run.out).toMatch(/no node .* in the map/);
  }
  const onboarding = await ok(p, "show", "onboarding");
  expect(onboarding).not.toContain("ghost");
  expect(linkLine(onboarding, "<-", "refines", "\\S+")).toBeUndefined();
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = freshProject();
  await realCard(p, "search", "Search");
  await ok(p, "add", "search-index", "--title", "Search index", "--why", "Fast lookups", "--parent", "search");
  const before = lines(p).length;
  const run = await p.werk([
    "add",
    "search-index",
    "--title",
    "Search catalog",
    "--why",
    "Other words",
    "--parent",
    "search",
  ]);
  expect(run.code).not.toBe(0);
  expect(run.err + run.out).toMatch(/ghost's words are frozen/);
  expect(lines(p).length).toBe(before);
  const shown = await ok(p, "show", "search-index");
  expect(shown).toContain("Search index");
  expect(shown).toContain("why: Fast lookups");
  expect(shown).not.toContain("Search catalog");
});

test("04.5 an accept from the command line needs the statement that the person asked for it", async () => {
  const p = freshProject();
  await realCard(p, "platform", "Platform");
  await ok(p, "add", "audit-log", "--title", "Audit log", "--parent", "platform");
  const before = lines(p).length;
  const refused = await p.werk(["accept", "audit-log"]);
  expect(refused.code).not.toBe(0);
  expect(lines(p).length).toBe(before);
  expect(isGhost(await header(p, "audit-log"))).toBe(true);
  const accepted = await p.werk(["accept", "audit-log", "--actor", "you"]);
  expect(accepted.code).toBe(0);
  expect(isGhost(await header(p, "audit-log"))).toBe(false);
});

test("62.1 an agent proposes a card and a person accepts it into the map", async () => {
  const p = freshProject();
  await realCard(p, "base", "Base");
  await ok(p, "add", "some-ghost", "--title", "Some ghost");
  const earlier = lines(p);
  const out = await ok(
    p,
    "add",
    "use-log",
    "--title",
    "Use a log",
    "--body",
    "Every write appends.",
    "--why",
    "Replay is cheap.",
  );
  expect(out).toContain("proposed");
  const after = lines(p);
  expect(after).toHaveLength(earlier.length + 1);
  expect(after.slice(0, earlier.length)).toEqual(earlier);
  const shown = await ok(p, "show", "use-log");
  expect(shown).toContain("Use a log");
  expect(shown).toContain("Every write appends.");
  expect(shown).toContain("Replay is cheap.");
  expect(isGhost(shown.split("\n")[0] as string)).toBe(true);

  const accept = await p.werk(["accept", "use-log", "--actor", "you"]);
  expect(accept.code).toBe(0);
  const final = lines(p);
  expect(final).toHaveLength(after.length + 1);
  expect(final.slice(0, after.length)).toEqual(after);
  const real = await ok(p, "show", "use-log");
  expect(real).toContain("Use a log");
  expect(real).toContain("Every write appends.");
  expect(real).toContain("Replay is cheap.");
  expect(isGhost(real.split("\n")[0] as string)).toBe(false);
});

test("62.2 an accept without the person's claim refuses and leaves the ghost waiting", async () => {
  const p = freshProject();
  await ok(p, "add", "use-log", "--title", "Use a log");
  const before = lines(p).length;
  const refused = await p.werk(["accept", "use-log"]);
  expect(refused.code).not.toBe(0);
  expect(lines(p).length).toBe(before);
  expect(isGhost(await header(p, "use-log"))).toBe(true);
  await ok(p, "accept", "use-log", "--actor", "you");
  expect(isGhost(await header(p, "use-log"))).toBe(false);
});

test("62.3 the words of a ghost are frozen", async () => {
  const p = freshProject();
  await ok(p, "add", "use-log", "--title", "Use a log", "--body", "Old body");
  let before = lines(p).length;
  const body = await p.werk([
    "propose",
    "use-log",
    "--ops",
    JSON.stringify([{ tag: "elaborated", old: "Old body", new: "New body" }]),
  ]);
  expect(body.code).not.toBe(0);
  expect(lines(p).length).toBe(before);
  before = lines(p).length;
  const retitle = await p.werk(["propose", "use-log", "--title", "Use an append-only log"]);
  expect(retitle.code).not.toBe(0);
  expect(lines(p).length).toBe(before);
  const again = await p.werk(["add", "use-log", "--title", "Something else"]);
  expect(again.code).not.toBe(0);
  expect(lines(p).length).toBe(before);
  const shown = await ok(p, "show", "use-log");
  expect(shown).toContain("Use a log");
  expect(isGhost(shown.split("\n")[0] as string)).toBe(true);
});

test("62.4 a retitle on a real card shows only the new title and keeps the old one in the log", async () => {
  const p = freshProject();
  await ok(p, "add", "use-log", "--title", "Use a log", "--body", "Old body");
  await ok(p, "accept", "use-log", "--actor", "you");
  const before = lines(p);
  const retitle = await p.werk(["propose", "use-log", "--title", "Use an append-only log"]);
  expect(retitle.code).toBe(0);
  const after = lines(p);
  expect(after).toHaveLength(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const shown = await ok(p, "show", "use-log");
  expect(shown).toContain("Use an append-only log");
  expect(shown).not.toContain("Use a log");
  expect(readFileSync(logFile(p), "utf8")).toContain('"title":"Use a log"');
  await ok(p, "propose", "use-log", "--ops", JSON.stringify([{ tag: "elaborated", old: "Old body", new: "New body" }]));
  const edited = await ok(p, "show", "use-log");
  expect(edited).toContain("New body");
  expect(edited).toContain("Use an append-only log");
});

test("62.5 an option, a source and an excerpt also enter as ghosts", async () => {
  const p = freshProject();
  await realCard(p, "storage", "Storage");
  const before0 = lines(p).length;
  const opt = await ok(
    p,
    "add",
    "storage:opt0",
    "--kind",
    "option",
    "--title",
    "Use Postgres",
    "--why_not",
    "Needs a server",
  );
  expect(opt).toContain("proposed");
  expect(lines(p).length).toBe(before0 + 1);
  const src = await ok(
    p,
    "add",
    "bench",
    "--kind",
    "source",
    "--title",
    "Benchmark notes",
    "--finding",
    "Writes are fast",
  );
  expect(src).toContain("proposed");
  expect(lines(p).length).toBe(before0 + 2);
  mkdirSync(join(p.dir, ".werk", "chats"));
  writeFileSync(
    join(p.dir, ".werk", "chats", "talk.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "we keep one file per map" })}\n`,
  );
  const excerpt = await p.werk(["quote", "storage", "talk", "one file per map"]);
  expect(excerpt.code).toBe(0);
  expect(excerpt.out).toContain("proposed");
  expect(lines(p).length).toBe(before0 + 3);
  const shownOpt = await ok(p, "show", "storage:opt0");
  expect(shownOpt).toContain("Needs a server");
  expect(isGhost(shownOpt.split("\n")[0] as string)).toBe(true);
  expect(isGhost(await header(p, "bench"))).toBe(true);
  expect(isGhost(await header(p, "storage:ex0"))).toBe(true);
  await ok(p, "accept", "storage:opt0", "--actor", "you");
  const real = await ok(p, "show", "storage:opt0");
  expect(isGhost(real.split("\n")[0] as string)).toBe(false);
  expect(real).toContain("why not: Needs a server");
  expect(isGhost(await header(p, "bench"))).toBe(true);
  expect(isGhost(await header(p, "storage:ex0"))).toBe(true);
});

test("63.1 a link to a ghost is held, and it goes live on accept with no extra link event", async () => {
  const p = freshProject();
  await realCard(p, "storage", "Storage");
  await ok(p, "add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  const link = await p.werk([
    "link",
    "use-sqlite",
    "storage",
    "--type",
    "depends_on",
    "--why",
    "SQLite is how storage is kept",
  ]);
  expect(link.err + link.out).not.toContain("refused");
  expect(link.code).toBe(0);
  expect(linkLine(await ok(p, "show", "use-sqlite"), "->", "depends_on", "storage")).toContain("held");
  const storage = await ok(p, "show", "storage");
  const liveLine = linkLine(storage, "<-", "depends_on", "use-sqlite");
  expect(liveLine === undefined || liveLine.includes("held")).toBe(true);
  await ok(p, "accept", "use-sqlite", "--actor", "you");
  const live = linkLine(await ok(p, "show", "use-sqlite"), "->", "depends_on", "storage");
  expect(live).toBeDefined();
  expect(live).not.toContain("held");
  const linkEvents = events(p).filter(
    (e) => e.type === "edge.added" && e.payload.from === "use-sqlite" && e.payload.to === "storage",
  );
  expect(linkEvents).toHaveLength(1);
});

test("63.2 accepting a ghost child accepts its ghost parent, but not a ghost it depends on", async () => {
  const p = freshProject();
  await realCard(p, "platform", "Platform");
  await ok(p, "add", "auth", "--title", "Auth", "--parent", "platform");
  await ok(p, "add", "magic-links", "--title", "Magic links", "--parent", "auth");
  await ok(p, "add", "email-service", "--title", "Email service", "--parent", "platform");
  await ok(p, "link", "magic-links", "email-service", "--type", "depends_on", "--why", "links go out by email");
  await ok(p, "accept", "magic-links", "--actor", "you");
  expect(isGhost(await header(p, "magic-links"))).toBe(false);
  const auth = await ok(p, "show", "auth");
  expect(isGhost(auth.split("\n")[0] as string)).toBe(false);
  expect(auth).toMatch(/parent: platform\s+Platform/);
  expect(isGhost(await header(p, "email-service"))).toBe(true);
  expect(linkLine(await ok(p, "show", "magic-links"), "->", "depends_on", "email-service")).toContain("held");
});

test("63.3 an accept takes the card's own ghost options and sources with it", async () => {
  const p = freshProject();
  // A decided real card, so that the new card has a decided basis for the contract check.
  seed(p, "node.added", { id: "storage", kind: "card", title: "Storage", who: "me" });
  seed(p, "node.decided", { id: "storage" });
  await ok(p, "add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  await ok(p, "add", "use-sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "Needs a server");
  await ok(p, "link", "use-sqlite:opt0", "use-sqlite", "--type", "alternative_to");
  await ok(p, "add", "benchmark-notes", "--kind", "source", "--title", "Benchmark notes", "--finding", "Fast enough");
  await ok(p, "link", "use-sqlite", "benchmark-notes", "--type", "supported_by");
  // The contract also needs a kill criterion; it is recorded as setup.
  await ok(p, "kill", "use-sqlite", "--revisit");
  const who = await p.werk(["edit", "use-sqlite", "--who", "me"]);
  const status = await p.werk(["status", "use-sqlite", "decided"]);
  await ok(p, "accept", "use-sqlite", "--actor", "you");
  const card = await ok(p, "show", "use-sqlite");
  expect(card.split("\n")[0]).toContain("[decided]");
  expect(isGhost(card.split("\n")[0] as string)).toBe(false);
  expect(card).toContain("who: me");
  const opt = await ok(p, "show", "use-sqlite:opt0");
  expect(isGhost(opt.split("\n")[0] as string)).toBe(false);
  expect(opt).toContain("why not: Needs a server");
  const src = await ok(p, "show", "benchmark-notes");
  expect(isGhost(src.split("\n")[0] as string)).toBe(false);
  const edge = linkLine(card, "->", "supported_by", "benchmark-notes");
  expect(edge).toBeDefined();
  expect(edge).not.toContain("held");
  expect(who.code).toBe(0);
  expect(status.code, status.err).toBe(0);
});

test("63.4 discarding a ghost parent discards its whole ghost branch", async () => {
  const p = freshProject();
  await realCard(p, "platform", "Platform");
  await ok(p, "add", "auth", "--title", "Auth", "--parent", "platform");
  await ok(p, "add", "magic-links", "--title", "Magic links", "--parent", "auth");
  await ok(p, "add", "magic-links:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "Weak");
  await ok(p, "link", "magic-links:opt0", "magic-links", "--type", "alternative_to");
  await ok(p, "discard", "auth");
  for (const id of ["auth", "magic-links", "magic-links:opt0"]) expect((await p.werk(["show", id])).code).not.toBe(0);
  const platform = await ok(p, "show", "platform");
  expect(isGhost(platform.split("\n")[0] as string)).toBe(false);
  expect(platform).not.toContain("Auth");
  expect(platform).not.toContain("Magic links");
  expect(platform).not.toContain("Passwords");
  expect(platform).not.toContain("ghost");
});

test("63.5 a ghost changes no count of a real card until it is accepted", async () => {
  const p = freshProject();
  seed(p, "node.added", {
    id: "storage",
    kind: "card",
    title: "Storage",
    who: "you",
    unchallenged: "nothing to weigh",
  });
  seed(p, "node.decided", { id: "storage" });
  seed(p, "node.added", {
    id: "files",
    kind: "card",
    title: "Files",
    parent: "storage",
    who: "you",
    unchallenged: "obvious",
  });
  seed(p, "node.decided", { id: "files" });
  const rollupLine = (out: string) => out.split("\n").find((line) => line.startsWith("subtree:"));
  const first = await ok(p, "show", "storage");
  const before = rollupLine(first);
  expect(before).toContain("2 cards");
  expect(before).toContain("unchallenged");
  expect(first).not.toMatch(/stale/i);

  await ok(p, "add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  await ok(p, "add", "use-sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "Needs a server");
  await ok(p, "link", "use-sqlite:opt0", "use-sqlite", "--type", "alternative_to");
  await ok(p, "edit", "use-sqlite", "--who", "you");
  await ok(p, "kill", "use-sqlite", "--revisit");
  await ok(p, "status", "use-sqlite", "decided");
  expect((await header(p, "use-sqlite")).includes("[decided]")).toBe(true);
  const second = await ok(p, "show", "storage");
  expect(rollupLine(second)).toBe(before);
  expect(second).not.toMatch(/stale/i);

  await ok(p, "accept", "use-sqlite", "--actor", "you");
  expect(rollupLine(await ok(p, "show", "storage"))).toContain("3 cards");
});

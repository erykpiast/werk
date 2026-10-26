// Held-out steps 04.x, 62.x and 63.x: ghosts, accept and discard at the command line.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
const events = (p: Project) => lines(p).map((l) => JSON.parse(l) as { type: string; actor: string; payload: any });

function seed(p: Project, payloads: object[]): void {
  const start = lines(p).length;
  appendFileSync(
    logOf(p),
    payloads
      .map((payload, i) => JSON.stringify({ seq: start + i + 1, at: "t", actor: "you", type: "node.added", payload }))
      .join("\n") + "\n",
  );
}

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

const header = (out: string) => out.split("\n")[0] ?? "";
const isGhost = (out: string) => /\bproposed\b/.test(header(out));

async function show(p: Project, id: string) {
  return p.werk(["show", id]);
}

const ROOT = { id: "root", kind: "card", title: "Root" };

// 04.1
test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = freshProject();
  seed(p, [ROOT, { id: "checkout", kind: "card", title: "Checkout flow", parent: "root" }]);
  await ok(p, ["add", "other", "--title", "Other idea"]);
  const before = lines(p).length;
  const add = await ok(p, ["add", "retry", "--title", "Retry payment", "--parent", "checkout"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = events(p);
  expect(after.length).toBe(before + 1);
  const last = after.at(-1)!;
  expect(last.type).toContain("proposed");
  expect(last.payload.parent).toBe("checkout");
  const shown = (await show(p, "retry")).out;
  expect(isGhost(shown)).toBe(true);
  expect(shown).toMatch(/parent: checkout\s+Checkout flow/);

  const n = lines(p).length;
  await ok(p, ["accept", "retry", "--actor", "you"]);
  const accepted = events(p).slice(n);
  expect(accepted.length).toBe(1);
  expect(accepted[0]!.type).toContain("accept");
  const real = (await show(p, "retry")).out;
  expect(isGhost(real)).toBe(false);
  expect(real).toMatch(/parent: checkout\s+Checkout flow/);
  expect(isGhost((await show(p, "other")).out)).toBe(true);
});

// 04.2
test("04.2 accepting a ghost child accepts its ghost parent, and its held link goes live", async () => {
  const p = freshProject();
  seed(p, [
    ROOT,
    { id: "payments", kind: "card", title: "Payments", parent: "root" },
    { id: "fraud", kind: "card", title: "Fraud rules", parent: "root", status: "decided", who: "me", no_basis: "top" },
  ]);
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial", "fraud", "--type", "depends_on", "--why", "uses the fraud limits"]);
  await ok(p, ["add", "partial:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "too strict"]);
  await ok(p, ["link", "partial:opt0", "partial", "--type", "alternative_to"]);
  await ok(p, ["add", "src-ref", "--kind", "source", "--title", "Refund study", "--finding", "partials are common"]);
  await ok(p, ["link", "partial", "src-ref", "--type", "supported_by"]);
  const held = (await show(p, "partial")).out;
  expect(held).toMatch(/-> depends_on\s+fraud\s+Fraud rules\s+\(held\)/);

  const n = lines(p).length;
  await ok(p, ["accept", "partial", "--actor", "you"]);
  const added = events(p).slice(n);
  expect(added.length).toBeGreaterThan(0);
  for (const e of added) expect(e.type).toContain("accept");
  expect(isGhost((await show(p, "refunds")).out)).toBe(false);
  const live = (await show(p, "partial")).out;
  expect(isGhost(live)).toBe(false);
  expect(isGhost((await show(p, "partial:opt0")).out)).toBe(false);
  expect(isGhost((await show(p, "src-ref")).out)).toBe(false);
  const dep = live.split("\n").find((l) => l.includes("-> depends_on"))!;
  expect(dep).toContain("fraud");
  expect(dep).not.toContain("held");
});

// 04.3
test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = freshProject();
  seed(p, [ROOT, { id: "onboarding", kind: "card", title: "Onboarding", parent: "root" }]);
  await ok(p, ["add", "email-verify", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend", "--title", "Resend email", "--parent", "email-verify"]);
  await ok(p, ["discard", "email-verify"]);
  for (const id of ["email-verify", "resend"]) {
    const run = await show(p, id);
    expect(run.code).not.toBe(0);
    expect(run.err).toContain("no node");
  }
  const onboarding = (await show(p, "onboarding")).out;
  expect(onboarding).not.toContain("<- refines");
  expect(onboarding).not.toContain("ghost");
});

// 04.4
test("04.4 the words of a ghost are frozen", async () => {
  const p = freshProject();
  seed(p, [ROOT, { id: "search", kind: "card", title: "Search", parent: "root" }]);
  await ok(p, ["add", "search-index", "--title", "Search index", "--why", "Fast lookups", "--parent", "search"]);
  const n = lines(p).length;
  const again = await p.werk(["add", "search-index", "--title", "Another index", "--why", "Other words"]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("frozen");
  expect(lines(p).length).toBe(n);
  const shown = (await show(p, "search-index")).out;
  expect(shown).toContain("Search index");
  expect(shown).toContain("why: Fast lookups");
  expect(shown).not.toContain("Another index");
});

// 04.5
test("04.5 an accept from the command line needs the statement that the person asked for it", async () => {
  const p = freshProject();
  seed(p, [ROOT, { id: "ops", kind: "card", title: "Operations", parent: "root" }]);
  await ok(p, ["add", "audit-log", "--title", "Audit log", "--parent", "ops"]);
  const n = lines(p).length;
  const bare = await p.werk(["accept", "audit-log"]);
  expect(bare.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect(isGhost((await show(p, "audit-log")).out)).toBe(true);
  const run = await p.werk(["accept", "audit-log", "--actor", "you"]);
  expect(run.code).toBe(0);
  expect(isGhost((await show(p, "audit-log")).out)).toBe(false);
});

// 62.1
test("62.1 an agent proposes a card and a person accepts it into the map", async () => {
  const p = freshProject();
  seed(p, [
    ROOT,
    { id: "a", kind: "card", title: "A", parent: "root" },
    { id: "b", kind: "card", title: "B", parent: "root" },
  ]);
  const before = lines(p);
  const add = await ok(p, [
    "add",
    "log-card",
    "--title",
    "Use a log",
    "--body",
    "One log per map.",
    "--why",
    "Replays are exact.",
  ]);
  expect(add.out).toContain("proposed");
  const after = lines(p);
  expect(after.length).toBe(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const ghost = (await show(p, "log-card")).out;
  for (const words of ["Use a log", "One log per map.", "Replays are exact."]) expect(ghost).toContain(words);
  expect(isGhost(ghost)).toBe(true);
  const run = await p.werk(["accept", "log-card", "--actor", "you"]);
  expect(run.code).toBe(0);
  const last = lines(p);
  expect(last.length).toBe(after.length + 1);
  expect(last.slice(0, after.length)).toEqual(after);
  const real = (await show(p, "log-card")).out;
  for (const words of ["Use a log", "One log per map.", "Replays are exact."]) expect(real).toContain(words);
  expect(isGhost(real)).toBe(false);
});

// 62.2
test("62.2 an accept without the person's claim refuses and leaves the ghost waiting", async () => {
  const p = freshProject();
  seed(p, [ROOT]);
  await ok(p, ["add", "g", "--title", "A ghost"]);
  const n = lines(p).length;
  const bare = await p.werk(["accept", "g"]);
  expect(bare.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect(isGhost((await show(p, "g")).out)).toBe(true);
  await ok(p, ["accept", "g", "--actor", "you"]);
  expect(isGhost((await show(p, "g")).out)).toBe(false);
});

// 62.3
test("62.3 the words of a ghost are frozen", async () => {
  const p = freshProject();
  seed(p, [ROOT]);
  await ok(p, ["add", "g", "--title", "Use a log"]);
  let n = lines(p).length;
  const edit = await p.werk(["edit", "g", "--body", "A new body"]);
  expect(edit.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  const retitle = await p.werk(["retitle", "g", "Use an append-only log"]);
  expect(retitle.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  n = lines(p).length;
  const again = await p.werk(["add", "g", "--title", "Something else"]);
  expect(again.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  const shown = (await show(p, "g")).out;
  expect(shown.split("\n")[1]).toBe("Use a log");
  expect(isGhost(shown)).toBe(true);
});

// 62.4
test("62.4 a retitle on a real card shows only the new title and keeps the old one in the log", async () => {
  const p = freshProject();
  seed(p, [ROOT]);
  await ok(p, ["add", "g", "--title", "Use a log"]);
  await ok(p, ["accept", "g", "--actor", "you"]);
  const before = lines(p);
  const run = await p.werk(["retitle", "g", "Use an append-only log"]);
  expect(run.code).toBe(0);
  const after = lines(p);
  expect(after.length).toBe(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const shown = (await show(p, "g")).out;
  expect(shown).toContain("Use an append-only log");
  expect(shown).not.toContain("Use a log\n");
  expect(shown.split("\n").some((l) => l === "Use a log")).toBe(false);
  expect(before.some((l) => l.includes('"Use a log"'))).toBe(true);
  expect(readFileSync(logOf(p), "utf8")).toContain('"title":"Use a log"');
  await ok(p, ["edit", "g", "--body", "Events are appended, never rewritten."]);
  const edited = (await show(p, "g")).out;
  expect(edited).toContain("Events are appended, never rewritten.");
  expect(edited).toContain("Use an append-only log");
});

// 62.5
test("62.5 an option, a source and an excerpt also enter as ghosts", async () => {
  const p = freshProject();
  seed(p, [ROOT]);
  await ok(p, ["add", "card", "--title", "Bill per seat"]);
  await ok(p, ["accept", "card", "--actor", "you"]);
  mkdirSync(join(p.dir, ".werk", "chats"));
  writeFileSync(
    join(p.dir, ".werk", "chats", "pricing.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" })}\n`,
  );

  const adds: [string, string[]][] = [
    [
      "card:opt0",
      ["add", "card:opt0", "--kind", "option", "--title", "Bill per use", "--why_not", "usage is hard to predict"],
    ],
    [
      "src-a",
      [
        "add",
        "src-a",
        "--kind",
        "source",
        "--title",
        "Pricing study",
        "--url",
        "https://example.com/s",
        "--finding",
        "seat pricing wins",
      ],
    ],
    ["card:ex0", ["quote", "card", "pricing", "seats are the unit we bill"]],
  ];
  for (const [, args] of adds) {
    const before = lines(p);
    const run = await ok(p, args);
    expect(run.out).toContain("proposed");
    const after = lines(p);
    expect(after.length).toBe(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
    if (args[1] === "card:opt0") await ok(p, ["link", "card:opt0", "card", "--type", "alternative_to"]);
  }
  const opt = (await show(p, "card:opt0")).out;
  expect(opt).toContain("Bill per use");
  expect(opt).toContain("usage is hard to predict");
  expect(isGhost(opt)).toBe(true);
  const src = (await show(p, "src-a")).out;
  expect(src).toContain("Pricing study");
  expect(src).toContain("seat pricing wins");
  expect(isGhost(src)).toBe(true);
  const ex = (await show(p, "card:ex0")).out;
  expect(ex).toContain("seats are the unit we bill");
  expect(isGhost(ex)).toBe(true);

  await ok(p, ["accept", "card:opt0", "--actor", "you"]);
  const real = (await show(p, "card:opt0")).out;
  expect(isGhost(real)).toBe(false);
  expect(real).toContain("why not: usage is hard to predict");
  expect(isGhost((await show(p, "src-a")).out)).toBe(true);
  expect(isGhost((await show(p, "card:ex0")).out)).toBe(true);
});

// 63.1
test("63.1 a link to a ghost is held, and it goes live on accept with no extra link event", async () => {
  const p = freshProject();
  seed(p, [
    ROOT,
    { id: "storage", kind: "card", title: "Storage", parent: "root", status: "decided", who: "me", no_basis: "top" },
  ]);
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  const link = await p.werk([
    "link",
    "sqlite",
    "storage",
    "--type",
    "depends_on",
    "--why",
    "stores what Storage names",
  ]);
  expect(link.code, `link refused: ${link.err}`).toBe(0);
  const ghost = (await show(p, "sqlite")).out;
  expect(ghost).toMatch(/-> depends_on\s+storage\s+Storage\s+\(held\)/);
  const storage = (await show(p, "storage")).out;
  expect(storage).not.toMatch(/<- depends_on\s+sqlite/);
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const live = (await show(p, "sqlite")).out;
  const dep = live.split("\n").find((l) => l.includes("-> depends_on"))!;
  expect(dep).toContain("storage");
  expect(dep).not.toContain("held");
  const linkEvents = events(p).filter((e) => e.type.startsWith("link") && e.payload.type === "depends_on");
  expect(linkEvents.length).toBe(1);
});

// 63.2
test("63.2 accepting a ghost child accepts its ghost parent, but not a ghost it depends on", async () => {
  const p = freshProject();
  seed(p, [ROOT, { id: "platform", kind: "card", title: "Platform", parent: "root" }]);
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await ok(p, ["add", "email", "--title", "Email service", "--parent", "platform"]);
  await ok(p, ["link", "magic", "email", "--type", "depends_on", "--why", "sends the link"]);
  await ok(p, ["accept", "magic", "--actor", "you"]);
  expect(isGhost((await show(p, "magic")).out)).toBe(false);
  const auth = (await show(p, "auth")).out;
  expect(isGhost(auth)).toBe(false);
  expect(auth).toMatch(/parent: platform\s+Platform/);
  expect(isGhost((await show(p, "email")).out)).toBe(true);
  const dep = (await show(p, "magic")).out.split("\n").find((l) => l.includes("-> depends_on"))!;
  expect(dep).toContain("email");
  expect(dep).toContain("held");
});

// 63.3
test("63.3 an accept takes the card's own ghost options and sources with it", async () => {
  const p = freshProject();
  seed(p, [
    ROOT,
    { id: "storage", kind: "card", title: "Storage", parent: "root", status: "decided", who: "me", no_basis: "top" },
    {
      id: "files",
      kind: "card",
      title: "Files are local",
      parent: "root",
      status: "decided",
      who: "me",
      no_basis: "top",
    },
  ]);
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server"]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await ok(p, ["add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "fast enough"]);
  await ok(p, ["link", "sqlite", "bench", "--type", "supported_by"]);
  await ok(p, ["link", "sqlite", "files", "--type", "depends_on", "--why", "a local file"]);
  await ok(p, ["kill", "sqlite", "--revisit"]);
  const who = await p.werk(["edit", "sqlite", "--who", "you"]);
  const status = await p.werk(["status", "sqlite", "decided"]);
  expect(who.code, who.err).toBe(0);
  expect(status.code, status.err).toBe(0);
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const card = (await show(p, "sqlite")).out;
  expect(isGhost(card)).toBe(false);
  expect(header(card)).toContain("[decided]");
  expect(card).toMatch(/who: you/);
  const opt = (await show(p, "sqlite:opt0")).out;
  expect(isGhost(opt)).toBe(false);
  expect(opt).toContain("needs a server");
  const src = (await show(p, "bench")).out;
  expect(isGhost(src)).toBe(false);
  const edge = src.split("\n").find((l) => l.includes("<- supported_by"))!;
  expect(edge).toContain("sqlite");
  expect(edge).not.toContain("held");
});

// 63.4
test("63.4 discarding a ghost parent discards its whole ghost branch", async () => {
  const p = freshProject();
  seed(p, [ROOT, { id: "platform", kind: "card", title: "Platform", parent: "root" }]);
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await ok(p, ["add", "magic:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "people forget them"]);
  await ok(p, ["link", "magic:opt0", "magic", "--type", "alternative_to"]);
  await ok(p, ["discard", "auth"]);
  for (const id of ["auth", "magic", "magic:opt0"]) expect((await show(p, id)).code).not.toBe(0);
  const platform = (await show(p, "platform")).out;
  expect(isGhost(platform)).toBe(false);
  expect(platform).not.toContain("<- refines");
  const root = (await show(p, "root")).out;
  for (const t of ["Auth", "Magic links", "Passwords"]) expect(root).not.toContain(t);
});

// 63.5
test("63.5 a ghost changes no count of a real card until it is accepted", async () => {
  const p = freshProject();
  seed(p, [
    ROOT,
    { id: "storage", kind: "card", title: "Storage", parent: "root", status: "decided", who: "me", no_basis: "top" },
    {
      id: "files",
      kind: "card",
      title: "Files",
      parent: "storage",
      status: "decided",
      who: "you",
      no_basis: "top",
      unchallenged: "nothing else fit",
    },
    { id: "local", kind: "card", title: "Local first", parent: "root", status: "decided", who: "me", no_basis: "top" },
  ]);
  const subtree = (out: string) => out.split("\n").find((l) => l.startsWith("subtree:"));
  const before = (await show(p, "storage")).out;
  expect(subtree(before)).toContain("1 unchallenged");
  expect(header(before)).not.toContain("stale");
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "Postgres", "--why_not", "a server"]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await ok(p, ["link", "sqlite", "local", "--type", "depends_on", "--why", "a local file"]);
  await ok(p, ["kill", "sqlite", "--revisit"]);
  await ok(p, ["edit", "sqlite", "--who", "you"]);
  await ok(p, ["status", "sqlite", "decided"]);
  const during = (await show(p, "storage")).out;
  expect(subtree(during)).toBe(subtree(before));
  expect(header(during)).not.toContain("stale");
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const after = (await show(p, "storage")).out;
  expect(subtree(after)).toContain("3 cards");
  expect(after).toMatch(/<- refines\s+sqlite\s+Use SQLite/);
});

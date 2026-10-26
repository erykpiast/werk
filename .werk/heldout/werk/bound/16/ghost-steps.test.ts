// Held-out steps 04.x, 62.x and 63.x: ghosts, accepts and discards at the command line.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { head, isGhost, linkLines, mapProject } from "./map-helpers.ts";

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const m = mapProject();
  m.seed("node.added", { id: "checkout", kind: "card", title: "Checkout flow" });
  // Another ghost already in the map, so "every other ghost" has a member.
  await m.ok("add", "other-idea", "--title", "Other idea");
  const before = m.lines().length;

  const add = await m.ok("add", "retry-payment", "--title", "Retry payment", "--parent", "checkout");
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");

  const after = m.events();
  expect(after.length).toBe(before + 1);
  const ev = after.at(-1);
  expect(ev?.type).toBe("node.proposed");
  expect(ev?.payload.parent).toBe("checkout");

  const shown = await m.ok("show", "retry-payment");
  expect(isGhost(shown.out)).toBe(true);
  expect(shown.out).toContain("parent: checkout  Checkout flow");

  const accept = await m.ok("accept", "retry-payment", "--actor", "you");
  expect(accept.code).toBe(0);
  const accepted = m.events();
  expect(accepted.length).toBe(before + 2);
  expect(accepted.at(-1)?.type).toBe("change.accepted");

  const real = await m.ok("show", "retry-payment");
  expect(isGhost(real.out)).toBe(false);
  expect(real.out).toContain("parent: checkout  Checkout flow");
  expect(linkLines(real.out).find((l) => l.includes("refines") && l.includes("checkout"))).not.toContain("held");

  const other = await m.ok("show", "other-idea");
  expect(isGhost(other.out)).toBe(true);
});

test("04.2 accepting a ghost child accepts its ghost parent; the held link goes live with no event", async () => {
  const m = mapProject();
  m.seed("node.added", { id: "payments", kind: "card", title: "Payments" });
  m.seed("node.added", { id: "fraud-rules", kind: "card", title: "Fraud rules" });
  await m.ok("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await m.ok("add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds");
  await m.ok(
    "link",
    "partial-refunds",
    "fraud-rules",
    "--type",
    "depends_on",
    "--why",
    "a partial refund passes the fraud rules",
  );
  await m.ok(
    "add",
    "partial-refunds:opt0",
    "--kind",
    "option",
    "--title",
    "Full refunds only",
    "--why_not",
    "too coarse",
  );
  await m.ok("link", "partial-refunds:opt0", "partial-refunds", "--type", "alternative_to");
  await m.ok("add", "refund-study", "--kind", "source", "--title", "Refund study", "--finding", "partials are common");
  await m.ok("link", "partial-refunds", "refund-study", "--type", "supported_by");

  const held = await m.ok("show", "partial-refunds");
  const dep = linkLines(held.out).find((l) => l.includes("depends_on") && l.includes("fraud-rules"));
  expect(dep).toContain("held");

  const before = m.lines().length;
  await m.ok("accept", "partial-refunds", "--actor", "you");
  const added = m.events().slice(before);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((e) => e.type === "change.accepted")).toBe(true);
  expect(added.some((e) => e.type.startsWith("edge."))).toBe(false);

  expect(isGhost((await m.ok("show", "refunds")).out)).toBe(false);
  const live = await m.ok("show", "partial-refunds");
  expect(isGhost(live.out)).toBe(false);
  expect(isGhost((await m.ok("show", "partial-refunds:opt0")).out)).toBe(false);
  expect(isGhost((await m.ok("show", "refund-study")).out)).toBe(false);
  const liveDep = linkLines(live.out).find((l) => l.includes("depends_on") && l.includes("fraud-rules"));
  expect(liveDep).toBeDefined();
  expect(liveDep).not.toContain("held");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const m = mapProject();
  m.seed("node.added", { id: "onboarding", kind: "card", title: "Onboarding" });
  await m.ok("add", "email-verification", "--title", "Email verification", "--parent", "onboarding");
  await m.ok("add", "resend-email", "--title", "Resend email", "--parent", "email-verification");
  await m.ok("discard", "email-verification");

  const a = await m.w("show", "email-verification");
  const b = await m.w("show", "resend-email");
  expect(a.code).not.toBe(0);
  expect(a.err).toContain("no node #email-verification in the map");
  expect(b.code).not.toBe(0);
  expect(b.err).toContain("no node #resend-email in the map");
  const onboarding = await m.ok("show", "onboarding");
  expect(linkLines(onboarding.out).filter((l) => l.includes("<- refines"))).toEqual([]);
  expect(onboarding.out).not.toContain("ghost");
});

test("04.4 the words of a ghost are frozen", async () => {
  const m = mapProject();
  m.seed("node.added", { id: "search", kind: "card", title: "Search" });
  await m.ok("add", "search-index", "--title", "Search index", "--why", "A query reads an index", "--parent", "search");
  const before = m.lines().length;
  const again = await m.w(
    "add",
    "search-index",
    "--title",
    "Search index two",
    "--why",
    "Other words",
    "--parent",
    "search",
  );
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("a ghost's words are frozen");
  expect(m.lines().length).toBe(before);
  const shown = await m.ok("show", "search-index");
  expect(shown.out).toContain("Search index\n");
  expect(shown.out).toContain("why: A query reads an index");
});

test("04.5 an accept from the command line needs the person's statement", async () => {
  const m = mapProject();
  m.seed("node.added", { id: "platform", kind: "card", title: "Platform" });
  await m.ok("add", "audit-log", "--title", "Audit log", "--parent", "platform");
  const before = m.lines().length;
  const refused = await m.w("accept", "audit-log");
  expect(refused.code).not.toBe(0);
  expect(m.lines().length).toBe(before);
  expect(isGhost((await m.ok("show", "audit-log")).out)).toBe(true);
  const accept = await m.w("accept", "audit-log", "--actor", "you");
  expect(accept.code).toBe(0);
  expect(isGhost((await m.ok("show", "audit-log")).out)).toBe(false);
});

test("62.1 an agent proposes a card and a person accepts it into the map", async () => {
  const m = mapProject();
  m.seed("node.added", { id: "root", kind: "card", title: "Root" });
  m.seed("node.added", { id: "store", kind: "card", title: "Store", parent: "root" });
  m.seed("note.added", { id: "store", text: "a note" });
  const before = m.lines();

  const add = await m.ok(
    "add",
    "use-log",
    "--title",
    "Use a log",
    "--body",
    "Every change appends one line.",
    "--why",
    "A log keeps history",
  );
  expect(add.out).toContain("proposed");
  const mid = m.lines();
  expect(mid.length).toBe(before.length + 1);
  expect(mid.slice(0, before.length)).toEqual(before);

  const ghost = await m.ok("show", "use-log");
  expect(ghost.out).toContain("Use a log");
  expect(ghost.out).toContain("Every change appends one line.");
  expect(ghost.out).toContain("why: A log keeps history");
  expect(isGhost(ghost.out)).toBe(true);

  const accept = await m.w("accept", "use-log", "--actor", "you");
  expect(accept.code).toBe(0);
  const after = m.lines();
  expect(after.length).toBe(mid.length + 1);
  expect(after.slice(0, mid.length)).toEqual(mid);

  const real = await m.ok("show", "use-log");
  expect(real.out).toContain("Use a log");
  expect(real.out).toContain("Every change appends one line.");
  expect(real.out).toContain("why: A log keeps history");
  expect(isGhost(real.out)).toBe(false);
  expect(real.out).not.toContain("ghost");
});

test("62.2 an accept without the person's claim refuses and leaves the ghost waiting", async () => {
  const m = mapProject();
  await m.ok("add", "use-log", "--title", "Use a log");
  const before = m.lines().length;
  const refused = await m.w("accept", "use-log");
  expect(refused.code).not.toBe(0);
  expect(m.lines().length).toBe(before);
  expect(isGhost((await m.ok("show", "use-log")).out)).toBe(true);
  await m.ok("accept", "use-log", "--actor", "you");
  expect(isGhost((await m.ok("show", "use-log")).out)).toBe(false);
});

test("62.3 the words of a ghost are frozen", async () => {
  const m = mapProject();
  await m.ok("add", "use-log", "--title", "Use a log", "--body", "First body");
  let before = m.lines().length;

  // An edit of the body is a staged change to the body: the propose verb with body ops.
  const body = await m.w(
    "propose",
    "use-log",
    "--ops",
    JSON.stringify([{ tag: "elaborated", old: "First body", new: "Second body" }]),
  );
  expect(body.code).not.toBe(0);
  expect(m.lines().length).toBe(before);

  before = m.lines().length;
  const retitle = await m.w("propose", "use-log", "--title", "Use an append-only log");
  expect(retitle.code).not.toBe(0);
  expect(m.lines().length).toBe(before);

  before = m.lines().length;
  const again = await m.w("add", "use-log", "--title", "Use a database");
  expect(again.code).not.toBe(0);
  expect(m.lines().length).toBe(before);

  const shown = await m.ok("show", "use-log");
  expect(shown.out).toContain("Use a log");
  expect(isGhost(shown.out)).toBe(true);
});

test("62.4 a retitle on a real card shows only the new title and keeps the old one in the log", async () => {
  const m = mapProject();
  await m.ok("add", "use-log", "--title", "Use a log", "--body", "First body");
  await m.ok("accept", "use-log", "--actor", "you");
  const before = m.lines();

  const retitle = await m.w("propose", "use-log", "--title", "Use an append-only log");
  expect(retitle.code).toBe(0);
  const after = m.lines();
  expect(after.length).toBe(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);

  const shown = await m.ok("show", "use-log");
  expect(shown.out).toContain("Use an append-only log");
  expect(shown.out.replaceAll("Use an append-only log", "")).not.toContain("Use a log");
  expect(after.some((line) => line.includes('"title":"Use a log"'))).toBe(true);

  await m.ok(
    "propose",
    "use-log",
    "--ops",
    JSON.stringify([{ tag: "elaborated", old: "First body", new: "Second body" }]),
  );
  const edited = await m.ok("show", "use-log");
  expect(edited.out).toContain("Second body");
  expect(edited.out).toContain("Use an append-only log");
});

test("62.5 an option, a source and an excerpt also enter as ghosts", async () => {
  const m = mapProject();
  m.seed("node.added", { id: "storage", kind: "card", title: "Storage" });
  mkdirSync(join(m.p.dir, ".werk", "chats"));
  writeFileSync(
    join(m.p.dir, ".werk", "chats", "talk.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "2026-01-01T10:00:00Z", session: "s1", kind: "spoken", text: "we keep one log per project" })}\n`,
  );

  let before = m.lines().length;
  const opt = await m.ok(
    "add",
    "storage:opt0",
    "--kind",
    "option",
    "--title",
    "Use a database",
    "--why_not",
    "needs a server",
  );
  expect(opt.out).toContain("proposed");
  expect(m.lines().length).toBe(before + 1);
  await m.ok("link", "storage:opt0", "storage", "--type", "alternative_to");

  before = m.lines().length;
  const src = await m.ok(
    "add",
    "log-paper",
    "--kind",
    "source",
    "--title",
    "Log paper",
    "--url",
    "https://example.com/log",
    "--finding",
    "logs scale",
  );
  expect(src.out).toContain("proposed");
  expect(m.lines().length).toBe(before + 1);

  before = m.lines().length;
  const ex = await m.ok("quote", "storage", "talk", "one log per project");
  expect(ex.out).toContain("proposed");
  expect(m.lines().length).toBe(before + 1);
  const exId = ex.out.split(":").slice(0, 2).join(":");

  const o = await m.ok("show", "storage:opt0");
  expect(o.out).toContain("Use a database");
  expect(o.out).toContain("why not: needs a server");
  expect(isGhost(o.out)).toBe(true);
  const s = await m.ok("show", "log-paper");
  expect(s.out).toContain("Log paper");
  expect(s.out).toContain("finding: logs scale");
  expect(isGhost(s.out)).toBe(true);
  const e = await m.ok("show", exId);
  expect(e.out).toContain("one log per project");
  expect(isGhost(e.out)).toBe(true);

  await m.ok("accept", "storage:opt0", "--actor", "you");
  const real = await m.ok("show", "storage:opt0");
  expect(isGhost(real.out)).toBe(false);
  expect(real.out).toContain("why not: needs a server");
  expect(isGhost((await m.ok("show", "log-paper")).out)).toBe(true);
  expect(isGhost((await m.ok("show", exId)).out)).toBe(true);
});

test("63.1 a link to a ghost is held, and it goes live on accept with no extra link event", async () => {
  const m = mapProject();
  m.seed("node.added", { id: "storage", kind: "card", title: "Storage", status: "decided" });
  await m.ok("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  // "as its basis": a depends_on link.
  const link = await m.w(
    "link",
    "use-sqlite",
    "storage",
    "--type",
    "depends_on",
    "--why",
    "SQLite stores what Storage names",
  );
  expect(link.err).toBe("");
  expect(link.code).toBe(0);
  const shown = await m.ok("show", "use-sqlite");
  expect(linkLines(shown.out).find((l) => l.includes("depends_on") && l.includes("storage"))).toContain("held");
  const storage = await m.ok("show", "storage");
  expect(linkLines(storage.out).filter((l) => l.includes("depends_on") && !l.includes("held"))).toEqual([]);
  await m.ok("accept", "use-sqlite", "--actor", "you");
  const live = await m.ok("show", "use-sqlite");
  expect(linkLines(live.out).find((l) => l.includes("depends_on") && l.includes("storage"))).not.toContain("held");
  expect(m.events().filter((e) => e.type === "edge.added" && e.payload.from === "use-sqlite").length).toBe(1);
});

test("63.2 accepting a ghost child accepts its ghost parent, but not a ghost it depends on", async () => {
  const m = mapProject();
  m.seed("node.added", { id: "platform", kind: "card", title: "Platform" });
  await m.ok("add", "auth", "--title", "Auth", "--parent", "platform");
  await m.ok("add", "magic-links", "--title", "Magic links", "--parent", "auth");
  await m.ok("add", "email-service", "--title", "Email service", "--parent", "platform");
  await m.ok("link", "magic-links", "email-service", "--type", "depends_on", "--why", "a magic link is sent by email");
  await m.ok("accept", "magic-links", "--actor", "you");

  expect(isGhost((await m.ok("show", "magic-links")).out)).toBe(false);
  const auth = await m.ok("show", "auth");
  expect(isGhost(auth.out)).toBe(false);
  expect(auth.out).toContain("parent: platform  Platform");
  expect(isGhost((await m.ok("show", "email-service")).out)).toBe(true);
  const ml = await m.ok("show", "magic-links");
  expect(linkLines(ml.out).find((l) => l.includes("depends_on") && l.includes("email-service"))).toContain("held");
});

test("63.3 an accept takes the card's own ghost options and sources with it", async () => {
  const m = mapProject();
  m.seed("node.added", { id: "storage", kind: "card", title: "Storage", status: "decided" });
  const runs = [
    await m.w("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage"),
    await m.w(
      "add",
      "use-sqlite:opt0",
      "--kind",
      "option",
      "--title",
      "Use Postgres",
      "--why_not",
      "it needs a server",
    ),
    await m.w("link", "use-sqlite:opt0", "use-sqlite", "--type", "alternative_to"),
    await m.w(
      "add",
      "benchmark-notes",
      "--kind",
      "source",
      "--title",
      "Benchmark notes",
      "--finding",
      "SQLite is fast enough",
    ),
    await m.w("link", "use-sqlite", "benchmark-notes", "--type", "supported_by"),
  ];
  for (const run of runs) expect(run.code).toBe(0);
  const who = await m.w("edit", "use-sqlite", "--who", "you");
  // The contract of a decided card also needs a kill criterion; the binder supplies it.
  await m.ok("kill", "use-sqlite", "--revisit");
  const status = await m.w("status", "use-sqlite", "decided");
  expect(who.code).toBe(0);
  expect(status.err).toBe("");
  expect(status.code).toBe(0);

  await m.ok("accept", "use-sqlite", "--actor", "you");
  const card = await m.ok("show", "use-sqlite");
  expect(head(card.out)).toContain("[decided]");
  expect(isGhost(card.out)).toBe(false);
  expect(card.out).toContain("who: you");
  const opt = await m.ok("show", "use-sqlite:opt0");
  expect(isGhost(opt.out)).toBe(false);
  expect(opt.out).toContain("why not: it needs a server");
  const src = await m.ok("show", "benchmark-notes");
  expect(isGhost(src.out)).toBe(false);
  expect(linkLines(src.out).find((l) => l.includes("supported_by") && l.includes("use-sqlite"))).not.toContain("held");
});

test("63.4 discarding a ghost parent discards its whole ghost branch", async () => {
  const m = mapProject();
  m.seed("node.added", { id: "platform", kind: "card", title: "Platform" });
  await m.ok("add", "auth", "--title", "Auth", "--parent", "platform");
  await m.ok("add", "magic-links", "--title", "Magic links", "--parent", "auth");
  await m.ok("add", "magic-links:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "they leak");
  await m.ok("link", "magic-links:opt0", "magic-links", "--type", "alternative_to");
  await m.ok("discard", "auth");

  for (const id of ["auth", "magic-links", "magic-links:opt0"]) {
    const run = await m.w("show", id);
    expect(run.code).not.toBe(0);
  }
  const platform = await m.ok("show", "platform");
  expect(isGhost(platform.out)).toBe(false);
  expect(platform.out).not.toContain("Auth");
  expect(platform.out).not.toContain("ghost");
  const search = await m.ok("search", "magic");
  expect(search.out).not.toContain("magic-links");
  const find = await m.ok("find");
  expect(find.out).not.toContain("auth");
  expect(find.out).not.toContain("Passwords");
});

test("63.5 a ghost changes no count of a real card until it is accepted", async () => {
  const m = mapProject();
  m.seed("node.added", { id: "storage", kind: "card", title: "Storage", status: "decided" });
  m.seed("node.added", {
    id: "file-format",
    kind: "card",
    title: "File format",
    status: "decided",
    who: "you",
    unchallenged: "one format was ever on the table",
    parent: "storage",
  });
  const rollup = (out: string) => out.split("\n").find((l) => l.startsWith("subtree:")) ?? "";
  const first = await m.ok("show", "storage");
  const before = rollup(first.out);
  expect(before).toContain("unchallenged");
  expect(head(first.out)).not.toContain("stale");

  await m.ok("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  await m.ok("add", "use-sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "a server");
  await m.ok("link", "use-sqlite:opt0", "use-sqlite", "--type", "alternative_to");
  await m.ok("edit", "use-sqlite", "--who", "you");
  await m.ok("edit", "use-sqlite", "--unchallenged", "the option above was weighed");
  await m.ok("kill", "use-sqlite", "--revisit");
  await m.ok("status", "use-sqlite", "decided");

  const mid = await m.ok("show", "storage");
  expect(rollup(mid.out)).toBe(before);
  expect(head(mid.out)).not.toContain("stale");

  await m.ok("accept", "use-sqlite", "--actor", "you");
  const after = await m.ok("show", "storage");
  expect(rollup(after.out)).toContain("3 cards");
  expect(linkLines(after.out).find((l) => l.includes("use-sqlite"))).toContain("1 card");
});

// Held-out tests for steps 04.x, 62.x and 63.x: ghosts, accept, discard, frozen words.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
const events = (p: Project) => lines(p).map((l) => JSON.parse(l));

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

/** A real card: proposed, then accepted with the person's claim. */
async function real(p: Project, id: string, title: string, parent?: string) {
  await ok(p, ["add", id, "--title", title, ...(parent ? ["--parent", parent] : [])]);
  await ok(p, ["accept", id, "--actor", "you"]);
}

const header = (out: string) => out.split("\n")[0] as string;
const isGhostShow = (out: string) => / {2}proposed( |$)/.test(header(out));

test("04.1 An agent's new card waits as a ghost until the person accepts it", async () => {
  const p = freshProject();
  await real(p, "checkout", "Checkout flow");
  // A second, unrelated ghost, to check that it stays a ghost.
  await ok(p, ["add", "other", "--title", "Other ghost", "--parent", "checkout"]);
  const before = lines(p).length;
  const add = await ok(p, ["add", "retry", "--title", "Retry payment", "--parent", "checkout"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = events(p);
  expect(after.length).toBe(before + 1);
  expect(after.at(-1)).toMatchObject({ type: "node.proposed", payload: { id: "retry", parent: "checkout" } });
  const show = await ok(p, ["show", "retry"]);
  expect(isGhostShow(show.out)).toBe(true);
  expect(show.out).toContain("parent: checkout  Checkout flow");

  const n = lines(p).length;
  await ok(p, ["accept", "retry", "--actor", "you"]);
  const acc = events(p);
  expect(acc.length).toBe(n + 1);
  expect(acc.at(-1)).toMatchObject({ type: "change.accepted", payload: { id: "retry" } });
  const shown = await ok(p, ["show", "retry"]);
  expect(isGhostShow(shown.out)).toBe(false);
  expect(shown.out).toContain("parent: checkout  Checkout flow");
  expect(isGhostShow((await ok(p, ["show", "other"])).out)).toBe(true);
});

test("04.2 Accepting a ghost child also accepts its ghost parent, and its held link goes live", async () => {
  const p = freshProject();
  await real(p, "payments", "Payments");
  await real(p, "fraud", "Fraud rules", "payments");
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial", "fraud", "--type", "depends_on", "--why", "partial refunds obey the fraud limits"]);
  await ok(p, ["add", "partial:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "too strict"]);
  await ok(p, ["link", "partial:opt0", "partial", "--type", "alternative_to"]);
  await ok(p, ["add", "survey", "--kind", "source", "--title", "Refund survey", "--finding", "many ask"]);
  await ok(p, ["link", "partial", "survey", "--type", "supported_by"]);
  const held = await ok(p, ["show", "partial"]);
  const depLine = held.out.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud")) ?? "";
  expect(depLine).toContain("held");

  const n = lines(p).length;
  await ok(p, ["accept", "partial", "--actor", "you"]);
  const added = events(p).slice(n);
  expect(added.length).toBeGreaterThan(0);
  for (const e of added) expect(e.type).toBe("change.accepted");
  expect(isGhostShow((await ok(p, ["show", "refunds"])).out)).toBe(false);
  const shown = await ok(p, ["show", "partial"]);
  expect(isGhostShow(shown.out)).toBe(false);
  expect(isGhostShow((await ok(p, ["show", "partial:opt0"])).out)).toBe(false);
  expect(isGhostShow((await ok(p, ["show", "survey"])).out)).toBe(false);
  const live = shown.out.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud")) ?? "";
  expect(live).not.toBe("");
  expect(live).not.toContain("held");
});

test("04.3 Discarding a ghost parent drops its ghost children", async () => {
  const p = freshProject();
  await real(p, "onboarding", "Onboarding");
  await ok(p, ["add", "email", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend", "--title", "Resend email", "--parent", "email"]);
  await ok(p, ["discard", "email"]);
  for (const id of ["email", "resend"]) {
    const run = await p.werk(["show", id]);
    expect(run.code).not.toBe(0);
    expect(`${run.out}${run.err}`).toMatch(/not in the map|no node|not found|unknown/i);
  }
  const on = await ok(p, ["show", "onboarding"]);
  expect(on.out).not.toContain("ghost");
  expect(on.out).not.toContain("email");
  expect(on.out).not.toContain("resend");
});

test("04.4 The words of a ghost are frozen", async () => {
  const p = freshProject();
  await real(p, "search", "Search");
  await ok(p, ["add", "index", "--title", "Search index", "--why", "fast lookup", "--parent", "search"]);
  const before = lines(p);
  const run = await p.werk(["add", "index", "--title", "Another index", "--why", "other words", "--parent", "search"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toMatch(/ghost's words are frozen/);
  expect(lines(p)).toEqual(before);
  const show = await ok(p, ["show", "index"]);
  expect(show.out).toContain("Search index");
  expect(show.out).toContain("why: fast lookup");
});

test("04.5 An accept from the command line needs the statement that the person asked for it", async () => {
  const p = freshProject();
  await real(p, "ops", "Operations");
  await ok(p, ["add", "audit", "--title", "Audit log", "--parent", "ops"]);
  const before = lines(p);
  const run = await p.werk(["accept", "audit"]);
  expect(run.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect(isGhostShow((await ok(p, ["show", "audit"])).out)).toBe(true);
  const yes = await p.werk(["accept", "audit", "--actor", "you"]);
  expect(yes.code).toBe(0);
  expect(isGhostShow((await ok(p, ["show", "audit"])).out)).toBe(false);
});

test("62.1 An agent proposes a card and a person accepts it into the map", async () => {
  const p = freshProject();
  await real(p, "root", "Root");
  await ok(p, ["add", "seed", "--title", "Seed", "--parent", "root"]);
  const before = lines(p);
  expect(before.length).toBeGreaterThan(0);
  const add = await ok(p, [
    "add",
    "log",
    "--title",
    "Use a log",
    "--body",
    "One file per map.",
    "--why",
    "Replay is cheap",
  ]);
  expect(add.out).toContain("proposed");
  const mid = lines(p);
  expect(mid.length).toBe(before.length + 1);
  expect(mid.slice(0, before.length)).toEqual(before);
  const show = await ok(p, ["show", "log"]);
  expect(show.out).toContain("Use a log");
  expect(show.out).toContain("One file per map.");
  expect(show.out).toContain("Replay is cheap");
  expect(isGhostShow(show.out)).toBe(true);
  const acc = await p.werk(["accept", "log", "--actor", "you"]);
  expect(acc.code).toBe(0);
  const after = lines(p);
  expect(after.length).toBe(mid.length + 1);
  expect(after.slice(0, mid.length)).toEqual(mid);
  const shown = await ok(p, ["show", "log"]);
  expect(shown.out).toContain("Use a log");
  expect(shown.out).toContain("One file per map.");
  expect(shown.out).toContain("Replay is cheap");
  expect(isGhostShow(shown.out)).toBe(false);
});

test("62.2 An accept without the person's claim refuses and leaves the ghost waiting", async () => {
  const p = freshProject();
  await ok(p, ["add", "log", "--title", "Use a log"]);
  const before = lines(p);
  const run = await p.werk(["accept", "log"]);
  expect(run.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect(isGhostShow((await ok(p, ["show", "log"])).out)).toBe(true);
  await ok(p, ["accept", "log", "--actor", "you"]);
  expect(isGhostShow((await ok(p, ["show", "log"])).out)).toBe(false);
});

test("62.3 The words of a ghost are frozen (edit body, retitle, re-add)", async () => {
  const p = freshProject();
  await ok(p, ["add", "log", "--title", "Use a log"]);
  const before = lines(p);
  const body = await p.werk(["propose", "log", "--ops", JSON.stringify([{ tag: "new", new: "A new body." }])]);
  expect(body.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const retitle = await p.werk(["propose", "log", "--title", "Use an append-only log"]);
  expect(retitle.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const again = await p.werk(["add", "log", "--title", "Another title"]);
  expect(again.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const show = await ok(p, ["show", "log"]);
  expect(show.out.split("\n")[1]).toBe("Use a log");
  expect(isGhostShow(show.out)).toBe(true);
});

test("62.4 A retitle on a real card shows only the new title and keeps the old one in the log", async () => {
  const p = freshProject();
  await ok(p, ["add", "log", "--title", "Use a log"]);
  await ok(p, ["accept", "log", "--actor", "you"]);
  const before = lines(p);
  const retitle = await p.werk(["propose", "log", "--title", "Use an append-only log"]);
  expect(retitle.code).toBe(0);
  const after = lines(p);
  expect(after.length).toBe(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const show = await ok(p, ["show", "log"]);
  expect(show.out).toContain("Use an append-only log");
  expect(readFileSync(logOf(p), "utf8")).toContain('"title":"Use a log"');
  const editBody = await p.werk(["propose", "log", "--ops", JSON.stringify([{ tag: "new", new: "A new body." }])]);
  expect(editBody.code).toBe(0);
  const shown = await ok(p, ["show", "log"]);
  // Checked last, so the earlier failures (if any) are visible first.
  expect(shown.out).toContain("A new body.");
  expect(shown.out).toContain("Use an append-only log");
  expect(show.out).not.toContain("Use a log\n");
  expect(show.out.replaceAll("Use an append-only log", "")).not.toContain("Use a log");
});

test("62.5 An option, a source and an excerpt also enter as ghosts", async () => {
  const p = freshProject();
  await real(p, "store", "Storage");
  mkdirSync(join(p.dir, ".werk", "chats"));
  writeFileSync(
    join(p.dir, ".werk", "chats", "talk.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "t1", session: "s1", kind: "spoken", text: "keep one log per map" })}\n`,
  );
  const runs: [string, string[]][] = [
    ["store:opt0", ["add", "store:opt0", "--kind", "option", "--title", "Use SQLite", "--why_not", "native build"]],
    ["bench", ["add", "bench", "--kind", "source", "--title", "Benchmark", "--finding", "fast enough"]],
    ["store:ex0", ["quote", "store", "talk", "one log per map"]],
  ];
  for (const [, args] of runs) {
    const n = lines(p);
    const run = await ok(p, args);
    expect(run.out).toContain("proposed");
    const after = lines(p);
    expect(after.length).toBe(n.length + 1);
    expect(after.slice(0, n.length)).toEqual(n);
  }
  const opt = await ok(p, ["show", "store:opt0"]);
  expect(opt.out).toContain("Use SQLite");
  expect(opt.out).toContain("native build");
  expect(isGhostShow(opt.out)).toBe(true);
  const src = await ok(p, ["show", "bench"]);
  expect(src.out).toContain("Benchmark");
  expect(src.out).toContain("fast enough");
  expect(isGhostShow(src.out)).toBe(true);
  const ex = await ok(p, ["show", "store:ex0"]);
  expect(ex.out).toContain("one log per map");
  expect(isGhostShow(ex.out)).toBe(true);

  await ok(p, ["accept", "store:opt0", "--actor", "you"]);
  const opt2 = await ok(p, ["show", "store:opt0"]);
  expect(isGhostShow(opt2.out)).toBe(false);
  expect(opt2.out).toContain("native build");
  expect(isGhostShow((await ok(p, ["show", "bench"])).out)).toBe(true);
  expect(isGhostShow((await ok(p, ["show", "store:ex0"])).out)).toBe(true);
});

const linkLine = (out: string, type: string, other: string) =>
  out.split("\n").find((l) => l.includes(type) && new RegExp(`\\b${other}\\b`).test(l)) ?? "";

test("63.1 A link to a ghost is held, and it goes live on accept with no extra link event", async () => {
  const p = freshProject();
  await real(p, "storage", "Storage");
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  await ok(p, ["link", "sqlite", "storage", "--type", "depends_on", "--why", "SQLite is the storage basis"]);
  const s1 = await ok(p, ["show", "sqlite"]);
  const held = linkLine(s1.out, "depends_on", "storage");
  // binder note: the link points at the card's own parent; the product may refuse that.
  expect(held).toContain("held");
  const st = await ok(p, ["show", "storage"]);
  const stLine = linkLine(st.out, "depends_on", "sqlite");
  expect(stLine === "" || stLine.includes("held")).toBe(true);
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const s2 = await ok(p, ["show", "sqlite"]);
  const live = linkLine(s2.out, "depends_on", "storage");
  expect(live).not.toBe("");
  expect(live).not.toContain("held");
  const linkEvents = events(p).filter(
    (e) => e.type.startsWith("link") && e.payload.from === "sqlite" && e.payload.to === "storage",
  );
  expect(linkEvents.length).toBe(1);
});

test("63.2 Accepting a ghost child accepts its ghost parent, but not a ghost it depends on", async () => {
  const p = freshProject();
  await real(p, "platform", "Platform");
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await ok(p, ["add", "email", "--title", "Email service", "--parent", "platform"]);
  await ok(p, ["link", "magic", "email", "--type", "depends_on", "--why", "magic links are sent by email"]);
  await ok(p, ["accept", "magic", "--actor", "you"]);
  expect(isGhostShow((await ok(p, ["show", "magic"])).out)).toBe(false);
  const auth = await ok(p, ["show", "auth"]);
  expect(isGhostShow(auth.out)).toBe(false);
  expect(auth.out).toContain("parent: platform  Platform");
  expect(isGhostShow((await ok(p, ["show", "email"])).out)).toBe(true);
  const dep = linkLine((await ok(p, ["show", "magic"])).out, "depends_on", "email");
  expect(dep).toContain("held");
});

test("63.3 An accept takes the card's own ghost options and sources with it", async () => {
  const p = freshProject();
  await real(p, "storage", "Storage");
  await ok(p, ["edit", "storage", "--who", "me", "--no-basis", "top of the tree", "--unchallenged", "only choice"]);
  await ok(p, ["kill", "storage", "--revisit"]);
  await ok(p, ["status", "storage", "decided"]);
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server"]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await ok(p, ["add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "fast"]);
  await ok(p, ["link", "sqlite", "bench", "--type", "supported_by"]);
  const who = await p.werk(["edit", "sqlite", "--who", "you"]);
  expect(who.code).toBe(0);
  await ok(p, ["kill", "sqlite", "--revisit"]);
  // A basis: the decided parent does not count as a depends_on basis, so link to a decided sibling.
  await real(p, "disk", "Disk budget", "storage");
  await ok(p, ["edit", "disk", "--who", "me", "--no-basis", "measured", "--unchallenged", "only choice"]);
  await ok(p, ["kill", "disk", "--revisit"]);
  await ok(p, ["status", "disk", "decided"]);
  await ok(p, ["link", "sqlite", "disk", "--type", "depends_on", "--why", "SQLite fits the disk budget"]);
  const status = await p.werk(["status", "sqlite", "decided"]);
  expect(status.err).toBe("");
  expect(status.code).toBe(0);
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const s = await ok(p, ["show", "sqlite"]);
  expect(isGhostShow(s.out)).toBe(false);
  expect(header(s.out)).toContain("[decided]");
  expect(s.out).toContain("who: you");
  const o = await ok(p, ["show", "sqlite:opt0"]);
  expect(isGhostShow(o.out)).toBe(false);
  expect(o.out).toContain("needs a server");
  const b = await ok(p, ["show", "bench"]);
  expect(isGhostShow(b.out)).toBe(false);
  const link = linkLine(s.out, "supported_by", "bench");
  expect(link).not.toBe("");
  expect(link).not.toContain("held");
});

test("63.4 Discarding a ghost parent discards its whole ghost branch", async () => {
  const p = freshProject();
  await real(p, "platform", "Platform");
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await ok(p, ["add", "magic:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "people forget them"]);
  await ok(p, ["link", "magic:opt0", "magic", "--type", "alternative_to"]);
  await ok(p, ["discard", "auth"]);
  for (const id of ["auth", "magic", "magic:opt0"]) {
    const run = await p.werk(["show", id]);
    expect(run.code).not.toBe(0);
  }
  const plat = await ok(p, ["show", "platform"]);
  expect(isGhostShow(plat.out)).toBe(false);
  expect(plat.out).not.toContain("ghost");
  expect(plat.out).not.toContain("Auth");
});

const subtree = (out: string) => out.split("\n").find((l) => l.startsWith("subtree:")) ?? "";

test("63.5 A ghost changes no count of a real card until it is accepted", async () => {
  const p = freshProject();
  await real(p, "storage", "Storage");
  await ok(p, ["edit", "storage", "--who", "me", "--no-basis", "top of the tree", "--unchallenged", "only choice"]);
  await ok(p, ["kill", "storage", "--revisit"]);
  await ok(p, ["status", "storage", "decided"]);
  await real(p, "disk", "Disk", "storage");
  await ok(p, ["edit", "disk", "--who", "me", "--no-basis", "measured", "--unchallenged", "only choice"]);
  await ok(p, ["kill", "disk", "--revisit"]);
  await ok(p, ["status", "disk", "decided"]);
  const before = await ok(p, ["show", "storage"]);
  const rollBefore = subtree(before.out);
  expect(rollBefore).toContain("2 cards");
  expect(header(before.out)).not.toMatch(/stale/);

  // A ghost decided card with a ghost option: add, link a basis, then decide through status.
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage", "--who", "you"]);
  await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server"]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await ok(p, ["link", "sqlite", "disk", "--type", "depends_on", "--why", "fits the disk"]);
  await ok(p, ["kill", "sqlite", "--revisit"]);
  await ok(p, ["status", "sqlite", "decided"]);
  const mid = await ok(p, ["show", "storage"]);
  expect(subtree(mid.out)).toBe(rollBefore);
  expect(header(mid.out)).not.toMatch(/stale/);

  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const after = await ok(p, ["show", "storage"]);
  expect(subtree(after.out)).toContain("3 cards");
});

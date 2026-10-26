// Held-out binder A: ghost proposal, accept, discard and frozen words.
import { expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

setDefaultTimeout(60_000);

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
const events = (p: Project) => lines(p).map((l) => JSON.parse(l));

function seed(p: Project, type: string, payload: Record<string, unknown>) {
  const seq = lines(p).length + 1;
  appendFileSync(logOf(p), `${JSON.stringify({ seq, at: "t", actor: "you", type, payload })}\n`);
}

/** A project with a real root card and the given real cards under it (or under a named parent). */
function project(cards: Record<string, unknown>[] = [], rootStatus = "open"): Project {
  const p = freshProject();
  seed(p, "node.added", { id: "root", kind: "card", title: "Root", status: rootStatus });
  for (const card of cards) seed(p, "node.added", { kind: "card", parent: "root", ...card });
  return p;
}

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

const header = (out: string) => out.split("\n")[0] as string;
const isGhost = (out: string) => /\bproposed\b/.test(header(out));

function withChat(p: Project) {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(p.dir, ".werk", "chats", "talk.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "t1", session: "s1", kind: "spoken", text: "we keep every change in one log file" })}\n`,
  );
}

test("04.1", async () => {
  const p = project([{ id: "checkout", title: "Checkout flow" }]);
  await ok(p, ["add", "other", "--title", "Other ghost", "--parent", "checkout"]);
  const before = lines(p);
  const add = await ok(p, [
    "add",
    "retry",
    "--title",
    "Retry payment",
    "--why",
    "A card fails often.",
    "--parent",
    "checkout",
  ]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = events(p);
  expect(after).toHaveLength(before.length + 1);
  expect(after.at(-1)).toMatchObject({ type: "node.proposed", payload: { id: "retry", parent: "checkout" } });
  const shown = await ok(p, ["show", "retry"]);
  expect(isGhost(shown.out)).toBe(true);
  expect(shown.out).toContain("parent: checkout  Checkout flow");
  const n = lines(p).length;
  await ok(p, ["accept", "retry", "--actor", "you"]);
  const acc = events(p);
  expect(acc).toHaveLength(n + 1);
  expect(acc.at(-1).type).toBe("change.accepted");
  const real = await ok(p, ["show", "retry"]);
  expect(isGhost(real.out)).toBe(false);
  expect(real.out).toContain("parent: checkout  Checkout flow");
  expect(isGhost((await ok(p, ["show", "other"])).out)).toBe(true);
});

test("04.2", async () => {
  const p = project([
    { id: "payments", title: "Payments" },
    { id: "fraud", title: "Fraud rules" },
  ]);
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial", "fraud", "--type", "depends_on", "--why", "a partial refund passes the fraud rules"]);
  await ok(p, ["add", "partial:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "too coarse"]);
  await ok(p, ["link", "partial:opt0", "partial", "--type", "alternative_to"]);
  await ok(p, [
    "add",
    "bench",
    "--kind",
    "source",
    "--title",
    "Refund study",
    "--url",
    "https://example.invalid",
    "--finding",
    "most refunds are partial",
  ]);
  await ok(p, ["link", "partial", "bench", "--type", "supported_by"]);
  const held = await ok(p, ["show", "partial"]);
  const depLine = (out: string) => out.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud")) ?? "";
  expect(depLine(held.out)).toContain("(held)");
  const n = lines(p).length;
  await ok(p, ["accept", "partial", "--actor", "you"]);
  const added = events(p).slice(n);
  expect(added.length).toBeGreaterThan(0);
  for (const e of added) expect(e.type).toBe("change.accepted");
  expect(isGhost((await ok(p, ["show", "refunds"])).out)).toBe(false);
  const after = await ok(p, ["show", "partial"]);
  expect(isGhost(after.out)).toBe(false);
  expect(isGhost((await ok(p, ["show", "partial:opt0"])).out)).toBe(false);
  expect(isGhost((await ok(p, ["show", "bench"])).out)).toBe(false);
  expect(depLine(after.out)).not.toBe("");
  expect(depLine(after.out)).not.toContain("held");
});

test("04.3", async () => {
  const p = project([{ id: "onboarding", title: "Onboarding" }]);
  await ok(p, ["add", "email", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend", "--title", "Resend email", "--parent", "email"]);
  await ok(p, ["discard", "email"]);
  for (const id of ["email", "resend"]) {
    const run = await p.werk(["show", id]);
    expect(run.code).not.toBe(0);
    expect(run.err).toContain(`no node #${id} in the map`);
  }
  const shown = await ok(p, ["show", "onboarding"]);
  expect(shown.out).not.toContain("ghost");
  expect(shown.out).not.toContain("email");
});

test("04.4", async () => {
  const p = project([{ id: "search", title: "Search" }]);
  await ok(p, ["add", "index", "--title", "Search index", "--why", "Queries must be fast.", "--parent", "search"]);
  const before = lines(p);
  const again = await p.werk([
    "add",
    "index",
    "--title",
    "Search index v2",
    "--why",
    "Other words.",
    "--parent",
    "search",
  ]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("a ghost's words are frozen");
  expect(lines(p)).toEqual(before);
  const shown = await ok(p, ["show", "index"]);
  expect(shown.out).toContain("Search index\n");
  expect(shown.out).toContain("why: Queries must be fast.");
  expect(shown.out).not.toContain("v2");
  expect(shown.out).not.toContain("Other words.");
});

test("04.5", async () => {
  const p = project([{ id: "admin", title: "Admin" }]);
  await ok(p, ["add", "audit", "--title", "Audit log", "--parent", "admin"]);
  const before = lines(p);
  const refused = await p.werk(["accept", "audit"]);
  expect(refused.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect(isGhost((await ok(p, ["show", "audit"])).out)).toBe(true);
  const run = await p.werk(["accept", "audit", "--actor", "you"]);
  expect(run.code).toBe(0);
  expect(isGhost((await ok(p, ["show", "audit"])).out)).toBe(false);
});

test("06.1", async () => {
  const p = project(
    [{ id: "store", title: "Keep one log", status: "decided", who: "you", body: "The body." }],
    "decided",
  );
  withChat(p);
  const cardBefore = await ok(p, ["show", "store"]);
  const run = await ok(p, ["quote", "store", "talk", "every change in one log"]);
  expect(run.out).toContain("proposed");
  expect(run.out).not.toContain("added");
  const id = "store:ex0";
  const ex = await ok(p, ["show", id]);
  expect(isGhost(ex.out)).toBe(true);
  const cardAfter = await ok(p, ["show", "store"]);
  const exLine = cardAfter.out.split("\n").find((l) => l.includes("supported_by") && l.includes(id)) ?? "";
  expect(exLine).toContain("held");
  expect(header(cardAfter.out)).toBe(header(cardBefore.out));
  expect(header(cardAfter.out)).toContain("[decided]");
  expect(cardAfter.out).toContain("Keep one log");
  expect(cardAfter.out).toContain("The body.");
});

test("62.1", async () => {
  const p = project([{ id: "a0", title: "Earlier card" }]);
  await ok(p, ["add", "g0", "--title", "Earlier ghost"]);
  const before = lines(p);
  const add = await ok(p, [
    "add",
    "log",
    "--title",
    "Use a log",
    "--body",
    "The log is a file.",
    "--why",
    "Every change is kept.",
  ]);
  expect(add.out).toContain("proposed");
  const after = lines(p);
  expect(after).toHaveLength(before.length + 1);
  expect(after.slice(0, -1)).toEqual(before);
  const shown = await ok(p, ["show", "log"]);
  for (const s of ["Use a log", "The log is a file.", "Every change is kept."]) expect(shown.out).toContain(s);
  expect(isGhost(shown.out)).toBe(true);
  const acc = await p.werk(["accept", "log", "--actor", "you"]);
  expect(acc.code).toBe(0);
  const after2 = lines(p);
  expect(after2).toHaveLength(after.length + 1);
  expect(after2.slice(0, -1)).toEqual(after);
  const real = await ok(p, ["show", "log"]);
  for (const s of ["Use a log", "The log is a file.", "Every change is kept."]) expect(real.out).toContain(s);
  expect(isGhost(real.out)).toBe(false);
  expect(real.out).not.toContain("ghost");
});

test("62.2", async () => {
  const p = project();
  await ok(p, ["add", "log", "--title", "Use a log"]);
  const before = lines(p);
  const refused = await p.werk(["accept", "log"]);
  expect(refused.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect(isGhost((await ok(p, ["show", "log"])).out)).toBe(true);
  await ok(p, ["accept", "log", "--actor", "you"]);
  expect(isGhost((await ok(p, ["show", "log"])).out)).toBe(false);
});

test("62.3", async () => {
  const p = project();
  await ok(p, ["add", "log", "--title", "Use a log"]);
  const before = lines(p);
  const edit = await p.werk(["edit", "log", "--body", "New body"]);
  expect(edit.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const retitle = await p.werk(["retitle", "log", "Use an append-only log"]);
  expect(retitle.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const again = await p.werk(["add", "log", "--title", "Use a database"]);
  expect(again.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const shown = await ok(p, ["show", "log"]);
  expect(shown.out).toContain("Use a log");
  expect(isGhost(shown.out)).toBe(true);
});

test("62.4", async () => {
  const p = project();
  await ok(p, ["add", "log", "--title", "Use a log"]);
  await ok(p, ["accept", "log", "--actor", "you"]);
  const before = lines(p);
  const run = await p.werk(["retitle", "log", "Use an append-only log"]);
  expect(run.code).toBe(0);
  const after = lines(p);
  expect(after).toHaveLength(before.length + 1);
  expect(after.slice(0, -1)).toEqual(before);
  const shown = await ok(p, ["show", "log"]);
  expect(shown.out).toContain("Use an append-only log");
  expect(shown.out).not.toContain("Use a log");
  expect(before.some((l) => l.includes('"title":"Use a log"'))).toBe(true);
  expect(readFileSync(logOf(p), "utf8")).toContain('"title":"Use a log"');
  await ok(p, ["edit", "log", "--body", "Appends only."]);
  const edited = await ok(p, ["show", "log"]);
  expect(edited.out).toContain("Appends only.");
  expect(edited.out).toContain("Use an append-only log");
});

test("62.5", async () => {
  const p = project([{ id: "store", title: "Keep one log" }]);
  withChat(p);
  const steps: [string[], string, string[]][] = [
    [
      [
        "add",
        "store:opt0",
        "--kind",
        "option",
        "--title",
        "Use a database",
        "--why_not",
        "a database hides history",
      ],
      "store:opt0",
      ["Use a database", "a database hides history"],
    ],
    [
      [
        "add",
        "paper",
        "--kind",
        "source",
        "--title",
        "Log paper",
        "--url",
        "https://example.invalid/log",
        "--finding",
        "logs keep history",
      ],
      "paper",
      ["Log paper", "https://example.invalid/log", "logs keep history"],
    ],
    [
      ["quote", "store", "talk", "every change in one log"],
      "store:ex0",
      ["every change in one log", "conversation: talk"],
    ],
  ];
  for (const [args, id, fields] of steps) {
    const before = lines(p);
    const run = await ok(p, args);
    expect(run.out).toContain("proposed");
    const after = lines(p);
    expect(after).toHaveLength(before.length + 1);
    expect(after.slice(0, -1)).toEqual(before);
    const shown = await ok(p, ["show", id]);
    for (const f of fields) expect(shown.out).toContain(f);
    expect(isGhost(shown.out)).toBe(true);
    // An option sits under its card through its alternative_to link, a command of its own.
    if (id === "store:opt0") await ok(p, ["link", "store:opt0", "store", "--type", "alternative_to"]);
  }
  await ok(p, ["accept", "store:opt0", "--actor", "you"]);
  const opt = await ok(p, ["show", "store:opt0"]);
  expect(isGhost(opt.out)).toBe(false);
  expect(opt.out).toContain("why not: a database hides history");
  expect(isGhost((await ok(p, ["show", "paper"])).out)).toBe(true);
  expect(isGhost((await ok(p, ["show", "store:ex0"])).out)).toBe(true);
});

test("63.1", async () => {
  const p = project([{ id: "storage", title: "Storage" }]);
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  await ok(p, ["link", "sqlite", "storage", "--type", "depends_on", "--why", "SQLite is the storage"]);
  const line = (out: string) =>
    out.split("\n").find((l) => l.includes("depends_on") && (l.includes("storage") || l.includes("sqlite"))) ?? "";
  expect(line((await ok(p, ["show", "sqlite"])).out)).toContain("held");
  const st = (await ok(p, ["show", "storage"])).out
    .split("\n")
    .filter((l) => l.includes("depends_on") && l.includes("sqlite"));
  for (const l of st) expect(l).toContain("held");
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const live = line((await ok(p, ["show", "sqlite"])).out);
  expect(live).not.toBe("");
  expect(live).not.toContain("held");
  const links = events(p).filter(
    (e) => e.type === "link.added" && e.payload.from === "sqlite" && e.payload.to === "storage",
  );
  expect(links).toHaveLength(1);
});

test("63.2", async () => {
  const p = project([{ id: "platform", title: "Platform" }]);
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await ok(p, ["add", "email", "--title", "Email service", "--parent", "platform"]);
  await ok(p, ["link", "magic", "email", "--type", "depends_on", "--why", "magic links send mail"]);
  await ok(p, ["accept", "magic", "--actor", "you"]);
  expect(isGhost((await ok(p, ["show", "magic"])).out)).toBe(false);
  const auth = await ok(p, ["show", "auth"]);
  expect(isGhost(auth.out)).toBe(false);
  expect(auth.out).toContain("parent: platform  Platform");
  expect(isGhost((await ok(p, ["show", "email"])).out)).toBe(true);
  const dep =
    (await ok(p, ["show", "magic"])).out.split("\n").find((l) => l.includes("depends_on") && l.includes("email")) ?? "";
  expect(dep).toContain("held");
});

test("63.3", async () => {
  // Storage is decided, so the basis part of the decide contract can hold.
  const p = project([{ id: "storage", title: "Storage", status: "decided", who: "you" }], "decided");
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  await ok(p, [
    "add",
    "sqlite:opt0",
    "--kind",
    "option",
    "--title",
    "Use Postgres",
    "--why_not",
    "a server is too much",
  ]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await ok(p, [
    "add",
    "bench",
    "--kind",
    "source",
    "--title",
    "Benchmark notes",
    "--url",
    "https://example.invalid/b",
    "--finding",
    "SQLite is fast enough",
  ]);
  await ok(p, ["link", "sqlite", "bench", "--type", "supported_by"]);
  // The rest of the decide contract, so the status change can pass its check.
  await ok(p, ["edit", "sqlite", "--no-basis", "nothing decided feeds this choice"]);
  await ok(p, ["kill", "sqlite", "--revisit"]);
  const who = await p.werk(["edit", "sqlite", "--who", "me"]);
  const status = await p.werk(["status", "sqlite", "decided"]);
  expect(who.code, who.err).toBe(0);
  expect(status.code, status.err).toBe(0);
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const card = await ok(p, ["show", "sqlite"]);
  expect(isGhost(card.out)).toBe(false);
  expect(header(card.out)).toContain("[decided]");
  expect(card.out).toContain("who: me");
  const opt = await ok(p, ["show", "sqlite:opt0"]);
  expect(isGhost(opt.out)).toBe(false);
  expect(opt.out).toContain("why not: a server is too much");
  const src = await ok(p, ["show", "bench"]);
  expect(isGhost(src.out)).toBe(false);
  const sup = card.out.split("\n").find((l) => l.includes("supported_by") && l.includes("bench")) ?? "";
  expect(sup).not.toBe("");
  expect(sup).not.toContain("held");
});

test("63.4", async () => {
  const p = project([{ id: "platform", title: "Platform" }]);
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await ok(p, ["add", "magic:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "people forget them"]);
  await ok(p, ["link", "magic:opt0", "magic", "--type", "alternative_to"]);
  await ok(p, ["discard", "auth"]);
  for (const id of ["auth", "magic", "magic:opt0"]) {
    const run = await p.werk(["show", id]);
    expect(run.code, id).not.toBe(0);
  }
  const plat = await ok(p, ["show", "platform"]);
  expect(isGhost(plat.out)).toBe(false);
  expect(plat.out).not.toContain("ghost");
  for (const t of ["Auth", "Magic links", "Passwords"]) expect(plat.out).not.toContain(t);
  const root = await ok(p, ["show", "root"]);
  for (const t of ["Auth", "Magic links", "Passwords"]) expect(root.out).not.toContain(t);
});

test("63.5", async () => {
  const p = project(
    [{ id: "storage", title: "Storage", status: "decided", who: "you", no_basis: "x", unchallenged: "y" }],
    "decided",
  );
  seed(p, "node.added", {
    id: "files",
    kind: "card",
    title: "Flat files",
    parent: "storage",
    status: "decided",
    who: "you",
    no_basis: "x",
    unchallenged: "y",
  });
  const subtree = (out: string) => out.split("\n").find((l) => l.startsWith("subtree:")) ?? "";
  const s0 = await ok(p, ["show", "storage"]);
  expect(header(s0.out)).not.toMatch(/stale/i);
  expect(s0.out).not.toMatch(/STALE/);
  const before = subtree(s0.out);
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "too heavy"]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await ok(p, ["edit", "sqlite", "--who", "you"]);
  await ok(p, ["edit", "sqlite", "--no-basis", "nothing feeds it"]);
  await ok(p, ["kill", "sqlite", "--revisit"]);
  await ok(p, ["status", "sqlite", "decided"]);
  const s1 = await ok(p, ["show", "storage"]);
  expect(subtree(s1.out)).toBe(before);
  expect(header(s1.out)).toBe(header(s0.out));
  expect(s1.out).not.toMatch(/STALE/);
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const s2 = await ok(p, ["show", "storage"]);
  expect(subtree(s2.out)).not.toBe(before);
  const n = (s: string) => Number(/(\d+) cards?/.exec(s)?.[1]);
  expect(n(subtree(s2.out))).toBe(n(before) + 1);
});

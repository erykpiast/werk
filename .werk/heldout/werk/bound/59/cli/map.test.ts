import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../../src/test-env/project.ts";
import { appendLines, decided, ghost, makeProject, real, werkIn, writeLines } from "./helpers.ts";

let project: Project;
let werk: ReturnType<typeof werkIn>;
beforeEach(() => {
  project = makeProject();
  werk = werkIn(project);
});
afterEach(() => project.dispose());
const events = () => project.events();
const seed = (...evs: unknown[]) => writeLines(project.logPath, evs.flat());
const lines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");

// ---------- 05 ----------
test("05.1 an agent proposes a card under a parent and reads it back", async () => {
  seed(decided("auth"));
  const before = events().length;
  const added = await werk("add", "login", "--title", "Use magic links", "--parent", "auth");
  expect(added.stdout.trim()).toBe("proposed");
  expect(events().length).toBe(before + 1);
  const shown = await werk("show", "login");
  expect(shown.stdout).toContain("Use magic links");
  expect(shown.stdout).toContain("proposed");
  expect(shown.stdout).toContain("auth");
  expect(shown.stdout).toMatch(/rollup:/);
});

test("05.2 a second add with the same id is refused and the log stays as it was", async () => {
  await werk("add", "login", "--title", "First words");
  const n = events().length;
  const again = await werk("add", "login", "--title", "Other words");
  expect(again.code).not.toBe(0);
  expect(again.stderr).toContain("duplicate-id");
  expect(events().length).toBe(n);
  expect((await werk("show", "login")).stdout).toContain("First words");
});

test("05.3 a decided status is refused on add", async () => {
  seed(decided("auth"));
  const n = events().length;
  const r = await werk("add", "pay", "--title", "Pay", "--parent", "auth", "--status", "decided");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/decided/);
  expect(events().length).toBe(n);
  const shown = await werk("show", "pay");
  expect(shown.stderr + shown.stdout).toMatch(/unknown card|not found/i);
});

test("05.4 a hash on an id is optional, a title keeps its hash", async () => {
  await werk("add", "auth", "--title", "Auth");
  const added = await werk("add", "#login", "--title", "#1 priority: magic links", "--parent", "#auth");
  expect(added.stdout.trim()).toBe("proposed");
  const a = await werk("show", "#login");
  const b = await werk("show", "login");
  expect(a.stdout).toBe(b.stdout);
  expect(a.stdout).toContain("#1 priority: magic links");
  expect(a.stdout).toMatch(/-> refines\s+auth\b/);
});

test("05.5 a hand-written bad line is listed as a problem and later cards still show", async () => {
  await werk("add", "auth", "--title", "Auth");
  appendLines(project.logPath, [
    { type: "node.proposed", id: "orphan", kind: "card", title: "Orphan", status: "open", parent: "nowhere" },
  ]);
  await werk("add", "login", "--title", "Login");
  const shown = await werk("show", "login");
  expect(shown.stdout).toContain("proposed");
  expect(shown.stdout).toContain("Login");
  // the problems of the map: any verb that reads the map lists them with the log line
  expect(shown.stderr).toMatch(/log line 2/);
  expect(shown.stderr).toContain("unknown-card");
  expect(readFileSync(project.logPath, "utf8")).toContain('"parent":"nowhere"');
});

// ---------- 06 ----------
const chatLog = (name: string, text: string) => {
  const dir = join(project.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.jsonl`),
    `${JSON.stringify({ speaker: "person", at: "10:02", session: "s1", kind: "spoken", text })}\n`,
  );
};

test("06.1 a new excerpt stages as a ghost and waits for the check", async () => {
  seed(decided("card", { title: "Card title", why: "Card why" }));
  chatLog("talk", "we want seat pricing");
  const before = await werk("show", "card");
  const q = await werk("quote", "card", "talk", "seat pricing");
  expect(q.stdout).toContain("proposed");
  expect(q.stdout).not.toMatch(/\badded\b/);
  const shown = await werk("show", "card");
  expect(shown.stdout).toContain("Say:");
  expect(shown.stdout).toMatch(/seat pricing\s+proposed/);
  const ex = await werk("show", "card:ex0");
  expect(ex.stdout).toContain("proposed");
  // the card keeps status and words
  expect(shown.stdout).toContain("[decided]");
  expect(shown.stdout).toContain("Card title");
  expect(shown.stdout).toContain("why: Card why");
  expect(before.stdout).toContain("[decided]");
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
  seed(decided("card"));
  chatLog("talk", "we want seat pricing");
  await werk("quote", "card", "talk", "seat pricing");
  const acc = await werk("accept", "card:ex0", "--actor", "you");
  expect(acc.code).toBe(0);
  const ex = await werk("show", "card:ex0");
  expect(ex.stdout).not.toMatch(/\n?.*\bproposed\b.*/);
  const shown = await werk("show", "card");
  expect(shown.stdout).toContain("Say:");
  expect(shown.stdout).toContain("person: seat pricing");
  expect(shown.stdout).not.toMatch(/seat pricing\s+proposed/);
  // no second accept was needed for the link: exactly one accept event was written
  expect(events().filter((e: any) => e.type === "node.accepted" && e.id === "card:ex0")).toHaveLength(1);
});

// ---------- 08 ----------
const removalTree = () =>
  seed(
    decided("auth"),
    real("login", { parent: "auth" }),
    real("session", { parent: "auth" }),
    decided("audit"),
    { type: "edge.added", from: "login", to: "audit", link: "depends_on", why: "login audits" },
  );

test("08.1 remove takes the subtree out in one step and restore brings everything back", async () => {
  removalTree();
  const n = events().length;
  const rm = await werk("remove", "auth", "--actor", "you");
  expect(rm.code).toBe(0);
  expect(events().length).toBe(n + 1);
  expect((events().at(-1) as any).type).toBe("node.removed");
  for (const id of ["auth", "login", "session"]) {
    expect((await werk("show", id)).code).toBe(1);
  }
  const removed = await werk("removed");
  expect(removed.stdout).toMatch(/auth \(with .*login.*\)/);
  expect(removed.stdout).toContain("session");
  const audit = await werk("show", "audit");
  expect(audit.stdout).not.toContain("login");
  const rs = await werk("restore", "auth", "--actor", "you");
  expect(rs.code).toBe(0);
  const auth = await werk("show", "auth");
  expect(auth.stdout).toMatch(/<- refines\s+login/);
  expect(auth.stdout).toMatch(/<- refines\s+session/);
  expect((await werk("show", "audit")).stdout).toMatch(/<- depends_on\s+login/);
  expect((await werk("removed")).stdout.trim()).toBe("nothing is removed");
});

test("08.2 remove with reparent moves children up, restore puts them back", async () => {
  seed(
    decided("platform"),
    real("auth", { parent: "platform" }),
    real("login", { parent: "auth" }),
    real("session", { parent: "auth" }),
  );
  expect((await werk("remove", "auth", "--actor", "you", "--reparent")).code).toBe(0);
  expect((await werk("show", "auth")).code).toBe(1);
  const platform = await werk("show", "platform");
  expect(platform.stdout).toMatch(/<- refines\s+login/);
  expect(platform.stdout).toMatch(/<- refines\s+session/);
  expect((await werk("restore", "auth", "--actor", "you")).code).toBe(0);
  const p2 = await werk("show", "platform");
  expect(p2.stdout).toMatch(/<- refines\s+auth/);
  expect(p2.stdout).not.toMatch(/<- refines\s+login/);
  expect(p2.stdout).not.toMatch(/<- refines\s+session/);
  const auth = await werk("show", "auth");
  expect(auth.stdout).toMatch(/<- refines\s+login/);
  expect(auth.stdout).toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both of its ends are back", async () => {
  seed(
    decided("root"),
    real("b1", { parent: "root" }),
    real("b2", { parent: "root" }),
    real("login", { parent: "b1" }),
    real("session", { parent: "b2" }),
    { type: "edge.added", from: "login", to: "session", link: "depends_on", why: "needs session" },
  );
  await werk("remove", "login", "--actor", "you");
  await werk("remove", "session", "--actor", "you");
  await werk("restore", "login", "--actor", "you");
  const l = await werk("show", "login");
  expect(l.code).toBe(0);
  expect(l.stdout).not.toMatch(/depends_on/);
  await werk("restore", "session", "--actor", "you");
  expect((await werk("show", "login")).stdout).toMatch(/-> depends_on\s+session/);
  expect((await werk("show", "session")).stdout).toMatch(/<- depends_on\s+login/);
});

test("08.4 a removed card id stays taken, and a cited source stays", async () => {
  seed(
    decided("root"),
    real("login", { parent: "root" }),
    real("billing", { parent: "root" }),
    real("rfc-6749", { kind: "source", title: "RFC 6749" }),
    { type: "edge.added", from: "login", to: "rfc-6749", link: "supported_by" },
    { type: "edge.added", from: "billing", to: "rfc-6749", link: "supported_by" },
  );
  expect((await werk("remove", "login", "--actor", "you")).code).toBe(0);
  const billing = await werk("show", "billing");
  expect(billing.stdout).toContain("rfc-6749");
  expect((await werk("show", "rfc-6749")).code).toBe(0);
  const n = events().length;
  const add = await werk("add", "login", "--title", "New login");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toMatch(/restore/);
  expect(add.stderr).toContain("login");
  expect(events().length).toBe(n);
  expect((await werk("show", "login")).code).toBe(1);
});

test("08.5 remove refuses without the person's say-so", async () => {
  seed(decided("root"), real("login", { parent: "root" }));
  const n = events().length;
  const r = await werk("remove", "login");
  expect(r.code).not.toBe(0);
  expect((await werk("show", "login")).code).toBe(0);
  expect(events().length).toBe(n);
});

test("08.6 restore refuses without the person's say-so", async () => {
  seed(decided("root"), real("login", { parent: "root" }));
  await werk("remove", "login", "--actor", "you");
  const n = events().length;
  const r = await werk("restore", "login");
  expect(r.code).not.toBe(0);
  expect((await werk("show", "login")).code).toBe(1);
  expect(events().length).toBe(n);
});

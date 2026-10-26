import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { appendBoardEvent, readBoard, readBoardLog } from "../src/board/log.ts";
import { readMap } from "../src/map/store.ts";
import type { Step } from "../src/test/fake-script.ts";
import { watchTickets } from "../src/tickets/watch-run.ts";
import { card, ok, type Project, seed, w, withRoot } from "./lib.ts";

const SPEC = `# Spec: s\n\n## User stories\n\n1. As a person, I want one.\n2. As a person, I want two.\n\n## Test seams\n\nThe CLI.\n`;
const ticket = (title: string, cites: string, blockedBy: string, stories: string, checks = "- `make test`") => `title: ${title}
cites: ${cites}
blocked_by: ${blockedBy}
stories: ${stories}
touches: login

## What to build

A person logs in.

## Acceptance criteria

- It works.

## Checks

${checks}
`;
const edit = (path: string, content: string): Step => ({ edit: { path, content } });
const answer = (slug: string) => ({ slug, title: `Answer ${slug}`, why: `Which ${slug}?`, body: "The body." });

async function withTarget(p: Project) {
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  expect((await p.werk(["target", p.target])).code).toBe(0);
}

/** A decided subtree `root` with two decided children. */
function subtree(root: string): Project {
  const p = withRoot();
  card(p, root, { title: root.toUpperCase() });
  card(p, `${root}-a`, { title: "Card A", parent: root });
  card(p, `${root}-b`, { title: "Card B", parent: root });
  return p;
}

function writers(p: Project, root: string, o: { tickets?: Record<string, string>; specAns?: unknown[]; tickAns?: unknown[]; spec?: string } = {}) {
  const tickets = Object.entries(
    o.tickets ?? {
      "01.md": ticket("First", `${root}, ${root}-a`, "", "1"),
      "02.md": ticket("Second", `${root}-b`, "1", "2"),
    },
  ).map(([f, t]) => edit(`.werk/tickets/${root}/${f}`, t));
  p.script({
    roles: {
      "spec-writer": { replies: [[edit(`.werk/specs/${root}.md`, o.spec ?? SPEC), edit(`.werk/specs/${root}.spec-answers.json`, JSON.stringify(o.specAns ?? []))]] },
      "ticket-writer": { replies: [[...tickets, edit(`.werk/specs/${root}.ticket-answers.json`, JSON.stringify(o.tickAns ?? []))]] },
    },
  });
}
const boardPath = (p: Project) => join(p.dir, ".werk", "board.jsonl");
const mapOf = (p: Project) => readMap("t", join(p.dir, ".werk", "log.jsonl"));
const bev = (p: Project) => readBoardLog(boardPath(p)).events;

test("28.1 plan over a decided subtree: spec, board tickets, ghosts, log", async () => {
  const p = subtree("checkout");
  await withTarget(p);
  writers(p, "checkout", { specAns: [answer("retry-limit")], tickAns: [answer("ticket-order")] });
  const r = await p.werk(["plan", "checkout"]);
  expect(r.code, r.err).toBe(0);
  expect(existsSync(join(p.dir, ".werk", "specs", "checkout.md"))).toBe(true);
  const board = readBoard(boardPath(p));
  for (const id of ["checkout/01", "checkout/02"]) expect(["ready", "blocked"]).toContain(board.tickets.get(id)?.column);
  const m = mapOf(p);
  for (const id of ["checkout-retry-limit", "checkout-ticket-order"]) {
    expect(m.nodes.get(id)).toMatchObject({ proposed: true, who: "me" });
    expect(m.ghostEdges).toContainEqual({ from: id, to: "checkout", type: "refines" });
  }
  const types = bev(p).map((e) => e.type);
  expect(types[0]).toBe("plan.started");
  expect(types).toContain("plan.step");
  expect(types.at(-1)).toBe("plan.ended");
  const steps = bev(p).filter((e) => e.type === "plan.step") as any[];
  expect(steps.map((s) => s.payload.step)).toEqual(expect.arrayContaining(["spec writer", "ticket writer"]));
  for (const s of steps.filter((s) => s.payload.step !== "checks")) expect(existsSync(join(p.dir, ".werk", s.payload.log))).toBe(true);
});

test("28.2 an open card stops the plan before any writer runs", async () => {
  const p = subtree("checkout");
  card(p, "checkout-open", { title: "Open", parent: "checkout", status: "open" });
  await withTarget(p);
  writers(p, "checkout");
  const r = await p.werk(["plan", "checkout"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("checkout-open");
  expect(p.launches()).toEqual([]);
  expect(readBoard(boardPath(p)).tickets.size).toBe(0);
});

test("28.3 writers see tiers, not siblings", async () => {
  const p = withRoot();
  card(p, "auth", { title: "Auth" });
  card(p, "auth-token", { title: "Token", parent: "auth" });
  card(p, "auth-sso", { title: "SSO", parent: "auth" });
  card(p, "pay", { title: "Pay" });
  card(p, "payments-api", { title: "Payments API", parent: "pay" });
  card(p, "checkout", { title: "Checkout" });
  card(p, "checkout-x", { title: "X", parent: "checkout" });
  seed(p, "edge.added", { from: "checkout-x", to: "payments-api", type: "depends_on", why: "pays" });
  seed(p, "edge.added", { from: "payments-api", to: "auth-token", type: "depends_on", why: "auth" });
  await withTarget(p);
  writers(p, "checkout");
  await p.werk(["plan", "checkout"]);
  const ls = p.launches();
  expect(ls.map((l) => l.role)).toEqual(["spec-writer", "ticket-writer"]);
  for (const l of ls) {
    const prompt = l.messages[0] as string;
    const t2 = prompt.indexOf("## Tier two");
    expect(t2).toBeGreaterThan(0);
    expect(prompt.indexOf("### #checkout")).toBeGreaterThan(0);
    expect(prompt.indexOf("### #checkout")).toBeLessThan(t2);
    expect(prompt.indexOf("### #payments-api")).toBeGreaterThan(0);
    expect(prompt.indexOf("### #payments-api")).toBeLessThan(t2);
    expect(prompt.indexOf("### #auth-token")).toBeGreaterThan(t2);
    expect(prompt).not.toContain("auth-sso");
    expect(prompt).not.toMatch(/### #auth\b/);
  }
});

test("28.4 taken answer id fails the plan; bad ticket stays off the board", async () => {
  const p = subtree("checkout");
  card(p, "checkout-retry-limit", { title: "Taken", parent: "checkout" });
  await withTarget(p);
  const bad = ticket("Bad", "checkout", "", "2").replace(/## Acceptance criteria[\s\S]*?## Checks/, "## Acceptance criteria\n\n## Checks");
  writers(p, "checkout", {
    specAns: [answer("retry-limit")],
    tickets: { "01.md": ticket("Good", "checkout, checkout-a, checkout-b", "", "1, 2"), "02.md": bad },
  });
  const r = await p.werk(["plan", "checkout"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("checkout-retry-limit");
  const m = mapOf(p);
  expect([...m.nodes.keys()].filter((k) => k === "checkout-retry-limit").length).toBe(1);
  expect(m.nodes.get("checkout-retry-limit")?.proposed).toBe(false);
  const board = readBoard(boardPath(p));
  expect(["ready", "blocked"]).toContain(board.tickets.get("checkout/01")?.column);
  expect(board.tickets.has("checkout/02")).toBe(false);
});

test("28.5 target: none, plain file, valid repo, print", async () => {
  const p = subtree("checkout");
  writers(p, "checkout");
  const none = await p.werk(["plan", "checkout"]);
  expect(none.code).toBe(1);
  expect(none.err).toContain("werk target");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(p.dir, "plain.txt"), "x");
  expect((await p.werk(["target", join(p.dir, "plain.txt")])).code).not.toBe(0);
  expect((await p.werk(["target"])).code).not.toBe(0);
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  expect((await p.werk(["target", p.target])).code).toBe(0);
  const pr = await p.werk(["target"]);
  expect(pr.out.trim()).toBe(p.target);
});

function twoPlans(p: Project, root: string, second: { spec: string; tickets: Record<string, string> }, first?: Record<string, string>) {
  const files = (t: Record<string, string>) => Object.entries(t).map(([f, x]) => edit(`.werk/tickets/${root}/${f}`, x));
  const ans = (k: string) => edit(`.werk/specs/${root}.${k}-answers.json`, "[]");
  p.script({
    roles: {
      "spec-writer": { replies: [[edit(`.werk/specs/${root}.md`, SPEC), ans("spec")], [edit(`.werk/specs/${root}.md`, second.spec), ans("spec")]] },
      "ticket-writer": {
        replies: [
          [...files(first ?? { "01.md": ticket("T1", `${root}, ${root}-a`, "", "1"), "02.md": ticket("T2", `${root}-b`, "1", "2"), "03.md": ticket("T3", `${root}-b`, "", "2") }), ans("ticket")],
          [...files(second.tickets), ans("ticket")],
        ],
      },
    },
  });
}
const cols = (p: Project) => [...readBoard(boardPath(p)).tickets.values()].map(({ id, title, column, archived }) => ({ id, title, column, archived }));

test("29.1 second plan extends spec and continues numbers", async () => {
  const p2 = subtree("app");
  await withTarget(p2);
  twoPlans(p2, "app", {
    spec: SPEC.replace("two.", "two and new."),
    tickets: { "03.md": ticket("T3 rewritten", "app, app-a, app-b", "", "2"), "04.md": ticket("T4", "app, app-new", "", "1") },
  }, { "01.md": ticket("T1", "app, app-a", "", "1"), "02.md": ticket("T2", "app-b", "", "2"), "03.md": ticket("T3", "app-b", "", "2") });
  expect((await p2.werk(["plan", "app"])).code).toBe(0);
  appendBoardEvent(boardPath(p2), "ticket.moved", { id: "app/01", to: "building" });
  appendBoardEvent(boardPath(p2), "ticket.moved", { id: "app/02", to: "building" });
  appendBoardEvent(boardPath(p2), "ticket.moved", { id: "app/02", to: "merging" });
  appendBoardEvent(boardPath(p2), "ticket.moved", { id: "app/02", to: "done" });
  card(p2, "app-new", { title: "New card", parent: "app" });
  const r = await p2.werk(["plan", "app"]);
  expect(r.code, r.err + r.out).toBe(0);
  const c = cols(p2);
  expect(c.map((x) => x.id)).toEqual(["app/01", "app/02", "app/03", "app/04"]);
  expect(c.find((x) => x.id === "app/03")?.title).toBe("T3 rewritten");
  expect(c.find((x) => x.id === "app/01")).toMatchObject({ title: "T1", column: "building" });
  expect(c.find((x) => x.id === "app/02")).toMatchObject({ title: "T2", column: "done" });
  expect(readFileSync(join(p2.dir, ".werk", "specs", "app.md"), "utf8")).toContain("two and new");
});

test("29.2 open ticket the new spec no longer needs is archived; restore brings it back", async () => {
  const p = subtree("app");
  await withTarget(p);
  twoPlans(
    p,
    "app",
    { spec: SPEC, tickets: { "01.md": ticket("T1", "app, app-a", "", "1"), "03.md": ticket("T3", "app, app-a, app-b", "", "2") } },
    { "01.md": ticket("T1", "app, app-a", "", "1"), "02.md": ticket("T2", "app-b", "", "2") },
  );
  expect((await p.werk(["plan", "app"])).code).toBe(0);
  // the ticket writer of the second plan returns no T2: its file is gone from the folder
  rmSync(join(p.dir, ".werk", "tickets", "app", "02.md"));
  const r = await p.werk(["plan", "app"]);
  expect(r.code, r.err + r.out).toBe(0);
  const c = cols(p);
  expect(c.find((x) => x.id === "app/02")?.archived).toBe(true);
  const ev = bev(p).find((e) => e.type === "ticket.archived") as any;
  expect(ev.payload.reason).toMatch(/no longer needs/);
  expect((await p.werk(["ticket", "restore", "app/02"])).code).toBe(0);
  expect(cols(p).find((x) => x.id === "app/02")).toMatchObject({ archived: false });
});

test("29.3 retitle of a cited card blocks the ready ticket; a re-plan clears it", async () => {
  const p = subtree("app");
  await withTarget(p);
  twoPlans(p, "app", { spec: SPEC, tickets: { "01.md": ticket("T1", "app, app-a", "", "1"), "02.md": ticket("T2", "app-b", "1", "2"), "03.md": ticket("T3", "app-b", "", "2") } });
  expect((await p.werk(["plan", "app"])).code).toBe(0);
  const log = join(p.dir, ".werk", "log.jsonl");
  seed(p, "node.retitled", { id: "app-b", title: "Card B renamed" });
  const run = watchTickets(log);
  expect(run.blocked.length).toBeGreaterThan(0);
  const b = readBoard(boardPath(p)).tickets.get("app/02")!;
  expect(b.column).toBe("blocked");
  expect(b.reason).toContain("app-b");
  expect(b.reason).toMatch(/title/);
  expect((await p.werk(["plan", "app"])).code).toBe(0);
  expect(readBoard(boardPath(p)).tickets.get("app/02")?.column).not.toBe("blocked");
});

test("29.4 a note blocks nothing; a body change blocks the ready ticket, not the building one", async () => {
  const p = subtree("app");
  await withTarget(p);
  writers(p, "app", { tickets: { "01.md": ticket("T1", "app-a", "", "1"), "02.md": ticket("T2", "app-a, app, app-b", "", "2") } });
  expect((await p.werk(["plan", "app"])).code).toBe(0);
  appendBoardEvent(boardPath(p), "ticket.moved", { id: "app/01", to: "building" });
  const log = join(p.dir, ".werk", "log.jsonl");
  seed(p, "note.added", { id: "app-a", text: "hmm" });
  expect(watchTickets(log).blocked).toEqual([]);
  seed(p, "node.bodyEdited", { id: "app-a", body: "changed body" });
  const r = watchTickets(log);
  const t = readBoard(boardPath(p)).tickets;
  expect(t.get("app/02")?.column).toBe("blocked");
  expect(t.get("app/02")?.reason).toContain("app-a");
  expect(t.get("app/02")?.reason).toMatch(/body/);
  expect(t.get("app/01")?.column).toBe("building");
  void r;
});

test("29.5 a new card under a planned subtree reports cards-cited failure, blocks nothing", async () => {
  const p = subtree("app");
  await withTarget(p);
  writers(p, "app", { tickets: { "01.md": ticket("T1", "app, app-a, app-b", "", "1, 2") } });
  expect((await p.werk(["plan", "app"])).code).toBe(0);
  card(p, "app-new", { title: "New", parent: "app" });
  const r = watchTickets(join(p.dir, ".werk", "log.jsonl"));
  expect(r.failures.join("\n")).toContain("cards-cited");
  expect(r.failures.join("\n")).toContain("app-new");
  expect(r.blocked).toEqual([]);
  expect(cols(p).every((t) => t.column === "ready")).toBe(true);
});

test("82.1 plan records a tier event 'feature' first, board shows tickets, ghosts", async () => {
  const p = subtree("auth");
  await withTarget(p);
  writers(p, "auth", { specAns: [answer("token-ttl")], tickAns: [answer("split-login")] });
  const r = await p.werk(["plan", "#auth"]);
  expect(r.code, r.err).toBe(0);
  const first = bev(p)[0] as any;
  expect(first.type).toBe("run.tier");
  expect(first.payload.tier).toBe("feature");
});

test("82.1b ghosts and tickets of the plan", async () => {
  const p = subtree("auth");
  await withTarget(p);
  writers(p, "auth", { specAns: [answer("token-ttl")], tickAns: [answer("split-login")] });
  expect((await p.werk(["plan", "#auth"])).code).toBe(0);
  expect(readBoard(boardPath(p)).tickets.size).toBe(2);
  const s = (await ok(p, "show", "auth-token-ttl")).out;
  expect(s).toContain("proposed");
  expect(s).toContain("Answer token-ttl");
  expect(s).toContain("Which token-ttl?");
  expect(s).toContain("who: me");
  expect(s).toMatch(/refines\s+auth\s/);
  await ok(p, "accept", "auth-token-ttl", "--actor", "you");
  expect((await ok(p, "show", "auth-split-login")).out).toContain("proposed");
});

test("82.2 taken answer id fails the plan", async () => {
  const p = subtree("auth");
  card(p, "auth-token-ttl", { title: "Taken", parent: "auth" });
  await withTarget(p);
  writers(p, "auth", { specAns: [answer("token-ttl")] });
  const r = await p.werk(["plan", "#auth"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("token-ttl");
  expect([...mapOf(p).nodes.keys()].filter((k) => k === "auth-token-ttl").length).toBe(1);
});

test("82.3 a ticket failing its checks stays off the board and gives no coverage", async () => {
  const p = withRoot();
  card(p, "auth", { title: "Auth" });
  card(p, "auth-session", { title: "Session", parent: "auth" });
  await withTarget(p);
  const login = ticket("Login", "auth-session", "", "1").replace("stories: 1\n", "");
  writers(p, "auth", { tickets: { "01.md": login, "02.md": ticket("Logout", "auth", "", "2") } });
  const r = await p.werk(["plan", "#auth"]);
  expect(r.code).not.toBe(0);
  const board = readBoard(boardPath(p)).tickets;
  expect(board.has("auth/02")).toBe(true);
  expect(board.has("auth/01")).toBe(false);
  expect(r.out + r.err).toContain("stories");
  expect(r.out + r.err).toMatch(/cards-cited.*auth-session|auth-session/);
});

test("82.4 a ticket naming a failed blocker is blocked; correct blockers go ready", async () => {
  const p = subtree("auth");
  await withTarget(p);
  const a = ticket("A", "auth", "", "1").replace("stories: 1\n", "");
  writers(p, "auth", {
    tickets: { "01.md": a, "02.md": ticket("B", "auth", "", "1"), "03.md": ticket("C", "auth", "1, 2", "2") },
  });
  await p.werk(["plan", "#auth"]);
  const t = readBoard(boardPath(p)).tickets;
  expect(t.has("auth/01")).toBe(false);
  expect(t.get("auth/03")?.column).toBe("blocked");
  expect(t.get("auth/02")?.column).toBe("ready");
});

test("82.5 a second plan archives a dropped open ticket; restore", async () => {
  const p = subtree("auth");
  await withTarget(p);
  twoPlans(p, "auth", { spec: SPEC, tickets: { "01.md": ticket("login", "auth, auth-a, auth-b", "", "1, 2") } }, { "01.md": ticket("login", "auth, auth-a", "", "1"), "02.md": ticket("logout", "auth-b", "", "2") });
  expect((await p.werk(["plan", "#auth"])).code).toBe(0);
  rmSync(join(p.dir, ".werk", "tickets", "auth", "02.md"));
  const r2 = await p.werk(["plan", "#auth"]);
  expect(r2.code, r2.err + r2.out).toBe(0);
  const ev = bev(p).find((e) => e.type === "ticket.archived") as any;
  expect(ev.payload.id).toBe("auth/02");
  expect(ev.payload.reason).toMatch(/no longer needs/);
  expect(cols(p).find((x) => x.id === "auth/01")?.archived).toBe(false);
  expect((await p.werk(["ticket", "restore", "auth/02"])).code).toBe(0);
  expect(cols(p).find((x) => x.id === "auth/02")).toMatchObject({ archived: false });
});

test("76.1 planner agents launch on pinned Opus, no advisor", async () => {
  const p = subtree("auth");
  await withTarget(p);
  writers(p, "auth");
  expect((await p.werk(["plan", "auth"])).code).toBe(0);
  const ls = p.launches();
  expect(ls.map((l) => l.role)).toEqual(["spec-writer", "ticket-writer"]);
  for (const l of ls) {
    const i = l.args.indexOf("--model");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(l.args[i + 1]).toMatch(/^claude-opus-[0-9-]+$/);
    expect(l.args).not.toContain("--advisor");
    expect(l.args[i + 1]).not.toBe("opus");
  }
  expect(readBoard(boardPath(p)).tickets.size).toBe(2);
});

test("76.4 an unknown role is an error that names it, not a default-model launch", async () => {
  const { modelFlags } = await import("../src/agent/role-model.ts");
  let threw: unknown;
  let flags: string[] = [];
  try {
    flags = modelFlags("mystery-role");
  } catch (e) {
    threw = e;
  }
  expect(threw, `modelFlags returned ${JSON.stringify(flags)} instead of throwing`).toBeDefined();
  expect(String(threw)).toContain("mystery-role");
});

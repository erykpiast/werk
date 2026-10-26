import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appendBoardEvent } from "../src/board/log.ts";
import { SPEC_WRITER_BASE, TICKET_WRITER_BASE } from "../src/plan/prompts.ts";
import { watchTickets } from "../src/tickets/watch-run.ts";
import {
  answer, board, boardEvents, boardFile, mapLog, mapOf, mapProject, rawAppend, specText, ticket, withTarget, writers,
} from "./plan-helpers.ts";

const STORIES = ["Pay.", "Retry."];
const checkoutCards = [{ id: "checkout" }, { id: "checkout-pay", parent: "checkout" }];
const goodTickets = {
  "01.md": ticket("Pay", "checkout, checkout-pay", "", "1"),
  "02.md": ticket("Retry", "checkout", "1", "2"),
};

test("28.1", async () => {
  const p = mapProject(checkoutCards);
  await withTarget(p);
  writers(p, "checkout", [
    { spec: specText(STORIES), tickets: goodTickets, specAnswers: [answer("retry-limit")], ticketAnswers: [answer("ticket-order")] },
  ]);
  const run = await p.werk(["plan", "checkout"]);
  expect(run.code).toBe(0);
  expect(existsSync(join(p.dir, ".werk", "specs", "checkout.md"))).toBe(true);
  const b = board(p);
  for (const id of ["checkout/01", "checkout/02"]) expect(["ready", "blocked"]).toContain(b.tickets.get(id)?.column as string);
  const map = mapOf(p);
  for (const id of ["checkout-retry-limit", "checkout-ticket-order"]) {
    expect(map.nodes.get(id)).toMatchObject({ proposed: true });
    expect(map.ghostEdges).toContainEqual({ from: id, to: "checkout", type: "refines" });
    expect((map.nodes.get(id) as { who?: string }).who).toBe("me");
  }
  const ev = boardEvents(p);
  expect(ev.map((e) => e.type)).toContain("plan.started");
  const steps = ev.filter((e) => e.type === "plan.step").map((e) => e.payload as { step: string; log?: string });
  expect(steps.find((s) => s.step === "spec writer")?.log).toBeTruthy();
  expect(steps.find((s) => s.step === "ticket writer")?.log).toBeTruthy();
  expect(ev.at(-1)?.type).toBe("plan.ended");
});

test("28.2", async () => {
  const p = mapProject([...checkoutCards, { id: "checkout-open", parent: "checkout", open: true }]);
  await withTarget(p);
  writers(p, "checkout", [{ spec: specText(STORIES), tickets: goodTickets }]);
  const run = await p.werk(["plan", "checkout"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("checkout-open");
  expect(p.launches()).toEqual([]);
  expect([...board(p).tickets.keys()]).toEqual([]);
});

test("28.3", async () => {
  const p = mapProject(
    [
      { id: "checkout" },
      { id: "payments-api" },
      { id: "auth-area" },
      { id: "auth-token", parent: "auth-area" },
      { id: "auth-sso", parent: "auth-area" },
    ],
    [
      { from: "checkout", to: "payments-api" },
      { from: "payments-api", to: "auth-token" },
    ],
  );
  await withTarget(p);
  writers(p, "checkout", [{ spec: specText(STORIES), tickets: goodTickets }]);
  await p.werk(["plan", "checkout"]);
  const launches = p.launches();
  expect(launches.map((l) => l.role)).toEqual(["spec-writer", "ticket-writer"]);
  const spec = launches[0]?.messages[0] as string;
  const two = spec.indexOf("## Tier two");
  expect(two).toBeGreaterThan(-1);
  expect(spec.indexOf("### #checkout")).toBeGreaterThan(-1);
  expect(spec.indexOf("### #checkout")).toBeLessThan(two);
  expect(spec.indexOf("### #payments-api")).toBeGreaterThan(-1);
  expect(spec.indexOf("### #payments-api")).toBeLessThan(two);
  expect(spec.indexOf("### #auth-token")).toBeGreaterThan(two);
  for (const l of launches) {
    const prompt = l.messages[0] as string;
    expect(prompt).not.toContain("auth-sso");
    expect(prompt).not.toContain("auth-area");
  }
  const sys = (args: string[]) => args[args.indexOf("--append-system-prompt") + 1] as string;
  expect(sys(launches[0]!.args).startsWith(SPEC_WRITER_BASE.trimEnd())).toBe(true);
  expect(sys(launches[1]!.args).startsWith(TICKET_WRITER_BASE.trimEnd())).toBe(true);
});

test("28.4", async () => {
  const p = mapProject([...checkoutCards, { id: "checkout-retry-limit", parent: "checkout" }]);
  await withTarget(p);
  const bad = ticket("Bad", "checkout", "", "2").replace(/## Acceptance criteria\n\n- It works.\n\n/, "");
  writers(p, "checkout", [
    {
      spec: specText(STORIES),
      tickets: { "01.md": ticket("Pay", "checkout, checkout-pay, checkout-retry-limit", "", "1"), "02.md": bad },
      specAnswers: [answer("retry-limit")],
    },
  ]);
  const run = await p.werk(["plan", "checkout"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("checkout-retry-limit");
  const m = mapOf(p);
  expect(m.nodes.get("checkout-retry-limit")?.proposed).toBeFalsy();
  const b = board(p);
  expect(["ready", "blocked"]).toContain(b.tickets.get("checkout/01")?.column as string);
  expect(b.tickets.has("checkout/02")).toBe(false);
});

test("28.5", async () => {
  const p = mapProject(checkoutCards);
  const run = await p.werk(["plan", "checkout"]);
  expect(run.code).toBe(1);
  expect(run.err).toContain("werk target");
  const file = join(p.dir, "plainfile");
  await Bun.write(file, "x");
  const bad = await p.werk(["target", file]);
  expect(bad.code).not.toBe(0);
  expect((await p.werk(["target"])).code).not.toBe(0);
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  expect((await p.werk(["target", p.target])).code).toBe(0);
  const shown = await p.werk(["target"]);
  expect(shown.out.trim()).toBe(p.target);
});

// ---- 29 ----
const SPEC3 = specText(["One.", "Two.", "Three."]);
const t3 = {
  "01.md": ticket("One", "checkout, checkout-pay", "", "1"),
  "02.md": ticket("Two", "checkout", "", "2"),
  "03.md": ticket("Three", "checkout-pay", "", "3"),
};

test("29.1", async () => {
  const p = mapProject(checkoutCards);
  await withTarget(p);
  const SPEC4 = specText(["One.", "Two.", "Three.", "Four, the new card."]);
  writers(p, "checkout", [
    { spec: SPEC3, tickets: t3 },
    {
      spec: SPEC4,
      tickets: {
        "03.md": ticket("Three rewritten", "checkout-pay", "", "3"),
        "04.md": ticket("Four", "checkout-new", "", "4"),
      },
    },
  ]);
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  const f = boardFile(p);
  appendBoardEvent(f, "ticket.moved", { id: "checkout/01", to: "building" });
  appendBoardEvent(f, "ticket.moved", { id: "checkout/02", to: "building" });
  appendBoardEvent(f, "ticket.moved", { id: "checkout/02", to: "merging" });
  appendBoardEvent(f, "ticket.moved", { id: "checkout/02", to: "done" });
  rawAppend(p, [
    { type: "node.added", payload: { id: "checkout-new", kind: "card", title: "New card", parent: "checkout" } },
    { type: "node.decided", payload: { id: "checkout-new" } },
  ]);
  const run = await p.werk(["plan", "checkout"]);
  const b = board(p);
  expect([...b.tickets.keys()].sort()).toEqual(["checkout/01", "checkout/02", "checkout/03", "checkout/04"]);
  expect(b.tickets.get("checkout/03")?.title).toBe("Three rewritten");
  expect(b.tickets.get("checkout/01")).toMatchObject({ column: "building", title: "One" });
  expect(b.tickets.get("checkout/02")).toMatchObject({ column: "done", title: "Two" });
  expect(readFileSync(join(p.dir, ".werk", "specs", "checkout.md"), "utf8")).toContain("new card");
  expect(run.code).toBe(0);
});

test("29.2", async () => {
  const p = mapProject(checkoutCards);
  await withTarget(p);
  writers(p, "checkout", [
    { spec: specText(STORIES), tickets: { "01.md": ticket("Pay", "checkout", "", "1"), "02.md": ticket("Retry", "checkout-pay", "", "2") } },
    { spec: specText(["Pay."]), tickets: { "01.md": ticket("Pay", "checkout", "", "1") } },
  ]);
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  // ticket 02 delivers a card: make it cite checkout-pay only via fixture is not needed; remove card checkout-pay? use 02's own
  // Remove the card that only ticket 02 delivers: here the second plan simply does not rewrite 02.
  const rm = await p.werk(["remove", "checkout-pay", "--actor", "you"]);
  expect(rm.code).toBe(0);
  const run = await p.werk(["plan", "checkout"]);
  const b = board(p);
  const t = b.tickets.get("checkout/02");
  expect(t?.archived).toBe(true);
  const ev = boardEvents(p).find((e) => e.type === "ticket.archived") as { payload: { reason?: string } };
  expect(ev.payload.reason).toContain("no longer needs it");
  expect((await p.werk(["ticket", "restore", "checkout/02"])).code).toBe(0);
  expect(board(p).tickets.get("checkout/02")?.archived).toBe(false);
  void run;
});

test("29.3", async () => {
  const p = mapProject(checkoutCards);
  await withTarget(p);
  writers(p, "checkout", [
    { spec: specText(STORIES), tickets: goodTickets },
    { spec: specText(STORIES), tickets: { "02.md": ticket("Retry new", "checkout", "1", "2") } },
  ]);
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  rawAppend(p, [{ type: "node.retitled", payload: { id: "checkout", title: "Checkout, renamed" } }]);
  watchTickets(mapLog(p));
  const t = board(p).tickets.get("checkout/02");
  expect(t?.column).toBe("blocked");
  expect(t?.reason).toContain("checkout");
  expect(t?.reason).toMatch(/title/);
  await p.werk(["plan", "checkout"]);
  watchTickets(mapLog(p));
  expect(board(p).tickets.get("checkout/02")?.column).toBe("ready");
  expect(board(p).tickets.get("checkout/02")?.reason ?? "").not.toMatch(/changed after the plan/);
});

test("29.4", async () => {
  const p = mapProject(checkoutCards);
  await withTarget(p);
  writers(p, "checkout", [{ spec: specText(STORIES), tickets: { "01.md": ticket("Pay", "checkout-pay", "", "1"), "02.md": ticket("Retry", "checkout-pay, checkout", "", "2") } }]);
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  appendBoardEvent(boardFile(p), "ticket.moved", { id: "checkout/01", to: "building" });
  expect((await p.werk(["say", "checkout-pay", "a note"])).code).toBe(0);
  watchTickets(mapLog(p));
  expect(board(p).tickets.get("checkout/02")).toMatchObject({ column: "ready" });
  expect(board(p).tickets.get("checkout/01")?.column).toBe("building");
  rawAppend(p, [{ type: "node.bodyEdited", payload: { id: "checkout-pay", body: "new body" } }]);
  watchTickets(mapLog(p));
  const t = board(p).tickets.get("checkout/02");
  expect(t?.column).toBe("blocked");
  expect(t?.reason).toContain("checkout-pay");
  expect(t?.reason).toContain("body");
  expect(board(p).tickets.get("checkout/01")?.column).toBe("building");
  expect(board(p).tickets.get("checkout/01")?.reason ?? "").toBe("");
});

test("29.5", async () => {
  const p = mapProject(checkoutCards);
  await withTarget(p);
  writers(p, "checkout", [{ spec: specText(STORIES), tickets: goodTickets }]);
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  rawAppend(p, [
    { type: "node.added", payload: { id: "checkout-logout", kind: "card", title: "Log out", parent: "checkout" } },
    { type: "node.decided", payload: { id: "checkout-logout" } },
  ]);
  const r = watchTickets(mapLog(p));
  expect(r.failures.join("\n")).toContain("checkout-logout");
  expect(r.failures.join("\n")).toContain("cards-cited");
  for (const t of board(p).tickets.values()) {
    expect(t.column).toBe("ready");
    expect(t.reason ?? "").toBe("");
  }
});

// ---- 82 ----
const authCards = [{ id: "auth" }, { id: "auth-session", parent: "auth" }];
const authSpec = specText(["Log in.", "Log out."]);

test("82.1", async () => {
  const p = mapProject(authCards);
  await withTarget(p);
  writers(p, "auth", [
    {
      spec: authSpec,
      tickets: { "01.md": ticket("login", "auth, auth-session", "", "1"), "02.md": ticket("logout", "auth", "1", "2") },
      specAnswers: [answer("token-ttl")],
      ticketAnswers: [answer("split-login")],
    },
  ]);
  const run = await p.werk(["plan", "auth"]);
  expect(run.code).toBe(0);
  const first = boardEvents(p)[0] as { type: string; payload: { tier?: string } };
  expect(first.type).toBe("run.tier");
  expect(first.payload.tier).toBe("feature");
  expect([...board(p).tickets.keys()].sort()).toEqual(["auth/01", "auth/02"]);
  const m = mapOf(p);
  for (const slug of ["token-ttl", "split-login"]) {
    const n = m.nodes.get(`auth-${slug}`) as { proposed?: boolean; who?: string; title: string; why?: string; body?: string };
    expect(n.proposed).toBe(true);
    expect(n.who).toBe("me");
    expect(n.title).toBe(`Answer ${slug}`);
    expect(n.why).toBe(`Why ${slug}?`);
    expect(n.body).toBe(`Body ${slug}.`);
    expect(m.ghostEdges).toContainEqual({ from: `auth-${slug}`, to: "auth", type: "refines" });
  }
  expect((await p.werk(["accept", "auth-token-ttl", "--actor", "you"])).code).toBe(0);
  expect(mapOf(p).nodes.get("auth-split-login")?.proposed).toBe(true);
});

test("82.2", async () => {
  const p = mapProject([...authCards, { id: "auth-token-ttl", parent: "auth" }]);
  await withTarget(p);
  writers(p, "auth", [{ spec: authSpec, tickets: { "01.md": ticket("login", "auth, auth-session, auth-token-ttl", "", "1, 2") }, specAnswers: [answer("token-ttl")] }]);
  const run = await p.werk(["plan", "auth"]);
  expect(run.code).not.toBe(0);
  expect(run.err + run.out).toContain("token-ttl");
  const ids = [...mapOf(p).nodes.keys()].filter((i) => i === "auth-token-ttl");
  expect(ids).toHaveLength(1);
  expect(mapOf(p).nodes.get("auth-token-ttl")?.proposed).toBeFalsy();
});

test("82.3", async () => {
  const p = mapProject(authCards);
  await withTarget(p);
  const login = ticket("login", "auth-session", "", "1").replace(/stories: 1\n/, "");
  writers(p, "auth", [{ spec: authSpec, tickets: { "01.md": login, "02.md": ticket("logout", "auth", "", "2") } }]);
  const run = await p.werk(["plan", "auth"]);
  const b = board(p);
  expect(b.tickets.has("auth/02")).toBe(true);
  expect(b.tickets.has("auth/01")).toBe(false);
  const text = run.out + run.err;
  expect(text).toContain("stories");
  expect(text).toMatch(/auth-session/);
  expect(text).toMatch(/no ticket cites #auth-session/);
});

test("82.4", async () => {
  const p = mapProject(authCards);
  await withTarget(p);
  const a = ticket("a", "auth-session", "", "1").replace(/stories: 1\n/, "");
  writers(p, "auth", [
    {
      spec: authSpec,
      tickets: {
        "01.md": a,
        "02.md": ticket("b", "auth, auth-session", "", "1"),
        "03.md": ticket("c", "auth", "1, 2", "2"),
      },
    },
  ]);
  await p.werk(["plan", "auth"]);
  const b = board(p);
  expect(b.tickets.has("auth/01")).toBe(false);
  expect(b.tickets.get("auth/03")?.column).toBe("blocked");
  expect(b.tickets.get("auth/02")?.column).toBe("ready");
});

test("82.5", async () => {
  const p = mapProject(authCards);
  await withTarget(p);
  const login = ticket("login", "auth, auth-session", "", "1");
  writers(p, "auth", [
    { spec: authSpec, tickets: { "01.md": login, "02.md": ticket("logout", "auth", "", "2") } },
    { spec: specText(["Log in."]), tickets: { "01.md": login } },
  ]);
  expect((await p.werk(["plan", "auth"])).code).toBe(0);
  await p.werk(["plan", "auth"]);
  const ev = boardEvents(p).find((e) => e.type === "ticket.archived") as { payload: { id: string; reason?: string } };
  expect(ev.payload.id).toBe("auth/02");
  expect(ev.payload.reason).toContain("no longer needs it");
  expect(board(p).tickets.get("auth/01")?.archived).toBe(false);
  expect((await p.werk(["ticket", "restore", "auth/02"])).code).toBe(0);
  expect(board(p).tickets.get("auth/02")?.archived).toBe(false);
});

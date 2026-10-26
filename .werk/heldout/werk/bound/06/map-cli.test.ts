// Held-out steps 04, 06, 08 and 10, run through the werk command line on a temporary map.
import { afterEach, expect, test } from "bun:test";
import { cleanup, Project } from "./helpers.ts";

afterEach(cleanup);

const header = (out: string) => out.split("\n")[0] ?? "";
const isGhost = (p: Project, id: string) => header(p.werk("show", id).out).includes("proposed");

/** The map in a browser: werk needs a verb that serves it. */
function expectMapServer(p: Project): void {
  const help = p.werk("help").out;
  expect(/^\s{2}(serve|map|ui)\b/m.test(help), "werk has a verb that serves the map").toBe(true);
}

test("04.1 an agent's new card waits as a ghost until the person accepts it", () => {
  const p = new Project();
  p.card("checkout-flow", "Checkout flow");
  p.seed({ type: "node.proposed", actor: "agent", payload: { id: "other-ghost", kind: "card", title: "Other ghost" } });
  const before = p.events().length;
  const add = p.werk("add", "retry-payment", "--title", "Retry payment", "--parent", "checkout-flow");
  expect(add.code).toBe(0);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const fresh = p.events().slice(before);
  expect(fresh).toHaveLength(1);
  expect(fresh[0]?.type).toBe("node.proposed");
  expect(fresh[0]?.payload.parent).toBe("checkout-flow");
  const ghost = p.werk("show", "retry-payment").out;
  expect(header(ghost)).toContain("proposed");
  expect(ghost).toContain("parent: checkout-flow");

  const mid = p.events().length;
  expect(p.werk("accept", "retry-payment", "--actor", "you").code).toBe(0);
  const accepted = p.events().slice(mid);
  expect(accepted).toHaveLength(1);
  expect(accepted[0]?.type).toBe("change.accepted");
  const real = p.werk("show", "retry-payment").out;
  expect(header(real)).not.toContain("proposed");
  expect(real).toContain("parent: checkout-flow");
  expect(isGhost(p, "other-ghost")).toBe(true);
});

test("04.2 accepting a ghost child accepts its ghost parent, and its held link goes live", () => {
  const p = new Project();
  p.card("payments", "Payments");
  p.card("fraud-rules", "Fraud rules");
  expect(p.werk("add", "refunds", "--title", "Refunds", "--parent", "payments").code).toBe(0);
  expect(p.werk("add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds").code).toBe(0);
  const why = "a partial refund runs the fraud checks";
  expect(p.werk("link", "partial-refunds", "fraud-rules", "--type", "depends_on", "--why", why).code).toBe(0);
  expect(
    p.werk("add", "pr-opt", "--kind", "option", "--title", "Full refunds only", "--why_not", "too strict").code,
  ).toBe(0);
  expect(p.werk("link", "pr-opt", "partial-refunds", "--type", "alternative_to").code).toBe(0);
  expect(p.werk("add", "pr-src", "--kind", "source", "--title", "Refund policy", "--url", "https://x.test").code).toBe(
    0,
  );
  expect(p.werk("link", "partial-refunds", "pr-src", "--type", "supported_by").code).toBe(0);
  const held = p.werk("show", "partial-refunds").out;
  const depLine = () =>
    p
      .werk("show", "partial-refunds")
      .out.split("\n")
      .find((l) => l.includes("depends_on")) ?? "";
  expect(held).toContain("fraud-rules");
  expect(depLine()).toContain("held");

  const before = p.events().length;
  expect(p.werk("accept", "partial-refunds", "--actor", "you").code).toBe(0);
  const fresh = p.events().slice(before);
  expect(fresh.length).toBeGreaterThan(0);
  expect(fresh.every((e) => e.type === "change.accepted")).toBe(true);
  expect(fresh.some((e) => e.type.startsWith("edge."))).toBe(false);
  for (const id of ["refunds", "partial-refunds", "pr-opt", "pr-src"]) expect(isGhost(p, id)).toBe(false);
  expect(depLine()).toContain("fraud-rules");
  expect(depLine()).not.toContain("held");
});

test("04.3 discarding a ghost parent drops its ghost children", () => {
  const p = new Project();
  p.card("onboarding", "Onboarding");
  expect(p.werk("add", "email-verification", "--title", "Email verification", "--parent", "onboarding").code).toBe(0);
  expect(p.werk("add", "resend-email", "--title", "Resend email", "--parent", "email-verification").code).toBe(0);
  expect(p.werk("discard", "email-verification").code).toBe(0);
  for (const id of ["email-verification", "resend-email"]) {
    const show = p.werk("show", id);
    expect(show.code).not.toBe(0);
    expect(show.err).toContain("no node");
  }
  const onboarding = p.werk("show", "onboarding").out;
  expect(onboarding).not.toContain("ghost");
  expect(onboarding).not.toContain("email-verification");
});

test("04.4 the words of a ghost are frozen", () => {
  const p = new Project();
  p.card("search", "Search");
  expect(
    p.werk("add", "search-index", "--title", "One index per map", "--why", "fast lookups", "--parent", "search").code,
  ).toBe(0);
  const before = p.events().length;
  const again = p.werk("add", "search-index", "--title", "Two indexes", "--why", "other words", "--parent", "search");
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("frozen");
  expect(p.events().length).toBe(before);
  const show = p.werk("show", "search-index").out;
  expect(show).toContain("One index per map");
  expect(show).toContain("why: fast lookups");
});

test("04.5 an accept from the command line needs the statement that the person asked for it", () => {
  const p = new Project();
  p.card("compliance", "Compliance");
  expect(p.werk("add", "audit-log", "--title", "Audit log", "--parent", "compliance").code).toBe(0);
  const before = p.events().length;
  expect(p.werk("accept", "audit-log").code).not.toBe(0);
  expect(p.events().length).toBe(before);
  expect(isGhost(p, "audit-log")).toBe(true);
  expect(p.werk("accept", "audit-log", "--actor", "you").code).toBe(0);
  expect(isGhost(p, "audit-log")).toBe(false);
});

test("06.1 a new excerpt for a card stages as a ghost", () => {
  const p = new Project();
  p.card("retry", "Retry is safe", { status: "decided" });
  p.seed({ type: "node.added", payload: { id: "rfc", kind: "source", title: "RFC", url: "https://x.test" } });
  const add = p.werk("add", "rfc-quote", "--kind", "excerpt", "--title", "A retry is idempotent", "--parent", "rfc");
  expect(add.code).toBe(0);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  expect(p.werk("link", "retry", "rfc-quote", "--type", "supported_by").code).toBe(0);
  expect(isGhost(p, "rfc-quote")).toBe(true);
  expect(p.werk("show", "retry").out).toContain("held");
  expect(header(p.werk("show", "retry").out)).toContain("[decided]");
});

function authMap(): Project {
  const p = new Project();
  p.card("auth", "Auth", { status: "decided" });
  p.card("login", "Login", { parent: "auth" });
  p.card("session", "Session", { parent: "auth" });
  p.card("audit", "Audit");
  p.seed({
    type: "edge.added",
    payload: { from: "login", to: "audit", type: "depends_on", why: "login writes audit" },
  });
  return p;
}

const linksTo = (p: Project, id: string, other: string) =>
  p
    .werk("show", id)
    .out.split("\n")
    .some((l) => /^\s+(->|<-) /.test(l) && l.includes(` ${other} `));

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", () => {
  const p = authMap();
  expect(linksTo(p, "audit", "login")).toBe(true);
  const before = p.events().length;
  expect(p.werk("remove", "auth", "--actor", "you").code).toBe(0);
  for (const id of ["auth", "login", "session"]) expect(p.werk("show", id).code).not.toBe(0);
  const fresh = p.events().slice(before);
  expect(fresh).toHaveLength(1);
  expect(fresh[0]?.type).toBe("node.removed");
  const removed = p.werk("removed").out;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect(linksTo(p, "audit", "login")).toBe(false);

  expect(p.werk("restore", "auth", "--actor", "you").code).toBe(0);
  expect(p.werk("show", "auth").code).toBe(0);
  expect(p.werk("show", "login").out).toContain("parent: auth");
  expect(p.werk("show", "session").out).toContain("parent: auth");
  expect(linksTo(p, "audit", "login")).toBe(true);
  const after = p.werk("removed").out;
  expect(after).not.toContain("auth");
  expect(after).not.toContain("login");
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", () => {
  const p = new Project();
  p.card("platform", "Platform");
  p.card("auth", "Auth", { parent: "platform" });
  p.card("login", "Login", { parent: "auth" });
  p.card("session", "Session", { parent: "auth" });
  expect(p.werk("remove", "auth", "--actor", "you", "--reparent").code).toBe(0);
  expect(p.werk("show", "auth").code).not.toBe(0);
  expect(p.werk("show", "login").out).toContain("parent: platform");
  expect(p.werk("show", "session").out).toContain("parent: platform");
  expect(p.werk("restore", "auth", "--actor", "you").code).toBe(0);
  expect(p.werk("show", "auth").out).toContain("parent: platform");
  expect(p.werk("show", "login").out).toContain("parent: auth");
  expect(p.werk("show", "session").out).toContain("parent: auth");
  expect(p.werk("show", "login").out).not.toContain("parent: platform");
});

test("08.3 a link waits until both of its ends are back", () => {
  const p = new Project();
  p.card("branch-a", "Branch A");
  p.card("branch-b", "Branch B");
  p.card("login", "Login", { parent: "branch-a" });
  p.card("session", "Session", { parent: "branch-b" });
  p.seed({ type: "edge.added", payload: { from: "login", to: "session", type: "depends_on", why: "needs a session" } });
  expect(p.werk("remove", "login", "--actor", "you").code).toBe(0);
  expect(p.werk("remove", "session", "--actor", "you").code).toBe(0);
  expect(p.werk("restore", "login", "--actor", "you").code).toBe(0);
  expect(p.werk("show", "login").code).toBe(0);
  expect(linksTo(p, "login", "session")).toBe(false);
  expect(p.werk("restore", "session", "--actor", "you").code).toBe(0);
  expect(linksTo(p, "login", "session")).toBe(true);
});

test("08.4 a removed card's id stays taken, and a cited source stays", () => {
  const p = new Project();
  p.card("login", "Login");
  p.card("billing", "Billing");
  p.seed(
    { type: "node.added", payload: { id: "rfc-6749", kind: "source", title: "OAuth 2.0", url: "https://x.test" } },
    { type: "edge.added", payload: { from: "login", to: "rfc-6749", type: "supported_by" } },
    { type: "edge.added", payload: { from: "billing", to: "rfc-6749", type: "supported_by" } },
  );
  expect(p.werk("remove", "login", "--actor", "you").code).toBe(0);
  expect(p.werk("show", "rfc-6749").code).toBe(0);
  expect(linksTo(p, "rfc-6749", "billing")).toBe(true);
  const before = p.events().length;
  const add = p.werk("add", "login", "--title", "Login again");
  expect(add.code).not.toBe(0);
  expect(add.err).toMatch(/restore #?login/);
  expect(p.events().length).toBe(before);
  expect(p.werk("show", "login").code).not.toBe(0);
});

test("08.5 remove refuses without the person's say-so", () => {
  const p = new Project();
  p.card("login", "Login");
  const before = p.events().length;
  expect(p.werk("remove", "login").code).not.toBe(0);
  expect(p.werk("show", "login").code).toBe(0);
  expect(p.events().length).toBe(before);
});

test("08.6 restore refuses without the person's say-so", () => {
  const p = new Project();
  p.card("login", "Login");
  expect(p.werk("remove", "login", "--actor", "you").code).toBe(0);
  const before = p.events().length;
  expect(p.werk("restore", "login").code).not.toBe(0);
  expect(p.werk("show", "login").code).not.toBe(0);
  expect(p.events().length).toBe(before);
});

test("10.1 an agent's note appears on the card's thread in the map", () => {
  const p = new Project();
  p.card("auth-login", "Login uses magic links", { status: "decided" });
  const say = p.werk("say", "auth-login", "Should expired links show a retry button?");
  expect(say.code).toBe(0);
  const show = p.werk("show", "auth-login").out;
  expect(show).toMatch(/agent: Should expired links show a retry button\?/);
  // The person opens the map and selects the card.
  expectMapServer(p);
});

test("10.2 the agent reads the person's notes in the inbox, after a log position and capped by count", () => {
  const p = new Project();
  p.card("auth-login", "Login uses magic links");
  for (const text of ["first", "second", "third", "fourth"])
    p.seed({ type: "note.added", actor: "you", payload: { id: "auth-login", text } });
  const inbox = p.werk("inbox").out;
  const order = ["first", "second", "third", "fourth"].map((t) => inbox.indexOf(`    ${t}`));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  const heads = inbox.split("\n").filter((l) => l.startsWith("["));
  expect(heads).toHaveLength(4);
  for (const head of heads) expect(head).toMatch(/^\[\d+\] #auth-login/);
  const firstSeq = /^\[(\d+)\]/.exec(heads[0] as string)?.[1] as string;
  const since = p.werk("inbox", "--since", firstSeq).out;
  expect(since).not.toMatch(/^ {4}first$/m);
  for (const t of ["second", "third", "fourth"]) expect(since).toMatch(new RegExp(`^ {4}${t}$`, "m"));
  const capped = p.werk("inbox", "--since", firstSeq, "-n", "2").out;
  expect(capped).toMatch(/^ {4}second$/m);
  expect(capped).toMatch(/^ {4}third$/m);
  expect(capped).not.toMatch(/^ {4}fourth$/m);
  expect(capped).not.toMatch(/^ {4}first$/m);
});

test("10.3 a corrected ghost keeps its earlier notes, with one marker where the new words begin", () => {
  const p = new Project();
  p.card("auth", "Auth");
  expect(
    p.werk("add", "auth-retry", "--title", "Retry", "--body", "Retry sends a new link", "--parent", "auth").code,
  ).toBe(0);
  p.seed({
    type: "note.added",
    actor: "you",
    payload: { id: "auth-retry", text: "No — retry must reuse the same link" },
  });
  expect(p.werk("say", "auth-retry", "Understood, I will correct it").code).toBe(0);
  expect(p.werk("discard", "auth-retry").code).toBe(0);
  expect(
    p.werk("add", "auth-retry", "--title", "Retry", "--body", "Retry reuses the same link", "--parent", "auth").code,
  ).toBe(0);
  const show = p.werk("show", "auth-retry").out;
  const a = show.indexOf("No — retry must reuse the same link");
  const b = show.indexOf("Understood, I will correct it");
  const m = show.indexOf("proposed again");
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(-1);
  expect(m).toBeGreaterThan(Math.max(a, b));
  expect(show.split("proposed again").length - 1).toBe(1);
  expect(show).toContain("Retry reuses the same link");
  // The person opens the ghost's thread and types a note in the map.
  expectMapServer(p);
});

test("10.4 a note on a discarded ghost stays in the inbox and on the thread", () => {
  const p = new Project();
  expect(p.werk("add", "cache-ttl", "--title", "Cache entries live 60 seconds").code).toBe(0);
  p.seed({ type: "note.added", actor: "you", payload: { id: "cache-ttl", text: "Why 60 seconds?" } });
  expect(p.werk("discard", "cache-ttl").code).toBe(0);
  const inbox = p.werk("inbox").out;
  expect(inbox).toMatch(/#cache-ttl[\s\S]*Why 60 seconds\?/);
  expect(p.werk("add", "cache-ttl", "--title", "Cache entries live 30 seconds").code).toBe(0);
  const show = p.werk("show", "cache-ttl").out;
  expect(show.indexOf("Why 60 seconds?")).toBeGreaterThan(-1);
  expect(show.indexOf("proposed again")).toBeGreaterThan(show.indexOf("Why 60 seconds?"));
  expect(show.split("proposed again").length - 1).toBe(1);
  // The thread in the map.
  expectMapServer(p);
});

test("10.5 an agent writes a note on an excerpt", () => {
  const p = new Project();
  p.seed(
    { type: "node.added", payload: { id: "src-rfc", kind: "source", title: "RFC", url: "https://x.test" } },
    { type: "node.added", payload: { id: "src-rfc-quote", kind: "excerpt", title: "Retries are idempotent" } },
  );
  expect(p.werk("show", "src-rfc-quote").code).toBe(0);
  const say = p.werk("say", "src-rfc-quote", "This quote supports the retry decision");
  expect(say.code).toBe(0);
  expect(p.werk("show", "src-rfc-quote").out).toContain("This quote supports the retry decision");
  // The person opens the excerpt in the map.
  expectMapServer(p);
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", () => {
  const p = new Project();
  p.card("retry", "Retry is safe", { status: "decided" });
  p.seed({ type: "node.added", payload: { id: "rfc", kind: "source", title: "RFC", url: "https://x.test" } });
  // Given: an agent added an excerpt for the card.
  const add = p.werk("add", "rfc-quote", "--kind", "excerpt", "--title", "A retry is idempotent", "--parent", "rfc");
  expect(add.code, add.err).toBe(0);
  expect(p.werk("link", "retry", "rfc-quote", "--type", "supported_by").code).toBe(0);
  expect(p.werk("accept", "rfc-quote", "--actor", "you").code).toBe(0);
  expect(isGhost(p, "rfc-quote")).toBe(false);
  expect(p.werk("show", "retry").out).not.toContain("held");
  expectMapServer(p);
});

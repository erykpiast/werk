import { afterEach, expect, test } from "bun:test";
import { chat, head, isGhost, linkLine } from "./b-helpers.ts";
import { cleanupAll, project } from "./cli.ts";

afterEach(cleanupAll);

test("04.1 new card waits as ghost until accept", () => {
  const p = project();
  p.card("root", "Root");
  p.card("checkout-flow", "Checkout flow", { parent: "root" });
  p.seed("node.proposed", { id: "other-ghost", kind: "card", title: "Other ghost", parent: "root" }, "agent");
  const before = p.lines().length;
  const add = p.werk("add", "retry-payment", "--title", "Retry payment", "--parent", "checkout-flow");
  expect(add.code).toBe(0);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const ev = p.events();
  expect(ev.length).toBe(before + 1);
  expect(ev.at(-1)?.type).toBe("node.proposed");
  expect(ev.at(-1)?.payload.parent).toBe("checkout-flow");
  const show = p.werk("show", "retry-payment");
  expect(show.out.split("\n")[0]).toContain("proposed");
  expect(show.out).toMatch(/parent: checkout-flow\s+Checkout flow/);
  const acc = p.werk("accept", "retry-payment", "--actor", "you");
  expect(acc.code).toBe(0);
  const ev2 = p.events();
  expect(ev2.length).toBe(before + 2);
  expect(ev2.at(-1)?.type).toBe("change.accepted");
  expect(isGhost(p, "retry-payment")).toBe(false);
  expect(p.werk("show", "retry-payment").out).toMatch(/parent: checkout-flow\s+Checkout flow/);
  expect(isGhost(p, "other-ghost")).toBe(true);
});

test("04.2 accept ghost child accepts ghost parent; held link goes live", () => {
  const p = project();
  p.card("root", "Root");
  p.card("payments", "Payments", { parent: "root" });
  p.card("fraud-rules", "Fraud rules", { parent: "root", status: "decided" });
  expect(p.werk("add", "refunds", "--title", "Refunds", "--parent", "payments").code).toBe(0);
  expect(p.werk("add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds").code).toBe(0);
  expect(
    p.werk("link", "partial-refunds", "fraud-rules", "--type", "depends_on", "--why", "limits come from fraud rules")
      .code,
  ).toBe(0);
  expect(
    p.werk("add", "partial-refunds:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "too strict")
      .code,
  ).toBe(0);
  expect(p.werk("link", "partial-refunds:opt0", "partial-refunds", "--type", "alternative_to").code).toBe(0);
  expect(
    p.werk("add", "refund-study", "--kind", "source", "--title", "Refund study", "--finding", "partial wins").code,
  ).toBe(0);
  expect(p.werk("link", "partial-refunds", "refund-study", "--type", "supported_by").code).toBe(0);
  const dep = linkLine(p.werk("show", "partial-refunds").out, "depends_on", "fraud-rules");
  expect(dep).toContain("held");
  const before = p.lines().length;
  expect(p.werk("accept", "partial-refunds", "--actor", "you").code).toBe(0);
  const added = p.events().slice(before);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((e) => e.type === "change.accepted")).toBe(true);
  expect(isGhost(p, "refunds")).toBe(false);
  expect(isGhost(p, "partial-refunds")).toBe(false);
  expect(isGhost(p, "partial-refunds:opt0")).toBe(false);
  expect(isGhost(p, "refund-study")).toBe(false);
  const dep2 = linkLine(p.werk("show", "partial-refunds").out, "depends_on", "fraud-rules");
  expect(dep2).toBeDefined();
  expect(dep2).not.toContain("held");
});

test("04.3 discarding ghost parent drops ghost children", () => {
  const p = project();
  p.card("root", "Root");
  p.card("onboarding", "Onboarding", { parent: "root" });
  p.werk("add", "email-verification", "--title", "Email verification", "--parent", "onboarding");
  p.werk("add", "resend-email", "--title", "Resend email", "--parent", "email-verification");
  expect(p.werk("discard", "email-verification").code).toBe(0);
  const a = p.werk("show", "email-verification");
  const b = p.werk("show", "resend-email");
  expect(a.code).not.toBe(0);
  expect(a.all).toMatch(/no node #email-verification in the map/);
  expect(b.code).not.toBe(0);
  expect(b.all).toMatch(/no node #resend-email in the map/);
  const on = p.werk("show", "onboarding").out;
  expect(on).not.toContain("ghost");
});

test("04.4 ghost words frozen against re-add", () => {
  const p = project();
  p.card("root", "Root");
  p.card("search", "Search", { parent: "root" });
  p.werk("add", "search-index", "--title", "Search index", "--why", "Lookups must be fast", "--parent", "search");
  const before = p.raw();
  const r = p.werk(
    "add",
    "search-index",
    "--title",
    "Another index",
    "--why",
    "Different reason",
    "--parent",
    "search",
  );
  expect(r.code).not.toBe(0);
  expect(r.all).toMatch(/ghost's words are frozen/);
  expect(p.raw()).toBe(before);
  const s = p.werk("show", "search-index").out;
  expect(s).toContain("Search index");
  expect(s).toContain("why: Lookups must be fast");
});

test("04.5 accept needs --actor you", () => {
  const p = project();
  p.card("root", "Root");
  p.werk("add", "audit-log", "--title", "Audit log", "--parent", "root");
  const before = p.raw();
  const r = p.werk("accept", "audit-log");
  expect(r.code).not.toBe(0);
  expect(p.raw()).toBe(before);
  expect(isGhost(p, "audit-log")).toBe(true);
  expect(p.werk("accept", "audit-log", "--actor", "you").code).toBe(0);
  expect(isGhost(p, "audit-log")).toBe(false);
});

test("62.1 propose then accept, log append only", () => {
  const p = project();
  p.card("root", "Root");
  p.card("x", "Existing", { parent: "root" });
  const before = p.lines();
  const add = p.werk(
    "add",
    "use-log",
    "--title",
    "Use a log",
    "--body",
    "Every write appends",
    "--why",
    "History stays",
    "--parent",
    "root",
  );
  expect(add.out).toContain("proposed");
  const after = p.lines();
  expect(after.length).toBe(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const s = p.werk("show", "use-log").out;
  expect(s).toContain("Use a log");
  expect(s).toContain("Every write appends");
  expect(s).toContain("History stays");
  expect(s.split("\n")[0]).toContain("proposed");
  const acc = p.werk("accept", "use-log", "--actor", "you");
  expect(acc.code).toBe(0);
  const after2 = p.lines();
  expect(after2.length).toBe(after.length + 1);
  expect(after2.slice(0, after.length)).toEqual(after);
  const s2 = p.werk("show", "use-log").out;
  expect(s2).toContain("Use a log");
  expect(s2).toContain("Every write appends");
  expect(s2).toContain("History stays");
  expect(s2.split("\n")[0]).not.toMatch(/proposed|ghost/);
});

test("62.2 accept without claim refuses", () => {
  const p = project();
  p.card("root", "Root");
  p.werk("add", "c", "--title", "A card", "--parent", "root");
  const before = p.raw();
  expect(p.werk("accept", "c").code).not.toBe(0);
  expect(p.raw()).toBe(before);
  expect(isGhost(p, "c")).toBe(true);
  expect(p.werk("accept", "c", "--actor", "you").code).toBe(0);
  expect(isGhost(p, "c")).toBe(false);
});

test("62.3 ghost words frozen: edit body, retitle, re-add", () => {
  const p = project();
  p.card("root", "Root");
  p.werk("add", "use-log", "--title", "Use a log", "--parent", "root");
  let before = p.raw();
  expect(p.werk("edit", "use-log", "--body", "new body").code).not.toBe(0);
  expect(p.raw()).toBe(before);
  before = p.raw();
  expect(p.werk("retitle", "use-log", "Use an append-only log").code).not.toBe(0);
  expect(p.raw()).toBe(before);
  before = p.raw();
  expect(p.werk("add", "use-log", "--title", "Other title", "--parent", "root").code).not.toBe(0);
  expect(p.raw()).toBe(before);
  const s = p.werk("show", "use-log").out;
  expect(s).toContain("Use a log");
  expect(s.split("\n")[0]).toContain("proposed");
});

test("62.4 retitle a real card", () => {
  const p = project();
  p.card("root", "Root");
  p.werk("add", "use-log", "--title", "Use a log", "--parent", "root");
  p.werk("accept", "use-log", "--actor", "you");
  const before = p.lines();
  const r = p.werk("retitle", "use-log", "Use an append-only log");
  expect(r.code).toBe(0);
  const after = p.lines();
  expect(after.length).toBe(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const s = p.werk("show", "use-log").out;
  expect(s).toContain("Use an append-only log");
  expect(s.split("\n").some((l) => l.trim() === "Use a log")).toBe(false);
  expect(s).not.toMatch(/Use a log(?!\w)/);
  expect(p.raw()).toContain('"title":"Use a log"');
  const e = p.werk("edit", "use-log", "--body", "Writes only append");
  expect(e.code).toBe(0);
  const s2 = p.werk("show", "use-log").out;
  expect(s2).toContain("Writes only append");
  expect(s2).toContain("Use an append-only log");
});

test("62.5 option, source, excerpt enter as ghosts", () => {
  const p = project();
  p.card("root", "Root");
  p.card("store", "Store the map", { parent: "root" });
  chat(p, "talk", [
    { speaker: "person", at: "2026-10-01T00:00:00Z", session: "s1", kind: "spoken", text: "we keep one log forever" },
  ]);
  const steps: [string[], string][] = [
    [
      ["add", "store:opt0", "--kind", "option", "--title", "Use a database", "--why_not", "needs a server"],
      "store:opt0",
    ],
    [
      [
        "add",
        "log-paper",
        "--kind",
        "source",
        "--title",
        "Log paper",
        "--url",
        "https://example.com",
        "--finding",
        "logs are simple",
      ],
      "log-paper",
    ],
    [["quote", "store", "talk", "one log forever"], "store:ex0"],
  ];
  for (const [args] of steps) {
    const before = p.lines();
    const r = p.werk(...args);
    expect(r.code).toBe(0);
    expect(r.out).toContain("proposed");
    const after = p.lines();
    expect(after.length).toBe(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
  }
  const o = p.werk("show", "store:opt0").out;
  expect(o).toContain("Use a database");
  expect(o).toContain("why not: needs a server");
  expect(o.split("\n")[0]).toContain("proposed");
  const s = p.werk("show", "log-paper").out;
  expect(s).toContain("Log paper");
  expect(s).toContain("logs are simple");
  expect(s.split("\n")[0]).toContain("proposed");
  const x = p.werk("show", "store:ex0").out;
  expect(x).toContain("one log forever");
  expect(x.split("\n")[0]).toContain("proposed");
  expect(p.werk("accept", "store:opt0", "--actor", "you").code).toBe(0);
  const o2 = p.werk("show", "store:opt0").out;
  expect(o2.split("\n")[0]).not.toContain("proposed");
  expect(o2).toContain("why not: needs a server");
  expect(isGhost(p, "log-paper")).toBe(true);
  expect(isGhost(p, "store:ex0")).toBe(true);
});

test("63.1 link to ghost held, live on accept, one link event", () => {
  const p = project();
  p.card("root", "Root");
  p.card("storage", "Storage", { parent: "root", status: "decided" });
  p.werk("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  // "as its basis": werk's basis link is depends_on.
  const l = p.werk("link", "use-sqlite", "storage", "--type", "depends_on", "--why", "SQLite is the storage");
  expect(l.code).toBe(0);
  expect(linkLine(p.werk("show", "use-sqlite").out, "depends_on", "storage")).toContain("held");
  const st = linkLine(p.werk("show", "storage").out, "depends_on", "use-sqlite");
  expect(st === undefined || st.includes("held")).toBe(true);
  p.werk("accept", "use-sqlite", "--actor", "you");
  const live = linkLine(p.werk("show", "use-sqlite").out, "depends_on", "storage");
  expect(live).toBeDefined();
  expect(live).not.toContain("held");
  expect(
    p.events().filter((e) => e.type === "edge.added" && e.payload.from === "use-sqlite" && e.payload.to === "storage")
      .length,
  ).toBe(1);
});

test("63.2 accept child takes ghost parent, not ghost dependency", () => {
  const p = project();
  p.card("root", "Root");
  p.card("platform", "Platform", { parent: "root" });
  p.werk("add", "auth", "--title", "Auth", "--parent", "platform");
  p.werk("add", "magic-links", "--title", "Magic links", "--parent", "auth");
  p.werk("add", "email-service", "--title", "Email service", "--parent", "platform");
  expect(p.werk("link", "magic-links", "email-service", "--type", "depends_on", "--why", "sends the link").code).toBe(
    0,
  );
  expect(p.werk("accept", "magic-links", "--actor", "you").code).toBe(0);
  expect(isGhost(p, "magic-links")).toBe(false);
  expect(isGhost(p, "auth")).toBe(false);
  expect(p.werk("show", "auth").out).toMatch(/parent: platform/);
  expect(isGhost(p, "email-service")).toBe(true);
  expect(linkLine(p.werk("show", "magic-links").out, "depends_on", "email-service")).toContain("held");
});

test("63.3 accept takes own ghost options and sources", () => {
  const p = project();
  p.card("root", "Root");
  p.card("storage", "Storage", { parent: "root", status: "decided" });
  p.werk("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  p.werk("add", "use-sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server");
  p.werk("link", "use-sqlite:opt0", "use-sqlite", "--type", "alternative_to");
  p.werk("add", "benchmark-notes", "--kind", "source", "--title", "Benchmark notes", "--finding", "fast enough");
  p.werk("link", "use-sqlite", "benchmark-notes", "--type", "supported_by");
  const who = p.werk("edit", "use-sqlite", "--who", "me");
  p.werk("kill", "use-sqlite", "--revisit");
  const st = p.werk("status", "use-sqlite", "decided");
  expect(p.werk("accept", "use-sqlite", "--actor", "you").code).toBe(0);
  const s = p.werk("show", "use-sqlite").out;
  expect(s.split("\n")[0]).toContain("[decided]");
  expect(s.split("\n")[0]).not.toContain("proposed");
  expect(s).toContain("who: me");
  const o = p.werk("show", "use-sqlite:opt0").out;
  expect(o.split("\n")[0]).not.toContain("proposed");
  expect(o).toContain("why not: needs a server");
  expect(isGhost(p, "benchmark-notes")).toBe(false);
  const l = linkLine(s, "supported_by", "benchmark-notes");
  expect(l).toBeDefined();
  expect(l).not.toContain("held");
  expect(who.code).toBe(0);
  expect(st.code).toBe(0);
});

test("63.4 discard ghost parent discards whole branch", () => {
  const p = project();
  p.card("root", "Root");
  p.card("platform", "Platform", { parent: "root" });
  p.werk("add", "auth", "--title", "Auth", "--parent", "platform");
  p.werk("add", "magic-links", "--title", "Magic links", "--parent", "auth");
  p.werk("add", "magic-links:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "leaks");
  p.werk("link", "magic-links:opt0", "magic-links", "--type", "alternative_to");
  expect(p.werk("discard", "auth").code).toBe(0);
  for (const id of ["auth", "magic-links", "magic-links:opt0"]) expect(p.werk("show", id).code).not.toBe(0);
  const s = p.werk("show", "platform").out;
  expect(s.split("\n")[0]).not.toContain("proposed");
  expect(s).not.toContain("ghost");
  expect(p.werk("search", "Passwords").out).not.toContain("Passwords");
});

test("63.5 ghost changes no count until accepted", () => {
  const p = project();
  p.card("root", "Root");
  p.card("storage", "Storage", { parent: "root", status: "decided" });
  p.card("disk", "Disk files", { parent: "storage", status: "decided" });
  const sub = (o: string) => o.split("\n").find((l) => l.startsWith("subtree:"));
  const unch = (o: string) => o.split("\n").find((l) => /unchallenged/i.test(l)) ?? "";
  const s0 = p.werk("show", "storage").out;
  expect(head(p, "storage")).not.toMatch(/stale|paused/);
  p.werk("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage", "--who", "me");
  p.werk("add", "use-sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "server");
  p.werk("link", "use-sqlite:opt0", "use-sqlite", "--type", "alternative_to");
  p.werk("kill", "use-sqlite", "--revisit");
  expect(p.werk("status", "use-sqlite", "decided").code).toBe(0);
  const s1 = p.werk("show", "storage").out;
  expect(sub(s1)).toBe(sub(s0));
  expect(unch(s1)).toBe(unch(s0));
  expect(head(p, "storage")).not.toMatch(/stale|paused/);
  p.werk("accept", "use-sqlite", "--actor", "you");
  expect(sub(p.werk("show", "storage").out)).toContain("3 cards");
});

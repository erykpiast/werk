import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { decided, decidedRaw, ghost, link, logLines, open, reopen, seed, useProject } from "./support.ts";

const ctx = useProject();

// ---------- 06 ----------

test("06.1 an excerpt for a decided card stages as a ghost with a pending link", async () => {
  const { project, werk } = ctx;
  seed(project, decided("card"));
  // The agent adds an excerpt that supports the card, through the command line.
  const added = await werk("add", "quote", "--kind", "excerpt", "--title", "Ann said so");
  expect(added.stdout.trim()).toBe("proposed");
  expect(added.code).toBe(0);
  const linked = await werk("link", "card", "quote", "--type", "supported_by", "--why", "she said it");
  expect(linked.code).toBe(0);
  const shown = await werk("show", "card");
  expect(shown.stdout).toContain("[decided]");
  expect(shown.stdout).toContain("supported_by");
  expect(shown.stdout).toContain("[proposed]");
  expect(shown.stdout).toContain("[held]");
});

test("06.2 an accepted excerpt is no ghost and its link is live", async () => {
  const { project, werk } = ctx;
  seed(project, decided("card"), ghost("quote", { kind: "excerpt", title: "Ann said so" }), link("card", "quote", "supported_by"));
  const before = await werk("show", "card");
  expect(before.stdout).toContain("[held]");
  const accepted = await werk("accept", "quote", "--actor", "you");
  expect(accepted.code).toBe(0);
  const shown = await werk("show", "card");
  expect(shown.stdout).toContain("supported_by");
  expect(shown.stdout).toContain("quote");
  expect(shown.stdout).not.toContain("[proposed]");
  expect(shown.stdout).not.toContain("[held]");
});

// ---------- 08 ----------

function authMap() {
  return [
    decided("auth"),
    decided("login", { parent: "auth" }),
    decided("session", { parent: "auth" }),
    decided("audit"),
    link("login", "audit"),
  ];
}

test("08.1 remove takes the subtree in one step, restore brings it back", async () => {
  const { project, werk } = ctx;
  seed(project, authMap());
  const before = logLines(project);
  const removed = await werk("remove", "auth", "--actor", "you");
  expect(removed.code).toBe(0);
  for (const id of ["auth", "login", "session"]) {
    expect((await werk("show", id)).code).toBe(1);
  }
  expect(logLines(project)).toBe(before + 1);
  const list = await werk("removed");
  expect(list.code).toBe(0);
  expect(list.stdout).toContain("auth");
  expect(list.stdout).toContain("login");
  expect(list.stdout).toContain("session");
  expect((await werk("show", "audit")).stdout).not.toContain("login");
  const restored = await werk("restore", "auth", "--actor", "you");
  expect(restored.code).toBe(0);
  const auth = await werk("show", "auth");
  expect(auth.stdout).toContain("login");
  expect(auth.stdout).toContain("session");
  expect((await werk("show", "audit")).stdout).toContain("login");
  expect((await werk("removed")).stdout.trim()).toBe("");
});

test("08.2 remove --reparent moves the children up, restore puts them back", async () => {
  const { project, werk } = ctx;
  seed(project, decided("platform"), decided("auth", { parent: "platform" }), decided("login", { parent: "auth" }), decided("session", { parent: "auth" }));
  const removed = await werk("remove", "auth", "--actor", "you", "--reparent");
  expect(removed.code).toBe(0);
  expect((await werk("show", "auth")).code).toBe(1);
  const platform = (await werk("show", "platform")).stdout;
  expect(platform).toContain("login");
  expect(platform).toContain("session");
  expect((await werk("restore", "auth", "--actor", "you")).code).toBe(0);
  const after = (await werk("show", "platform")).stdout;
  expect(after).toContain("auth");
  expect(after).not.toMatch(/<- refines\s+login/);
  expect((await werk("show", "auth")).stdout).toContain("login");
});

test("08.3 a link waits until both of its ends are back", async () => {
  const { project, werk } = ctx;
  seed(project, decided("login"), decided("session"), link("login", "session"));
  expect((await werk("remove", "login", "--actor", "you")).code).toBe(0);
  expect((await werk("remove", "session", "--actor", "you")).code).toBe(0);
  expect((await werk("restore", "login", "--actor", "you")).code).toBe(0);
  expect((await werk("show", "login")).code).toBe(0);
  expect((await werk("show", "login")).stdout).not.toContain("session");
  expect((await werk("restore", "session", "--actor", "you")).code).toBe(0);
  expect((await werk("show", "login")).stdout).toContain("session");
});

test("08.4 a removed id stays taken and a shared source stays", async () => {
  const { project, werk } = ctx;
  seed(project, decided("login"), decided("billing"), open("rfc-6749").map((e) => (e as { type: string }).type === "node.proposed" ? { ...(e as object), kind: "source", title: "RFC 6749" } : e), link("login", "rfc-6749", "supported_by"), link("billing", "rfc-6749", "supported_by"));
  expect((await werk("remove", "login", "--actor", "you")).code).toBe(0);
  const billing = await werk("show", "billing");
  expect(billing.stdout).toContain("rfc-6749");
  const before = logLines(project);
  const again = await werk("add", "login", "--title", "New login");
  expect(again.code).not.toBe(0);
  expect(again.stderr).toContain("restore");
  expect(again.stderr).toContain("login");
  expect(logLines(project)).toBe(before);
});

test("08.5 remove without --actor you refuses and writes nothing", async () => {
  const { project, werk } = ctx;
  seed(project, decided("login"));
  const before = logLines(project);
  const result = await werk("remove", "login");
  expect(result.code).not.toBe(0);
  expect((await werk("show", "login")).code).toBe(0);
  expect(logLines(project)).toBe(before);
});

test("08.6 restore without --actor you refuses and writes nothing", async () => {
  const { project, werk } = ctx;
  seed(project, decided("login"));
  expect((await werk("remove", "login", "--actor", "you")).code).toBe(0);
  const before = logLines(project);
  const result = await werk("restore", "login");
  expect(result.code).not.toBe(0);
  expect((await werk("show", "login")).code).toBe(1);
  expect(logLines(project)).toBe(before);
});

// ---------- 09 ----------

test("09.1 search with no term lists the decided cards only", async () => {
  const { project, werk } = ctx;
  seed(project, decided("d1"), decided("d2"), decided("d3"), open("o1"), ghost("g1", { status: "decided" }));
  const result = await werk("search");
  expect(result.code).toBe(0);
  const lines = result.stdout.trim().split("\n");
  expect(lines).toHaveLength(3);
  for (const id of ["d1", "d2", "d3"]) expect(result.stdout).toContain(`${id}  Title ${id}`);
  expect(result.stdout).not.toContain("o1");
  expect(result.stdout).not.toContain("g1");
});

test("09.2 search with two terms ranks by hits", async () => {
  const { project, werk } = ctx;
  seed(
    project,
    decided("cache-layout", { title: "Cache layout", body: "Cache eviction and the eviction policy" }),
    open("eviction-timer", { title: "Eviction timer", why: "eviction", body: "CACHE warmup" }),
    decided("cache-size", { title: "Cache size", why: "cache" }),
    open("gone", { title: "Gone", body: "cache eviction" }),
    { type: "node.removed", id: "gone" },
  );
  const result = await werk("search", "cache", "eviction");
  expect(result.code).toBe(0);
  const lines = result.stdout.trim().split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain("cache-layout");
  expect(lines[0]).toContain("decided");
  expect(lines[0]).toContain("Cache layout");
  expect(lines[1]).toContain("eviction-timer");
  expect(lines[1]).toContain("open");
  expect(result.stdout).not.toContain("cache-size");
  expect(result.stdout).not.toContain("gone");
});

test("09.3 search finds a word in a rejected option and narrows", async () => {
  const { project, werk } = ctx;
  seed(
    project,
    decided("parent-topic", { title: "Parent topic" }),
    decided("storage", { title: "Storage format", parent: "parent-topic" }),
    open("opt", { kind: "option", title: "Use the database", why: "SQLite needs a native build" }),
    link("opt", "storage", "alternative_to"),
    open("elsewhere", { title: "Elsewhere", body: "we could use sqlite here" }),
  );
  const all = await werk("search", "sqlite");
  expect(all.stdout).toContain("storage");
  expect(all.stdout).toContain("decided");
  expect(all.stdout).toContain("elsewhere");
  const under = await werk("search", "sqlite", "--under", "parent-topic");
  expect(under.stdout.trim().split("\n")).toHaveLength(1);
  expect(under.stdout).toContain("storage");
  const status = await werk("search", "sqlite", "--status", "decided");
  expect(status.stdout.trim().split("\n")).toHaveLength(1);
  expect(status.stdout).toContain("storage");
});

function clientMap() {
  return [
    decided("client", { title: "Client" }),
    open("routing", { title: "Routing", parent: "client" }),
    open("theme", { title: "Theme", parent: "client", status: "proto" }),
    open("guards", { title: "Route guards", parent: "routing" }),
    // a stale card: it depends on a card that was reopened as invalidated
    decided("x1", { title: "X1" }),
    open("stale-one", { title: "Stale one", parent: "client" }),
    link("stale-one", "x1"),
    reopen("x1", { reason: "invalidated" }),
    // a paused card: it depends on a card that was postponed
    decided("x2", { title: "X2" }),
    open("paused-one", { title: "Paused one", parent: "client" }),
    link("paused-one", "x2"),
    reopen("x2", { reason: "postponed" }),
    // a postponed card
    decided("post-one", { title: "Post one", parent: "client" }),
    reopen("post-one", { reason: "postponed" }),
    open("opt", { kind: "option", title: "An option" }),
    link("opt", "routing", "alternative_to"),
    open("src", { kind: "source", title: "A source" }),
    link("routing", "src", "supported_by"),
    open("billing", { title: "Billing" }),
  ];
}

test("09.4 find lists the open work under one card", async () => {
  const { project, werk } = ctx;
  seed(project, clientMap());
  const routing = await werk("find", "routing");
  const lines = routing.stdout.trim().split("\n");
  expect(lines[0]).toContain("routing");
  expect(lines[1]).toContain("guards");
  expect(routing.stdout).not.toContain("billing");
  expect(routing.stdout).not.toContain("An option");
  expect(routing.stdout).not.toContain("A source");
  const client = await werk("find", "client");
  const text = client.stdout;
  expect(text.indexOf("routing")).toBeGreaterThanOrEqual(0);
  expect(text.indexOf("theme")).toBeGreaterThanOrEqual(0);
  expect(text.indexOf("routing")).toBeLessThan(text.indexOf("guards"));
  expect(text.indexOf("theme")).toBeLessThan(text.indexOf("guards"));
  expect(text).not.toMatch(/^client /m);
  for (const id of ["stale-one", "paused-one", "post-one"]) expect(text).not.toContain(id);
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const { project, werk } = ctx;
  seed(
    project,
    decided("r1", { title: "Root one" }),
    open("o1", { title: "Open one", parent: "r1" }),
    decided("r2", { title: "Root two" }),
    open("o2", { title: "Open two", parent: "r2" }),
    decided("auth-flow", { title: "Auth flow" }),
    reopen("auth-flow", { reason: "rejected" }),
  );
  const result = await werk("find");
  expect(result.stdout).toContain("o1");
  expect(result.stdout).toContain("o2");
  expect(result.stdout).toContain("auth-flow");
  expect(result.stdout).not.toContain("[decided]");
});

// ---------- 11 ----------

const rollupOf = (text: string) => text.split("\n").filter((l) => /rollup|\d+ cards?/i.test(l));

test("11.1 the rollup counts the card and its refines subtree", async () => {
  const { project, werk } = ctx;
  seed(
    project,
    decided("root", { title: "Root" }),
    open("c1", { title: "C1", parent: "root" }),
    open("c2", { title: "C2", parent: "root", status: "proto" }),
    decidedRaw("g1", { title: "G1", parent: "c1" }),
  );
  const out = (await werk("show", "root")).stdout;
  const lines = rollupOf(out);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/4 cards/);
  expect(lines[0]).toMatch(/1 open/);
  expect(lines[0]).toMatch(/1 proto/);
  expect(lines[0]).toMatch(/2 decided/);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const { project, werk } = ctx;
  seed(
    project,
    decided("parent", { title: "Parent" }),
    open("child", { title: "Child", parent: "parent" }),
    open("g1", { title: "G1", parent: "child" }),
    decidedRaw("g2", { title: "G2", parent: "child" }),
  );
  const out = (await werk("show", "parent")).stdout;
  const incoming = out.split("\n").find((l) => l.includes("<- refines") && l.includes("child"));
  expect(incoming).toBeDefined();
  expect(incoming).toMatch(/3 cards/);
  expect(out).toMatch(/4 cards/);
});

test("11.3 a card prints options, excerpts and a proposed source with their words", async () => {
  const { project, werk } = ctx;
  seed(
    project,
    decided("other", { title: "Other" }),
    decided("card", { title: "Card" }),
    link("card", "other"),
    open("opt", { kind: "option", title: "Use files", why: "files do not scale" }),
    link("opt", "card", "alternative_to"),
    open("quote", { kind: "excerpt", title: "Ann", body: "We want it simple" }),
    link("card", "quote", "supported_by"),
    ghost("src", { kind: "source", title: "Study X", why: "users want it" }),
    link("card", "src", "supported_by"),
  );
  const out = (await werk("show", "card")).stdout;
  expect(out).toContain("card takes other");
  const lines = out.split("\n");
  const at = (heading: RegExp) => lines.findIndex((l) => heading.test(l));
  expect(at(/^Options\b/)).toBeGreaterThan(at(/depends_on/));
  expect(out).toContain("Use files");
  expect(out).toContain("files do not scale");
  expect(at(/^Say\b/)).toBeGreaterThanOrEqual(0);
  expect(out).toContain("We want it simple");
  expect(at(/^Ev\b/)).toBeGreaterThanOrEqual(0);
  expect(out).toContain("Study X");
  expect(out).toMatch(/Study X[^\n]*proposed/);
});

test("11.4 a card with no options prints no Options section", async () => {
  const { project, werk } = ctx;
  seed(
    project,
    decided("card", { title: "Card" }),
    open("quote", { kind: "excerpt", title: "Ann", body: "We want it simple" }),
    link("card", "quote", "supported_by"),
    open("src", { kind: "source", title: "Study X" }),
    link("card", "src", "supported_by"),
  );
  const out = (await werk("show", "card")).stdout;
  expect(out).toMatch(/^Say\b/m);
  expect(out).toMatch(/^Ev\b/m);
  expect(out).not.toMatch(/^Options\b/m);
});

test("11.5 show with no id prints the root card", async () => {
  const { project, werk } = ctx;
  seed(project, decided("root", { title: "The root" }), open("second", { title: "Second", parent: "root" }));
  const result = await werk("show");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("The root");
  expect(result.stdout).toMatch(/2 cards/);
  expect(result.stdout).toMatch(/<- refines\s+second/);
  void readFileSync;
});

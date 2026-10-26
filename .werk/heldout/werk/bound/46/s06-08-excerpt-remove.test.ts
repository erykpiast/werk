// Scenarios 06.1, 06.2 (excerpts) and 08.1 - 08.6 (remove and restore).
import { expect, test } from "bun:test";
import { freshProject, lines, type Project, real, seed } from "./helpers.ts";

const headerOf = (out: string) => out.split("\n")[0] ?? "";

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

const decided = (id: string, title: string, extra: object = {}) => real(id, title, { status: "decided", who: "me", ...extra });

test("06.1 a new excerpt for a card stages as a ghost", async () => {
  const p = freshProject();
  seed(p, [decided("retry", "Retry once"), { type: "kill.added", payload: { id: "retry", criterion: { form: "revisit" } } }]);
  // The agent adds an excerpt that supports the card. The only add verb is `werk add`.
  const add = await p.werk([
    "add",
    "retry-quote",
    "--kind",
    "excerpt",
    "--title",
    "A retry is safe once",
    "--finding",
    "RFC says one retry is safe",
  ]);
  expect({ code: add.code, out: add.out, err: add.err }).toMatchObject({ code: 0 });
  expect(add.out).toContain("proposed");
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
  const p = freshProject();
  // Given: no verb adds an excerpt, so the ghost excerpt and its held link are seeded in the log.
  seed(p, [
    decided("retry", "Retry once", { no_basis: "top" }),
    { type: "kill.added", payload: { id: "retry", criterion: { form: "revisit" } } },
    { type: "node.proposed", actor: "agent", payload: { id: "retry-quote", kind: "excerpt", title: "A retry is safe once" } },
    { type: "edge.added", actor: "agent", payload: { from: "retry", to: "retry-quote", type: "supported_by" } },
  ]);
  expect(headerOf((await ok(p, ["show", "retry-quote"])).out)).toContain("proposed");
  // The person's check mark is the accept with --actor you.
  await ok(p, ["accept", "retry-quote", "--actor", "you"]);
  expect(headerOf((await ok(p, ["show", "retry-quote"])).out)).not.toContain("proposed");
  const show = await ok(p, ["show", "retry"]);
  const line = show.out.split("\n").find((each) => each.includes("supported_by") && each.includes("retry-quote"));
  expect(line).toBeDefined();
  expect(line).not.toContain("held");
});

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const p = freshProject();
  seed(p, [
    decided("auth", "Auth", { no_basis: "top" }),
    real("login", "Login", { parent: "auth" }),
    real("session", "Session", { parent: "auth" }),
    real("audit", "Audit"),
    { type: "edge.added", payload: { from: "login", to: "audit", type: "depends_on", why: "login events are audited" } },
  ]);
  expect((await ok(p, ["show", "audit"])).out).toContain("login");
  const n = lines(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  for (const id of ["auth", "login", "session"]) expect((await p.werk(["show", id])).code).toBe(1);
  const added = lines(p).slice(n);
  expect(added.length).toBe(1);
  expect(added[0]?.type).toBe("node.removed");
  const removed = (await ok(p, ["removed"])).out;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect((await ok(p, ["show", "audit"])).out).not.toContain("login");

  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).code).toBe(0);
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "audit"])).out).toContain("login");
  const after = (await ok(p, ["removed"])).out;
  expect(after).not.toContain("auth");
  expect(after).not.toContain("login");
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  const p = freshProject();
  seed(p, [
    real("platform", "Platform"),
    real("auth", "Auth", { parent: "platform" }),
    real("login", "Login", { parent: "auth" }),
    real("session", "Session", { parent: "auth" }),
  ]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect((await p.werk(["show", "auth"])).code).toBe(1);
  expect((await ok(p, ["show", "login"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: platform");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
});

test("08.3 a link waits until both of its ends are back", async () => {
  const p = freshProject();
  seed(p, [
    real("a", "Branch A"),
    real("b", "Branch B"),
    real("login", "Login", { parent: "a" }),
    real("session", "Session", { parent: "b" }),
    { type: "edge.added", payload: { from: "login", to: "session", type: "depends_on", why: "a login opens a session" } },
  ]);
  expect((await ok(p, ["show", "login"])).out).toContain("session");
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const login = await ok(p, ["show", "login"]);
  expect(login.out).not.toContain("session");
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toContain("session");
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const p = freshProject();
  seed(p, [
    real("login", "Login"),
    real("billing", "Billing"),
    { type: "node.added", payload: { id: "rfc-6749", kind: "source", title: "OAuth 2.0", url: "https://example.com/rfc6749" } },
    { type: "edge.added", payload: { from: "login", to: "rfc-6749", type: "supported_by" } },
    { type: "edge.added", payload: { from: "billing", to: "rfc-6749", type: "supported_by" } },
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const source = await ok(p, ["show", "rfc-6749"]);
  expect(source.out).toContain("billing");
  const n = lines(p).length;
  const add = await p.werk(["add", "login", "--title", "New login"]);
  expect(add.code).not.toBe(0);
  expect(add.err).toContain("restore #login");
  expect(lines(p).length).toBe(n);
  expect((await p.werk(["show", "login"])).code).toBe(1);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const p = freshProject();
  seed(p, [real("login", "Login")]);
  const n = lines(p).length;
  const run = await p.werk(["remove", "login"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("refused");
  expect((await p.werk(["show", "login"])).code).toBe(0);
  expect(lines(p).length).toBe(n);
});

test("08.6 restore refuses without --actor you", async () => {
  const p = freshProject();
  seed(p, [real("login", "Login")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const n = lines(p).length;
  const run = await p.werk(["restore", "login"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("refused");
  expect((await p.werk(["show", "login"])).code).toBe(1);
  expect(lines(p).length).toBe(n);
});

export { headerOf };

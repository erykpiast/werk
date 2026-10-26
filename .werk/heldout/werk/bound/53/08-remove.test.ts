// Held-out steps 08.x: remove takes a subtree out in one step, and a restore undoes it.
import { expect, test } from "bun:test";
import { card, decided, events, lines, ok, type Project, seeded } from "./helpers.ts";

const edge = (from: string, to: string, type: string, why?: string) => ({
  type: "edge.added",
  payload: { from, to, type, ...(why ? { why } : {}) },
});

/** Every CLI view where a card can show: show, search with no term and with its title word, find. */
async function shows(p: Project, id: string, word: string): Promise<boolean> {
  const show = await p.werk(["show", id]);
  if (show.code === 0) return true;
  const all = `${(await p.werk(["search"])).out}${(await p.werk(["search", word])).out}${(await p.werk(["find"])).out}`;
  return new RegExp(`(^|\\s|#)${id}(\\s|$)`, "m").test(all);
}

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const p = seeded([
    decided("root", "Root"),
    decided("auth", "Auth", { parent: "root" }),
    decided("login", "Login", { parent: "auth" }),
    decided("session", "Session", { parent: "auth" }),
    decided("audit", "Audit", { parent: "root" }),
    edge("login", "audit", "depends_on", "login writes an audit entry"),
  ]);
  expect((await ok(p, ["show", "audit"])).out).toMatch(/<- depends_on +login/);
  const n = lines(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  for (const [id, word] of [["auth", "Auth"], ["login", "Login"], ["session", "Session"]])
    expect(await shows(p, id as string, word as string)).toBe(false);
  const added = events(p).slice(n);
  expect(added.length).toBe(1);
  expect(added[0]).toMatchObject({ type: "node.removed", payload: { id: "auth" } });
  const removed = (await ok(p, ["removed"])).out;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect((await ok(p, ["show", "audit"])).out).not.toContain("login");
  expect((await ok(p, ["show", "root"])).out).not.toMatch(/<- refines +auth/);

  await ok(p, ["restore", "auth", "--actor", "you"]);
  const auth = (await ok(p, ["show", "auth"])).out;
  expect(auth).toMatch(/<- refines +login/);
  expect(auth).toMatch(/<- refines +session/);
  expect((await ok(p, ["show", "audit"])).out).toMatch(/<- depends_on +login/);
  const after = (await ok(p, ["removed"])).out;
  expect(after).not.toContain("auth");
  expect(after).not.toContain("login");
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  const p = seeded([
    card("platform", "Platform"),
    card("auth", "Auth", { parent: "platform" }),
    card("login", "Login", { parent: "auth" }),
    card("session", "Session", { parent: "auth" }),
  ]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect(await shows(p, "auth", "Auth")).toBe(false);
  const platform = (await ok(p, ["show", "platform"])).out;
  expect(platform).toMatch(/<- refines +login/);
  expect(platform).toMatch(/<- refines +session/);
  expect(platform).not.toMatch(/<- refines +auth/);
  expect((await ok(p, ["show", "login"])).out).toContain("parent: platform");

  await ok(p, ["restore", "auth", "--actor", "you"]);
  const back = (await ok(p, ["show", "platform"])).out;
  expect(back).toMatch(/<- refines +auth/);
  expect(back).not.toMatch(/<- refines +login/);
  expect(back).not.toMatch(/<- refines +session/);
  const auth = (await ok(p, ["show", "auth"])).out;
  expect(auth).toContain("parent: platform");
  expect(auth).toMatch(/<- refines +login/);
  expect(auth).toMatch(/<- refines +session/);
});

test("08.3 a link waits until both of its ends are back", async () => {
  const p = seeded([
    card("root", "Root"),
    card("branch-a", "Branch A", { parent: "root" }),
    card("branch-b", "Branch B", { parent: "root" }),
    card("login", "Login", { parent: "branch-a" }),
    card("session", "Session", { parent: "branch-b" }),
    edge("login", "session", "depends_on", "login opens a session"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const login = (await ok(p, ["show", "login"])).out;
  expect(login).not.toContain("session");
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toMatch(/-> depends_on +session/);
  expect((await ok(p, ["show", "session"])).out).toMatch(/<- depends_on +login/);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const p = seeded([
    card("root", "Root"),
    card("login", "Login", { parent: "root" }),
    card("billing", "Billing", { parent: "root" }),
    { type: "node.added", payload: { id: "rfc-6749", kind: "source", title: "RFC 6749", finding: "OAuth 2.0" } },
    edge("login", "rfc-6749", "supported_by"),
    edge("billing", "rfc-6749", "supported_by"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const src = (await ok(p, ["show", "rfc-6749"])).out;
  expect(src).toMatch(/<- supported_by +billing/);
  expect(src).not.toContain("login");
  const n = lines(p).length;
  const add = await p.werk(["add", "login", "--title", "New login", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  expect(`${add.out}${add.err}`).toMatch(/restore[^\n]*login|login[^\n]*restore/);
  expect(lines(p).length).toBe(n);
  expect((await p.werk(["show", "login"])).code).not.toBe(0);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const p = seeded([card("login", "Login")]);
  const n = lines(p).length;
  const run = await p.werk(["remove", "login"]);
  expect(run.code).not.toBe(0);
  expect((await p.werk(["show", "login"])).code).toBe(0);
  expect(lines(p).length).toBe(n);
});

test("08.6 restore refuses without the person's say-so", async () => {
  const p = seeded([card("root", "Root"), card("login", "Login", { parent: "root" })]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const n = lines(p).length;
  const run = await p.werk(["restore", "login"]);
  expect(run.code).not.toBe(0);
  expect(await shows(p, "login", "Login")).toBe(false);
  expect(lines(p).length).toBe(n);
});

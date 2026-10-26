// Held-out steps 08.1-08.6: remove and restore.
import { expect, test } from "bun:test";
import type { Project } from "../src/test/project.ts";
import { card, events, lines, link, ok, seeded } from "./cli-helpers.ts";

/** Every command-line view of the map, joined: the root, the decided index, the open work, and the audit card. */
async function views(p: Project): Promise<string> {
  const out: string[] = [];
  for (const args of [["show", "root"], ["search"], ["find"], ["search", "login"], ["search", "session"]])
    out.push((await ok(p, args)).out);
  return out.join("\n");
}

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const p = seeded([
    card("root", "Root", { status: "decided" }),
    card("auth", "Auth", { status: "decided", parent: "root" }),
    card("login", "Login", { parent: "auth", body: "login body" }),
    card("session", "Session", { parent: "auth", body: "session body" }),
    card("audit", "Audit", { parent: "root" }),
    link("login", "audit", "depends_on", "login writes to the audit"),
  ]);
  const before = lines(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  for (const id of ["auth", "login", "session"]) expect((await p.werk(["show", id])).code).not.toBe(0);
  const all = await views(p);
  for (const word of ["auth", "Auth", "login", "Login", "session", "Session"]) expect(all).not.toContain(word);
  expect(lines(p).length).toBe(before + 1);
  expect(events(p).at(-1)?.type).toBe("node.removed");
  const removed = (await ok(p, ["removed"])).out;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect((await ok(p, ["show", "audit"])).out).not.toContain("login");

  await ok(p, ["restore", "auth", "--actor", "you"]);
  const auth = (await ok(p, ["show", "auth"])).out;
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
  expect((await ok(p, ["show", "audit"])).out).toMatch(/<- depends_on\s+login/);
  expect((await ok(p, ["removed"])).out).not.toMatch(/auth|login|session/);
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  const p = seeded([
    card("platform", "Platform", { status: "decided" }),
    card("auth", "Auth", { parent: "platform" }),
    card("login", "Login", { parent: "auth" }),
    card("session", "Session", { parent: "auth" }),
  ]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect((await p.werk(["show", "auth"])).code).not.toBe(0);
  const platform = (await ok(p, ["show", "platform"])).out;
  expect(platform).not.toMatch(/\bauth\b/);
  expect(platform).toMatch(/<- refines\s+login/);
  expect(platform).toMatch(/<- refines\s+session/);
  expect((await ok(p, ["show", "login"])).out).toContain("parent: platform");

  await ok(p, ["restore", "auth", "--actor", "you"]);
  const after = (await ok(p, ["show", "platform"])).out;
  expect(after).toMatch(/<- refines\s+auth/);
  expect(after).not.toMatch(/<- refines\s+login/);
  expect(after).not.toMatch(/<- refines\s+session/);
  const auth = (await ok(p, ["show", "auth"])).out;
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both of its ends are back", async () => {
  const p = seeded([
    card("root", "Root"),
    card("a", "Branch A", { parent: "root" }),
    card("b", "Branch B", { parent: "root" }),
    card("login", "Login", { parent: "a" }),
    card("session", "Session", { parent: "b" }),
    link("login", "session", "depends_on", "login opens a session"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const login = (await ok(p, ["show", "login"])).out;
  expect(login).toContain("Login");
  expect(login).not.toContain("session");
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toMatch(/-> depends_on\s+session/);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const p = seeded([
    card("root", "Root"),
    card("login", "Login", { parent: "root" }),
    card("billing", "Billing", { parent: "root" }),
    ["node.added", { id: "rfc-6749", kind: "source", title: "OAuth 2.0", url: "https://example.com", finding: "f" }],
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const source = (await ok(p, ["show", "rfc-6749"])).out;
  expect(source).toContain("billing");
  const before = lines(p).length;
  const add = await p.werk(["add", "login", "--title", "New login", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  expect(add.err + add.out).toMatch(/restore/);
  expect(add.err + add.out).toContain("login");
  expect(lines(p).length).toBe(before);
  expect((await p.werk(["show", "login"])).code).not.toBe(0);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const p = seeded([card("root", "Root"), card("login", "Login", { parent: "root" })]);
  const before = lines(p).length;
  const run = await p.werk(["remove", "login"]);
  expect(run.code).not.toBe(0);
  expect((await ok(p, ["show", "login"])).out).toContain("Login");
  expect(lines(p).length).toBe(before);
});

test("08.6 restore refuses without the person's say-so", async () => {
  const p = seeded([card("root", "Root"), card("login", "Login", { parent: "root" })]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const before = lines(p).length;
  const run = await p.werk(["restore", "login"]);
  expect(run.code).not.toBe(0);
  expect((await p.werk(["show", "login"])).code).not.toBe(0);
  expect((await ok(p, ["show", "root"])).out).not.toContain("login");
  expect(lines(p).length).toBe(before);
});

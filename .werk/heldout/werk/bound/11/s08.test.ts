import { expect, test } from "bun:test";
import type { Project } from "../src/test/project.ts";
import { card, events, lines, ok, seeded } from "./helpers.ts";

const shows = async (p: Project, id: string) => (await p.werk(["show", id])).code === 0;
const showOut = async (p: Project, id: string) => (await p.werk(["show", id])).out;

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const p = seeded([
    card("root", "Root"),
    card("auth", "Auth", { parent: "root", status: "decided" }),
    card("login", "Login", { parent: "auth" }),
    card("session", "Session", { parent: "auth" }),
    card("audit", "Audit", { parent: "root" }),
    ["edge.added", { from: "login", to: "audit", type: "depends_on", why: "login writes audit lines" }],
  ]);
  expect(await showOut(p, "audit")).toContain("login");
  const n = lines(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  for (const id of ["auth", "login", "session"]) expect(await shows(p, id)).toBe(false);
  expect((await ok(p, ["search"])).out).not.toContain("auth");
  expect((await ok(p, ["find"])).out).not.toMatch(/login|session/);
  const added = events(p).slice(n);
  expect(added.length).toBe(1);
  expect(added[0].type).toBe("node.removed");
  const removed = (await ok(p, ["removed"])).out;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect(await showOut(p, "audit")).not.toContain("login");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  const auth = await showOut(p, "auth");
  expect(auth).toContain("<- refines         login");
  expect(auth).toContain("<- refines         session");
  expect(await showOut(p, "audit")).toContain("depends_on      login");
  const after = (await ok(p, ["removed"])).out;
  expect(after).not.toMatch(/auth|login|session/);
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  const p = seeded([
    card("platform", "Platform"),
    card("auth", "Auth", { parent: "platform" }),
    card("login", "Login", { parent: "auth" }),
    card("session", "Session", { parent: "auth" }),
  ]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect(await shows(p, "auth")).toBe(false);
  const plat = await showOut(p, "platform");
  expect(plat).toContain("<- refines         login");
  expect(plat).toContain("<- refines         session");
  expect(await showOut(p, "login")).toContain("parent: platform");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  const plat2 = await showOut(p, "platform");
  expect(plat2).toContain("<- refines         auth");
  expect(plat2).not.toContain("<- refines         login");
  expect(plat2).not.toContain("<- refines         session");
  expect(await showOut(p, "login")).toContain("parent: auth");
  expect(await showOut(p, "session")).toContain("parent: auth");
});

test("08.3 a link waits until both of its ends are back", async () => {
  const p = seeded([
    card("root", "Root"),
    card("a", "A", { parent: "root" }),
    card("b", "B", { parent: "root" }),
    card("login", "Login", { parent: "a" }),
    card("session", "Session", { parent: "b" }),
    ["edge.added", { from: "login", to: "session", type: "depends_on", why: "login opens a session" }],
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  expect(await shows(p, "login")).toBe(true);
  expect(await showOut(p, "login")).not.toContain("session");
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect(await showOut(p, "login")).toContain("-> depends_on      session");
  expect(await showOut(p, "session")).toContain("<- depends_on      login");
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const p = seeded([
    card("root", "Root"),
    card("login", "Login", { parent: "root" }),
    card("billing", "Billing", { parent: "root" }),
    ["node.added", { id: "rfc-6749", kind: "source", title: "RFC 6749", finding: "OAuth 2.0" }],
    ["edge.added", { from: "login", to: "rfc-6749", type: "supported_by" }],
    ["edge.added", { from: "billing", to: "rfc-6749", type: "supported_by" }],
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const src = await showOut(p, "rfc-6749");
  expect(src).toContain("billing");
  expect(src).not.toContain("login");
  const n = lines(p).length;
  const add = await p.werk(["add", "login", "--title", "Login again", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  expect(add.err).toContain("restore");
  expect(lines(p).length).toBe(n);
  expect(await shows(p, "login")).toBe(false);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const p = seeded([card("root", "Root"), card("login", "Login", { parent: "root" })]);
  const n = lines(p).length;
  const run = await p.werk(["remove", "login"]);
  expect(run.code).not.toBe(0);
  expect(await shows(p, "login")).toBe(true);
  expect(lines(p).length).toBe(n);
});

test("08.6 restore refuses without the person's say-so", async () => {
  const p = seeded([card("root", "Root"), card("login", "Login", { parent: "root" })]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const n = lines(p).length;
  const run = await p.werk(["restore", "login"]);
  expect(run.code).not.toBe(0);
  expect(await shows(p, "login")).toBe(false);
  expect(lines(p).length).toBe(n);
});

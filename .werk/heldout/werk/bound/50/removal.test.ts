// Scenarios 08.x: the person removes and restores a card.
import { expect, test } from "bun:test";
import { cardView, decided, events, head, lines, ok, project, real, seed, serve } from "./helpers.ts";

const edge = (from: string, to: string, type: string, why?: string) => ({
  type: "edge.added",
  payload: why === undefined ? { from, to, type } : { from, to, type, why },
});

const linkLine = (shown: string, type: string, other: string) =>
  shown.split("\n").find((line) => line.includes(type) && line.includes(` ${other} `));

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const p = project();
  seed(p, [
    real("root", "Root"),
    real("auth", "Auth", "root"),
    decided("auth"),
    real("login", "Login", "auth"),
    real("session", "Session", "auth"),
    real("audit", "Audit", "root"),
    edge("login", "audit", "depends_on", "login writes an audit entry"),
  ]);
  const base = await serve(p);
  expect(await cardView(base, "auth")).toBeDefined();

  const before = lines(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  for (const id of ["auth", "login", "session"]) {
    expect((await p.werk(["show", id])).code).not.toBe(0);
    expect(await cardView(base, id)).toBeUndefined();
  }
  const rootView = (await cardView(base, "root")) ?? "";
  for (const id of ["auth", "login", "session"]) expect(rootView).not.toContain(`/map/${id}"`);
  expect((await ok(p, ["show", "root"])).out).not.toMatch(/\b(auth|login|session)\b/);
  const fresh = events(p).slice(before);
  expect(fresh).toHaveLength(1);
  expect(fresh[0]?.type).toBe("node.removed");

  const removed = (await ok(p, ["removed"])).out;
  expect(removed).toMatch(/^auth: removed/m);
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  const audit = (await ok(p, ["show", "audit"])).out;
  expect(audit).not.toContain("login");
  expect((await cardView(base, "audit")) ?? "").not.toContain("login");

  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect(await head(p, "auth")).toStartWith("card auth");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
  expect(linkLine((await ok(p, ["show", "login"])).out, "depends_on", "audit")).toBeDefined();
  expect(linkLine((await ok(p, ["show", "audit"])).out, "depends_on", "login")).toBeDefined();
  const authView = (await cardView(base, "auth")) ?? "";
  expect(authView).toContain('href="/map/login"');
  expect(authView).toContain('href="/map/session"');
  expect((await ok(p, ["removed"])).out).not.toMatch(/auth|login|session/);
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  const p = project();
  seed(p, [
    real("platform", "Platform"),
    real("auth", "Auth", "platform"),
    real("login", "Login", "auth"),
    real("session", "Session", "auth"),
  ]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect((await p.werk(["show", "auth"])).code).not.toBe(0);
  expect((await ok(p, ["show", "login"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: platform");

  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
  const platform = (await ok(p, ["show", "platform"])).out;
  expect(platform).not.toContain(" login ");
  expect(platform).not.toContain(" session ");
});

test("08.3 a link waits until both of its ends are back", async () => {
  const p = project();
  seed(p, [
    real("root", "Root"),
    real("auth", "Auth", "root"),
    real("storage", "Storage", "root"),
    real("login", "Login", "auth"),
    real("session", "Session", "storage"),
    edge("login", "session", "depends_on", "login opens a session"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const login = await p.werk(["show", "login"]);
  expect(login.code).toBe(0);
  expect(login.out).not.toContain("session");
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect(linkLine((await ok(p, ["show", "login"])).out, "depends_on", "session")).toBeDefined();
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const p = project();
  seed(p, [
    real("root", "Root"),
    real("login", "Login", "root"),
    real("billing", "Billing", "root"),
    { type: "node.added", payload: { id: "rfc-6749", kind: "source", title: "RFC 6749" } },
    edge("login", "rfc-6749", "supported_by"),
    edge("billing", "rfc-6749", "supported_by"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const source = await p.werk(["show", "rfc-6749"]);
  expect(source.code).toBe(0);
  expect(linkLine(source.out, "supported_by", "billing")).toBeDefined();

  const before = lines(p);
  const again = await p.werk(["add", "login", "--title", "Login again", "--parent", "root"]);
  expect(again.code).not.toBe(0);
  expect(again.err).toMatch(/restore #?login/);
  expect(lines(p)).toEqual(before);
  expect((await p.werk(["show", "login"])).code).not.toBe(0);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const p = project();
  seed(p, [real("root", "Root"), real("login", "Login", "root")]);
  const before = lines(p);
  const run = await p.werk(["remove", "login"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("refused");
  expect((await p.werk(["show", "login"])).code).toBe(0);
  expect(lines(p)).toEqual(before);
});

test("08.6 restore refuses without the person's say-so", async () => {
  const p = project();
  seed(p, [real("root", "Root"), real("login", "Login", "root")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const before = lines(p);
  const run = await p.werk(["restore", "login"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("refused");
  expect((await p.werk(["show", "login"])).code).not.toBe(0);
  expect(lines(p)).toEqual(before);
});

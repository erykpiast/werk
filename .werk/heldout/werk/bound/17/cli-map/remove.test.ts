// Steps 08.1–08.6: remove, restore and removed on the command line. "Any view" is read through the
// command line's views: show, search, find and removed.
import { expect, test } from "bun:test";
import { project } from "./helper.ts";

function authMap() {
  const p = project();
  p.card("root", "Root", { status: "decided" });
  p.card("auth", "Auth", { parent: "root", status: "decided" });
  p.card("login", "Login", { parent: "auth" });
  p.card("session", "Session", { parent: "auth" });
  p.card("audit", "Audit", { parent: "root" });
  p.seed("edge.added", { from: "login", to: "audit", type: "depends_on", why: "login writes audit rows" });
  return p;
}

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", () => {
  const p = authMap();
  expect(p.werk("show", "audit").out).toContain("login");
  const before = p.lines().length;
  const rm = p.werk("remove", "auth", "--actor", "you");
  expect(rm.code).toBe(0);
  for (const id of ["auth", "login", "session"]) {
    const s = p.werk("show", id);
    expect(s.code).not.toBe(0);
    expect(s.err).toContain("no node");
  }
  const views = [p.werk("show", "root").out, p.werk("search").out, p.werk("find").out, p.werk("search", "auth").out];
  for (const v of views) for (const word of ["auth  Auth", "login", "session"]) expect(v).not.toContain(word);
  const added = p.lines().slice(before).map((l) => JSON.parse(l));
  expect(added.length).toBe(1);
  expect(added[0].type).toBe("node.removed");
  const removed = p.werk("removed").out;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect(p.werk("show", "audit").out).not.toContain("login");

  expect(p.werk("restore", "auth", "--actor", "you").code).toBe(0);
  const auth = p.werk("show", "auth");
  expect(auth.code).toBe(0);
  expect(auth.out).toMatch(/<- refines\s+login/);
  expect(auth.out).toMatch(/<- refines\s+session/);
  expect(p.werk("show", "audit").out).toMatch(/<- depends_on\s+login/);
  const after = p.werk("removed").out;
  expect(after).not.toContain("auth");
  expect(after).not.toContain("login");
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", () => {
  const p = project();
  p.card("platform", "Platform", { status: "decided" });
  p.card("auth", "Auth", { parent: "platform" });
  p.card("login", "Login", { parent: "auth" });
  p.card("session", "Session", { parent: "auth" });
  expect(p.werk("remove", "auth", "--actor", "you", "--reparent").code).toBe(0);
  expect(p.werk("show", "auth").code).not.toBe(0);
  const plat = p.werk("show", "platform").out;
  expect(plat).not.toMatch(/refines\s+auth/);
  expect(plat).toMatch(/<- refines\s+login/);
  expect(plat).toMatch(/<- refines\s+session/);
  expect(p.werk("show", "login").out).toContain("parent: platform");

  expect(p.werk("restore", "auth", "--actor", "you").code).toBe(0);
  expect(p.werk("show", "auth").out).toContain("parent: platform");
  const plat2 = p.werk("show", "platform").out;
  expect(plat2).toMatch(/<- refines\s+auth/);
  expect(plat2).not.toMatch(/<- refines\s+login/);
  expect(plat2).not.toMatch(/<- refines\s+session/);
  const auth = p.werk("show", "auth").out;
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both of its ends are back", () => {
  const p = project();
  p.card("root", "Root", { status: "decided" });
  p.card("a", "Branch A", { parent: "root" });
  p.card("b", "Branch B", { parent: "root" });
  p.card("login", "Login", { parent: "a" });
  p.card("session", "Session", { parent: "b" });
  p.seed("edge.added", { from: "login", to: "session", type: "depends_on", why: "login opens a session" });
  expect(p.werk("show", "login").out).toMatch(/-> depends_on\s+session/);
  expect(p.werk("remove", "login", "--actor", "you").code).toBe(0);
  expect(p.werk("remove", "session", "--actor", "you").code).toBe(0);
  expect(p.werk("restore", "login", "--actor", "you").code).toBe(0);
  const login = p.werk("show", "login");
  expect(login.code).toBe(0);
  expect(login.out).not.toContain("session");
  expect(p.werk("restore", "session", "--actor", "you").code).toBe(0);
  expect(p.werk("show", "login").out).toMatch(/-> depends_on\s+session/);
  expect(p.werk("show", "session").out).toMatch(/<- depends_on\s+login/);
});

test("08.4 a removed card's id stays taken, and a cited source stays", () => {
  const p = project();
  p.card("root", "Root", { status: "decided" });
  p.card("login", "Login", { parent: "root" });
  p.card("billing", "Billing", { parent: "root" });
  p.seed("node.added", { id: "rfc-6749", kind: "source", title: "RFC 6749", url: "https://www.rfc-editor.org/rfc/rfc6749" });
  p.seed("edge.added", { from: "login", to: "rfc-6749", type: "supported_by" });
  p.seed("edge.added", { from: "billing", to: "rfc-6749", type: "supported_by" });
  expect(p.werk("remove", "login", "--actor", "you").code).toBe(0);
  const src = p.werk("show", "rfc-6749");
  expect(src.code).toBe(0);
  expect(src.out).toMatch(/<- supported_by\s+billing/);
  const before = p.lines().length;
  const add = p.werk("add", "login", "--title", "A new login", "--parent", "root");
  expect(add.code).not.toBe(0);
  expect(add.err + add.out).toMatch(/restore/);
  expect(add.err + add.out).toContain("login");
  expect(p.lines().length).toBe(before);
  expect(p.werk("show", "login").code).not.toBe(0);
});

test("08.5 remove refuses without the person's say-so", () => {
  const p = project();
  p.card("root", "Root", { status: "decided" });
  p.card("login", "Login", { parent: "root" });
  const before = p.lines().length;
  const r = p.werk("remove", "login");
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("refused");
  expect(p.werk("show", "login").code).toBe(0);
  expect(p.lines().length).toBe(before);
});

test("08.6 restore refuses without the person's say-so", () => {
  const p = project();
  p.card("root", "Root", { status: "decided" });
  p.card("login", "Login", { parent: "root" });
  expect(p.werk("remove", "login", "--actor", "you").code).toBe(0);
  const before = p.lines().length;
  const r = p.werk("restore", "login");
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("refused");
  expect(p.werk("show", "login").code).not.toBe(0);
  expect(p.lines().length).toBe(before);
});

import { expect, test } from "bun:test";
import { events, freshProject, seed } from "./helpers.ts";

const card = (id: string, title: string, parent?: string) => ({
  type: "node.added",
  payload: { id, kind: "card", title, ...(parent ? { parent } : {}) },
});

test("08.1 remove takes the subtree out in one step; restore brings everything back", async () => {
  const p = freshProject();
  seed(p, [
    card("auth", "Auth"),
    card("login", "Login", "auth"),
    card("session", "Session", "auth"),
    card("audit", "Audit"),
    { type: "node.decided", payload: { id: "auth" } },
    { type: "edge.added", payload: { from: "login", to: "audit", type: "depends_on", why: "login writes audit lines" } },
  ]);
  const pre = await p.werk(["show", "auth"]);
  console.log("08.1 show auth before:", JSON.stringify(pre));
  expect(pre.out).toContain("[decided]");
  const n = events(p).length;
  const rm = await p.werk(["remove", "auth", "--actor", "you"]);
  console.log("08.1 remove:", JSON.stringify(rm));
  expect(rm.code).toBe(0);
  for (const id of ["auth", "login", "session"]) {
    const s = await p.werk(["show", id]);
    expect(s.code).not.toBe(0);
  }
  const added = events(p).slice(n);
  console.log("08.1 new events:", JSON.stringify(added));
  expect(added.length).toBe(1);
  expect(added[0]?.type).toBe("node.removed");
  const listed = await p.werk(["removed"]);
  console.log("08.1 removed:", listed.out);
  expect(listed.out).toContain("auth");
  expect(listed.out).toContain("login");
  expect(listed.out).toContain("session");
  const audit = await p.werk(["show", "audit"]);
  console.log("08.1 show audit:", audit.out);
  expect(audit.out).not.toContain("login");
  const rs = await p.werk(["restore", "auth", "--actor", "you"]);
  console.log("08.1 restore:", JSON.stringify(rs));
  expect(rs.code).toBe(0);
  const auth = await p.werk(["show", "auth"]);
  console.log("08.1 show auth after:", auth.out);
  expect(auth.code).toBe(0);
  expect(auth.out).toMatch(/<- refines\s+login/);
  expect(auth.out).toMatch(/<- refines\s+session/);
  const login = await p.werk(["show", "login"]);
  expect(login.out).toMatch(/-> depends_on\s+audit/);
  const after = await p.werk(["removed"]);
  console.log("08.1 removed after:", JSON.stringify(after));
  expect(after.out).not.toContain("auth");
  expect(after.out).toMatch(/no card is removed/);
});

test("08.2 remove with reparent moves the children up, and a restore puts them back", async () => {
  const p = freshProject();
  seed(p, [
    card("platform", "Platform"),
    card("auth", "Auth", "platform"),
    card("login", "Login", "auth"),
    card("session", "Session", "auth"),
  ]);
  const rm = await p.werk(["remove", "auth", "--actor", "you", "--reparent"]);
  console.log("08.2 remove:", JSON.stringify(rm));
  expect(rm.code).toBe(0);
  expect((await p.werk(["show", "auth"])).code).not.toBe(0);
  for (const id of ["login", "session"]) {
    const s = await p.werk(["show", id]);
    console.log("08.2 show", id, s.out);
    expect(s.out).toContain("parent: platform");
  }
  const rs = await p.werk(["restore", "auth", "--actor", "you"]);
  console.log("08.2 restore:", JSON.stringify(rs));
  expect(rs.code).toBe(0);
  expect((await p.werk(["show", "auth"])).out).toContain("parent: platform");
  for (const id of ["login", "session"]) {
    const s = await p.werk(["show", id]);
    expect(s.out).toContain("parent: auth");
  }
  const plat = await p.werk(["show", "platform"]);
  console.log("08.2 show platform:", plat.out);
  expect(plat.out).not.toMatch(/<- refines\s+login/);
  expect(plat.out).not.toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both of its ends are back", async () => {
  const p = freshProject();
  seed(p, [
    card("identity", "Identity"),
    card("state", "State"),
    card("login", "Login", "identity"),
    card("session", "Session", "state"),
    { type: "edge.added", payload: { from: "login", to: "session", type: "depends_on", why: "login opens a session" } },
  ]);
  for (const args of [["remove", "login"], ["remove", "session"], ["restore", "login"]]) {
    const r = await p.werk([...args, "--actor", "you"]);
    console.log("08.3", args.join(" "), JSON.stringify(r));
    expect(r.code).toBe(0);
  }
  const login = await p.werk(["show", "login"]);
  console.log("08.3 show login:", login.out);
  expect(login.code).toBe(0);
  expect(login.out).not.toContain("session");
  expect((await p.werk(["restore", "session", "--actor", "you"])).code).toBe(0);
  const again = await p.werk(["show", "login"]);
  console.log("08.3 show login after:", again.out);
  expect(again.out).toMatch(/-> depends_on\s+session/);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const p = freshProject();
  seed(p, [
    card("login", "Login"),
    card("billing", "Billing"),
    { type: "node.added", payload: { id: "rfc-6749", kind: "source", title: "RFC 6749", url: "https://www.rfc-editor.org/rfc/rfc6749" } },
    { type: "edge.added", payload: { from: "login", to: "rfc-6749", type: "supported_by" } },
    { type: "edge.added", payload: { from: "billing", to: "rfc-6749", type: "supported_by" } },
  ]);
  expect((await p.werk(["remove", "login", "--actor", "you"])).code).toBe(0);
  const src = await p.werk(["show", "rfc-6749"]);
  console.log("08.4 show source:", JSON.stringify(src));
  expect(src.code).toBe(0);
  expect(src.out).toMatch(/<- supported_by\s+billing/);
  const n = events(p).length;
  const add = await p.werk(["add", "login", "--title", "New login"]);
  console.log("08.4 add login:", JSON.stringify(add));
  expect(add.code).not.toBe(0);
  expect(add.err).toContain("restore");
  expect(add.err).toContain("login");
  expect(events(p).length).toBe(n);
  expect((await p.werk(["show", "login"])).code).not.toBe(0);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const p = freshProject();
  seed(p, [card("login", "Login")]);
  const n = events(p).length;
  const r = await p.werk(["remove", "login"]);
  console.log("08.5 remove:", JSON.stringify(r));
  expect(r.code).not.toBe(0);
  expect((await p.werk(["show", "login"])).code).toBe(0);
  expect(events(p).length).toBe(n);
});

test("08.6 restore refuses without the person's say-so", async () => {
  const p = freshProject();
  seed(p, [card("login", "Login")]);
  expect((await p.werk(["remove", "login", "--actor", "you"])).code).toBe(0);
  const n = events(p).length;
  const r = await p.werk(["restore", "login"]);
  console.log("08.6 restore:", JSON.stringify(r));
  expect(r.code).not.toBe(0);
  expect((await p.werk(["show", "login"])).code).not.toBe(0);
  expect(events(p).length).toBe(n);
});

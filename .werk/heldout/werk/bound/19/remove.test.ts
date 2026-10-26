import { expect, test } from "bun:test";
import { project } from "./helpers.ts";

const gone = async (p: ReturnType<typeof project>, id: string) => {
  const s = await p.werk(["show", id]);
  return s.code !== 0;
};

test("08.1", async () => {
  const p = project();
  p.real("auth", "Auth", undefined, { status: "decided" });
  p.real("login", "Login", "auth");
  p.real("session", "Session", "auth");
  p.real("audit", "Audit");
  await p.ok(["link", "login", "audit", "--type", "depends_on", "--why", "writes audit lines"]);
  const before = p.log().length;
  const rm = await p.werk(["remove", "auth", "--actor", "you"]);
  expect(rm.code).toBe(0);
  for (const id of ["auth", "login", "session"]) expect(await gone(p, id)).toBe(true);
  const fresh = p.log().slice(before);
  expect(fresh.length).toBe(1);
  expect(fresh[0]).toMatchObject({ type: "node.removed", payload: { id: "auth" } });
  const listed = await p.ok(["removed"]);
  expect(listed).toContain("auth");
  expect(listed).toContain("login");
  expect(listed).toContain("session");
  expect(await p.ok(["show", "audit"])).not.toContain("login");
  const rs = await p.werk(["restore", "auth", "--actor", "you"]);
  expect(rs.code).toBe(0);
  expect(await p.ok(["show", "auth"])).toContain("Auth");
  expect(await p.ok(["show", "login"])).toMatch(/parent: auth/);
  expect(await p.ok(["show", "session"])).toMatch(/parent: auth/);
  const audit = await p.ok(["show", "audit"]);
  expect(audit).toContain("login");
  expect(audit).not.toContain("held");
  const after = await p.ok(["removed"]);
  expect(after).not.toContain("auth");
  expect(after).not.toContain("login");
});

test("08.2", async () => {
  const p = project();
  p.real("platform", "Platform");
  p.real("auth", "Auth", "platform");
  p.real("login", "Login", "auth");
  p.real("session", "Session", "auth");
  expect((await p.werk(["remove", "auth", "--actor", "you", "--reparent"])).code).toBe(0);
  expect(await gone(p, "auth")).toBe(true);
  expect(await p.ok(["show", "login"])).toMatch(/parent: platform/);
  expect(await p.ok(["show", "session"])).toMatch(/parent: platform/);
  expect((await p.werk(["restore", "auth", "--actor", "you"])).code).toBe(0);
  expect(await p.ok(["show", "auth"])).toMatch(/parent: platform/);
  expect(await p.ok(["show", "login"])).toMatch(/parent: auth\b/);
  expect(await p.ok(["show", "session"])).toMatch(/parent: auth\b/);
  const plat = await p.ok(["show", "platform"]);
  expect(plat).not.toContain("login");
  expect(plat).not.toContain("session");
});

test("08.3", async () => {
  const p = project();
  p.real("identity", "Identity");
  p.real("state", "State");
  p.real("login", "Login", "identity");
  p.real("session", "Session", "state");
  await p.ok(["link", "login", "session", "--type", "depends_on", "--why", "needs a session"]);
  expect((await p.werk(["remove", "login", "--actor", "you"])).code).toBe(0);
  expect((await p.werk(["remove", "session", "--actor", "you"])).code).toBe(0);
  expect((await p.werk(["restore", "login", "--actor", "you"])).code).toBe(0);
  const l = await p.ok(["show", "login"]);
  expect(l).not.toContain("session");
  expect((await p.werk(["restore", "session", "--actor", "you"])).code).toBe(0);
  const l2 = await p.ok(["show", "login"]);
  expect(l2).toContain("session");
  expect(l2).not.toContain("held");
});

test("08.4", async () => {
  const p = project();
  p.real("login", "Login");
  p.real("billing", "Billing");
  p.seed("node.added", { id: "rfc-6749", kind: "source", title: "RFC 6749", url: "https://www.rfc-editor.org/rfc/rfc6749" });
  await p.ok(["link", "login", "rfc-6749", "--type", "supported_by"]);
  await p.ok(["link", "billing", "rfc-6749", "--type", "supported_by"]);
  expect((await p.werk(["remove", "login", "--actor", "you"])).code).toBe(0);
  const src = await p.ok(["show", "rfc-6749"]);
  expect(src).toContain("billing");
  expect(src).not.toContain("login");
  const before = p.log().length;
  const add = await p.werk(["add", "login", "--title", "New login"]);
  expect(add.code).not.toBe(0);
  expect(add.err).toContain("restore");
  expect(add.err).toContain("login");
  expect(p.log().length).toBe(before);
  expect(await gone(p, "login")).toBe(true);
});

test("08.5", async () => {
  const p = project();
  p.real("login", "Login");
  const before = p.log().length;
  const rm = await p.werk(["remove", "login"]);
  expect(rm.code).not.toBe(0);
  expect(rm.err).toContain("refused");
  expect(await gone(p, "login")).toBe(false);
  expect(p.log().length).toBe(before);
});

test("08.6", async () => {
  const p = project();
  p.real("login", "Login");
  await p.ok(["remove", "login", "--actor", "you"]);
  const before = p.log().length;
  const rs = await p.werk(["restore", "login"]);
  expect(rs.code).not.toBe(0);
  expect(rs.err).toContain("refused");
  expect(await gone(p, "login")).toBe(true);
  expect(p.log().length).toBe(before);
});

import { expect, test } from "bun:test";
import { children, project, real, seed, show } from "./a-helpers.ts";

/** Every view the command line offers that could show a card id. */
async function anyView(p: ReturnType<typeof project>): Promise<string> {
  const parts = await Promise.all([
    p.werk(["show"]),
    p.werk(["find"]),
    p.werk(["search"]),
    p.werk(["show", "root"]),
    p.werk(["show", "audit"]),
  ]);
  return parts.map((r) => r.out).join("\n");
}

const dependsOn = (out: string, id: string) =>
  out.split("\n").some((l) => /depends_on/.test(l) && l.includes(` ${id} `));

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const p = project();
  await real(p, "root", "Root");
  seed(p, "auth", { title: "Auth", parent: "root", status: "decided", who: "you" });
  await real(p, "login", "Login", "auth");
  await real(p, "session", "Session", "auth");
  await real(p, "audit", "Audit", "root");
  expect((await p.werk(["link", "login", "audit", "--type", "depends_on", "--why", "login writes audit"])).code).toBe(
    0,
  );
  expect(dependsOn((await show(p, "audit")).out, "login")).toBe(true);
  const n = p.lines().length;
  expect((await p.werk(["remove", "auth", "--actor", "you"])).code).toBe(0);
  for (const id of ["auth", "login", "session"]) expect((await show(p, id)).code).not.toBe(0);
  const views = await anyView(p);
  for (const t of ["Auth", "Login", "Session"]) expect(views).not.toContain(t);
  const evs = p.events().slice(n);
  expect(evs).toHaveLength(1);
  expect(evs[0]?.type).toBe("node.removed");
  const removed = await p.werk(["removed"]);
  expect(removed.out).toContain("auth");
  expect(removed.out).toContain("login");
  expect(removed.out).toContain("session");
  expect(dependsOn((await show(p, "audit")).out, "login")).toBe(false);

  expect((await p.werk(["restore", "auth", "--actor", "you"])).code).toBe(0);
  const auth = await show(p, "auth");
  expect(auth.code).toBe(0);
  expect(children(auth.out).sort()).toEqual(["login", "session"]);
  expect(dependsOn((await show(p, "audit")).out, "login")).toBe(true);
  const after = await p.werk(["removed"]);
  expect(after.out).not.toContain("auth");
  expect(after.out).not.toContain("login");
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  const p = project();
  await real(p, "root", "Root");
  await real(p, "platform", "Platform", "root");
  await real(p, "auth", "Auth", "platform");
  await real(p, "login", "Login", "auth");
  await real(p, "session", "Session", "auth");
  expect((await p.werk(["remove", "auth", "--actor", "you", "--reparent"])).code).toBe(0);
  expect((await show(p, "auth")).code).not.toBe(0);
  expect(children((await show(p, "platform")).out).sort()).toEqual(["login", "session"]);
  expect((await p.werk(["restore", "auth", "--actor", "you"])).code).toBe(0);
  expect(children((await show(p, "platform")).out)).toEqual(["auth"]);
  expect(children((await show(p, "auth")).out).sort()).toEqual(["login", "session"]);
});

test("08.3 a link waits until both of its ends are back", async () => {
  const p = project();
  await real(p, "root", "Root");
  await real(p, "a", "Branch A", "root");
  await real(p, "b", "Branch B", "root");
  await real(p, "login", "Login", "a");
  await real(p, "session", "Session", "b");
  expect((await p.werk(["link", "login", "session", "--type", "depends_on", "--why", "needs a session"])).code).toBe(0);
  expect((await p.werk(["remove", "login", "--actor", "you"])).code).toBe(0);
  expect((await p.werk(["remove", "session", "--actor", "you"])).code).toBe(0);
  expect((await p.werk(["restore", "login", "--actor", "you"])).code).toBe(0);
  const l = await show(p, "login");
  expect(l.code).toBe(0);
  expect(dependsOn(l.out, "session")).toBe(false);
  expect((await p.werk(["restore", "session", "--actor", "you"])).code).toBe(0);
  expect(dependsOn((await show(p, "login")).out, "session")).toBe(true);
  expect(dependsOn((await show(p, "session")).out, "login")).toBe(true);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const p = project();
  await real(p, "root", "Root");
  await real(p, "login", "Login", "root");
  await real(p, "billing", "Billing", "root");
  await real(p, "rfc-6749", "OAuth 2.0", undefined, ["--kind", "source", "--finding", "tokens"]);
  await p.werk(["link", "login", "rfc-6749", "--type", "supported_by"]);
  await p.werk(["link", "billing", "rfc-6749", "--type", "supported_by"]);
  expect((await p.werk(["remove", "login", "--actor", "you"])).code).toBe(0);
  const src = await show(p, "rfc-6749");
  expect(src.code).toBe(0);
  expect(src.out).toMatch(/<- supported_by\s+billing/);
  const n = p.lines().length;
  const add = await p.werk(["add", "login", "--title", "Login again", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  expect(add.err).toMatch(/restore #?login/);
  expect(p.lines()).toHaveLength(n);
  expect((await show(p, "login")).code).not.toBe(0);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const p = project();
  await real(p, "root", "Root");
  await real(p, "login", "Login", "root");
  const n = p.lines().length;
  const r = await p.werk(["remove", "login"]);
  expect(r.code).not.toBe(0);
  expect((await show(p, "login")).code).toBe(0);
  expect(p.lines()).toHaveLength(n);
});

test("08.6 restore refuses without the person's say-so", async () => {
  const p = project();
  await real(p, "root", "Root");
  await real(p, "login", "Login", "root");
  expect((await p.werk(["remove", "login", "--actor", "you"])).code).toBe(0);
  const n = p.lines().length;
  const r = await p.werk(["restore", "login"]);
  expect(r.code).not.toBe(0);
  expect((await show(p, "login")).code).not.toBe(0);
  expect(p.lines()).toHaveLength(n);
});

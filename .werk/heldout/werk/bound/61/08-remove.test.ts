import { afterEach, beforeEach, expect, test } from "bun:test";
import { type Cli, cli, decided, link, open } from "./cli.ts";

let c: Cli;
beforeEach(() => {
  c = cli();
});
afterEach(() => c.dispose());

const shows = async (id: string) => {
  const r = await c.werk("show", id);
  return r.code === 0;
};

test("08.1 remove takes the subtree out in one event, restore brings it back with its link", async () => {
  c.write([
    ...open("root", { title: "Root" }),
    ...decided("auth", { title: "Auth", parent: "root" }),
    ...open("login", { title: "Login", parent: "auth" }),
    ...open("session", { title: "Session", parent: "auth" }),
    ...open("audit", { title: "Audit", parent: "root" }),
    link("login", "audit"),
  ]);
  expect((await c.werk("show", "audit")).stdout).toMatch(/<-\s+depends_on\s+login/);
  const n = c.events().length;
  const r = await c.werk("remove", "auth", "--actor", "you");
  expect(r.code).toBe(0);
  expect(c.events().length).toBe(n + 1);
  for (const id of ["auth", "login", "session"]) expect(await shows(id)).toBe(false);
  const rootView = (await c.werk("show", "root")).stdout;
  for (const id of ["auth", "login", "session"]) expect(rootView).not.toContain(`  ${id}  `);
  expect((await c.werk("search", "login")).stdout).not.toContain("login");
  const removed = (await c.werk("removed")).stdout;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect((await c.werk("show", "audit")).stdout).not.toContain("login");
  const back = await c.werk("restore", "auth", "--actor", "you");
  expect(back.code).toBe(0);
  const authView = (await c.werk("show", "auth")).stdout;
  expect(authView).toMatch(/<-\s+refines\s+login/);
  expect(authView).toMatch(/<-\s+refines\s+session/);
  expect((await c.werk("show", "audit")).stdout).toMatch(/<-\s+depends_on\s+login/);
  expect((await c.werk("removed")).stdout.trim()).toBe("nothing is removed");
});

test("08.2 remove with --reparent moves the children up and restore puts them back", async () => {
  c.write([
    ...open("platform", { title: "Platform" }),
    ...open("auth", { title: "Auth", parent: "platform" }),
    ...open("login", { title: "Login", parent: "auth" }),
    ...open("session", { title: "Session", parent: "auth" }),
  ]);
  const r = await c.werk("remove", "auth", "--actor", "you", "--reparent");
  expect(r.code).toBe(0);
  expect(await shows("auth")).toBe(false);
  const platform = (await c.werk("show", "platform")).stdout;
  expect(platform).toMatch(/<-\s+refines\s+login/);
  expect(platform).toMatch(/<-\s+refines\s+session/);
  expect((await c.werk("restore", "auth", "--actor", "you")).code).toBe(0);
  const platform2 = (await c.werk("show", "platform")).stdout;
  expect(platform2).toMatch(/<-\s+refines\s+auth/);
  expect(platform2).not.toMatch(/<-\s+refines\s+login/);
  expect(platform2).not.toMatch(/<-\s+refines\s+session/);
  const auth = (await c.werk("show", "auth")).stdout;
  expect(auth).toMatch(/<-\s+refines\s+login/);
  expect(auth).toMatch(/<-\s+refines\s+session/);
});

test("08.3 a link waits until both ends are back", async () => {
  c.write([
    ...open("root", { title: "Root" }),
    ...open("a", { title: "A", parent: "root" }),
    ...open("b", { title: "B", parent: "root" }),
    ...open("login", { title: "Login", parent: "a" }),
    ...open("session", { title: "Session", parent: "b" }),
    link("login", "session"),
  ]);
  for (const id of ["login", "session"]) expect((await c.werk("remove", id, "--actor", "you")).code).toBe(0);
  expect((await c.werk("restore", "login", "--actor", "you")).code).toBe(0);
  const login = (await c.werk("show", "login")).stdout;
  expect(login).toContain("Login");
  expect(login).not.toMatch(/depends_on\s+session/);
  expect((await c.werk("restore", "session", "--actor", "you")).code).toBe(0);
  expect((await c.werk("show", "login")).stdout).toMatch(/->\s+depends_on\s+session/);
});

test("08.4 a removed card's id stays taken and a cited source stays", async () => {
  c.write([
    ...open("root", { title: "Root" }),
    ...open("login", { title: "Login", parent: "root" }),
    ...open("billing", { title: "Billing", parent: "root" }),
    ...open("rfc-6749", { title: "RFC 6749", kind: "source", why: "OAuth finding" }),
    { type: "edge.added", from: "login", to: "rfc-6749", link: "supported_by", why: "" },
    { type: "edge.added", from: "billing", to: "rfc-6749", link: "supported_by", why: "" },
  ]);
  expect((await c.werk("show", "billing")).stdout).toMatch(/Ev:\n\s+rfc-6749/);
  expect((await c.werk("remove", "login", "--actor", "you")).code).toBe(0);
  const src = await c.werk("show", "rfc-6749");
  expect(src.code).toBe(0);
  expect((await c.werk("show", "billing")).stdout).toMatch(/Ev:\n\s+rfc-6749/);
  const n = c.events().length;
  const add = await c.werk("add", "login", "--title", "New login");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toMatch(/restore/);
  expect(add.stderr).toContain("login");
  expect(c.events().length).toBe(n);
  expect((await c.werk("show", "login")).code).not.toBe(0);
});

test("08.5 remove without --actor you refuses", async () => {
  c.write(open("login", { title: "Login" }));
  const n = c.events().length;
  const r = await c.werk("remove", "login");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toContain("refused");
  expect((await c.werk("show", "login")).stdout).toContain("Login");
  expect(c.events().length).toBe(n);
});

test("08.6 restore without --actor you refuses", async () => {
  c.write(open("login", { title: "Login" }));
  expect((await c.werk("remove", "login", "--actor", "you")).code).toBe(0);
  const n = c.events().length;
  const r = await c.werk("restore", "login");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toContain("refused");
  expect((await c.werk("show", "login")).code).not.toBe(0);
  expect(c.events().length).toBe(n);
});

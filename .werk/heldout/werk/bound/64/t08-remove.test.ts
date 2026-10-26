import { afterEach, beforeEach, expect, test } from "bun:test";
import { decided, link, open } from "../src/map/mark-fixtures.ts";
import { createProject, type Project, seed, werk } from "./h.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());
const shown = async (id: string) => {
  const r = await werk(p, "show", id);
  return r.code === 0 ? r.stdout : null;
};

test("08.1 remove takes the subtree, restore brings it back", async () => {
  seed(
    p,
    decided("auth"),
    open("login", { parent: "auth" }),
    open("session", { parent: "auth" }),
    open("audit"),
    link("login", "audit"),
  );
  const n = p.events().length;
  const r = await werk(p, "remove", "auth", "--actor", "you");
  expect(r.code).toBe(0);
  expect(await shown("auth")).toBeNull();
  expect(await shown("login")).toBeNull();
  expect(await shown("session")).toBeNull();
  expect(p.events().length).toBe(n + 1);
  expect((await werk(p, "search")).stdout).not.toContain("auth");
  expect((await werk(p, "find")).stdout).not.toContain("login");
  const removed = (await werk(p, "removed")).stdout;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect(await shown("audit")).not.toMatch(/login/);
  const rr = await werk(p, "restore", "auth", "--actor", "you");
  expect(rr.code).toBe(0);
  const auth = await shown("auth");
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
  expect(await shown("audit")).toMatch(/<- depends_on\s+login/);
  expect((await werk(p, "removed")).stdout).toMatch(/nothing is removed/);
});

test("08.2 reparent moves children up, restore puts them back", async () => {
  seed(
    p,
    decided("platform"),
    open("auth", { parent: "platform" }),
    open("login", { parent: "auth" }),
    open("session", { parent: "auth" }),
  );
  const r = await werk(p, "remove", "auth", "--actor", "you", "--reparent");
  expect(r.code).toBe(0);
  expect(await shown("auth")).toBeNull();
  const plat = await shown("platform");
  expect(plat).toMatch(/<- refines\s+login/);
  expect(plat).toMatch(/<- refines\s+session/);
  await werk(p, "restore", "auth", "--actor", "you");
  const plat2 = (await shown("platform")) as string;
  expect(plat2).toMatch(/<- refines\s+auth/);
  expect(plat2).not.toMatch(/<- refines\s+login/);
  const auth = (await shown("auth")) as string;
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both ends are back", async () => {
  seed(
    p,
    open("root"),
    open("a", { parent: "root" }),
    open("b", { parent: "root" }),
    open("login", { parent: "a" }),
    open("session", { parent: "b" }),
    link("login", "session"),
  );
  await werk(p, "remove", "login", "--actor", "you");
  await werk(p, "remove", "session", "--actor", "you");
  await werk(p, "restore", "login", "--actor", "you");
  const login = await shown("login");
  expect(login).not.toBeNull();
  expect(login).not.toMatch(/depends_on\s+session/);
  await werk(p, "restore", "session", "--actor", "you");
  expect(await shown("login")).toMatch(/-> depends_on\s+session/);
});

test("08.4 a removed id stays taken, a cited source stays", async () => {
  seed(
    p,
    open("login"),
    open("billing"),
    open("rfc-6749", { kind: "source", title: "RFC 6749" }),
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  );
  await werk(p, "remove", "login", "--actor", "you");
  expect(await shown("rfc-6749")).not.toBeNull();
  expect(await shown("billing")).toContain("rfc-6749");
  const n = p.events().length;
  const add = await werk(p, "add", "login", "--title", "New login");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toMatch(/restore/);
  expect(p.events().length).toBe(n);
  expect(await shown("login")).toBeNull();
});

test("08.5 remove refuses without actor you", async () => {
  seed(p, open("login"));
  const n = p.events().length;
  const r = await werk(p, "remove", "login");
  expect(r.code).not.toBe(0);
  expect(await shown("login")).not.toBeNull();
  expect(p.events().length).toBe(n);
});

test("08.6 restore refuses without actor you", async () => {
  seed(p, open("login"));
  await werk(p, "remove", "login", "--actor", "you");
  const n = p.events().length;
  const r = await werk(p, "restore", "login");
  expect(r.code).not.toBe(0);
  expect(await shown("login")).toBeNull();
  expect(p.events().length).toBe(n);
});

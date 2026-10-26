import { afterEach, beforeEach, expect, test } from "bun:test";
import { decided, link, open } from "../../src/map/mark-fixtures.ts";
import { make, SLOW, seed, YOU } from "./helper.ts";

let t: ReturnType<typeof make>;
beforeEach(() => {
  t = make();
});
afterEach(() => t.project.dispose());

const shows = async (id: string) => (await t.werk("show", id)).code === 0;

test("08.1 remove takes the subtree in one event; restore brings all back", async () => {
  seed(
    t.project,
    decided("auth"),
    decided("login", { parent: "auth" }),
    decided("session", { parent: "auth" }),
    decided("audit"),
    link("login", "audit"),
  );
  const before = t.project.events().length;
  const r = await t.werk("remove", "auth", ...YOU);
  expect(r.code).toBe(0);
  expect(t.project.events()).toHaveLength(before + 1);
  for (const id of ["auth", "login", "session"]) expect(await shows(id)).toBe(false);
  expect((await t.werk("search")).stdout).not.toMatch(/auth|login|session/);
  expect((await t.werk("show", "audit")).stdout).not.toContain("login");
  const removed = (await t.werk("removed")).stdout;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect((await t.werk("restore", "auth", ...YOU)).code).toBe(0);
  const login = (await t.werk("show", "login")).stdout;
  expect(login).toContain("auth");
  expect(login).toContain("audit");
  expect((await t.werk("show", "session")).stdout).toContain("auth");
  expect((await t.werk("show", "audit")).stdout).toContain("login");
  expect((await t.werk("removed")).stdout).toContain("nothing is removed");
}, SLOW);

test("08.2 reparent removal and restore", async () => {
  seed(
    t.project,
    decided("platform"),
    decided("auth", { parent: "platform" }),
    decided("login", { parent: "auth" }),
    decided("session", { parent: "auth" }),
  );
  expect((await t.werk("remove", "auth", ...YOU, "--reparent")).code).toBe(0);
  expect(await shows("auth")).toBe(false);
  const platform = (await t.werk("show", "platform")).stdout;
  expect(platform).toContain("login");
  expect(platform).toContain("session");
  expect((await t.werk("restore", "auth", ...YOU)).code).toBe(0);
  const p2 = (await t.werk("show", "platform")).stdout;
  expect(p2).toContain("auth");
  const login = (await t.werk("show", "login")).stdout;
  expect(login).toContain("auth");
  expect(login).not.toContain("platform");
  const auth = (await t.werk("show", "auth")).stdout;
  expect(auth).toContain("platform");
  expect(auth).toContain("login");
  expect(auth).toContain("session");
}, SLOW);

test("08.3 a link waits until both ends are back", async () => {
  seed(t.project, decided("login"), decided("session"), link("login", "session"));
  expect((await t.werk("remove", "login", ...YOU)).code).toBe(0);
  expect((await t.werk("remove", "session", ...YOU)).code).toBe(0);
  expect((await t.werk("restore", "login", ...YOU)).code).toBe(0);
  const login = (await t.werk("show", "login")).stdout;
  expect(login).toContain("card login");
  expect(login).not.toContain("session");
  expect((await t.werk("restore", "session", ...YOU)).code).toBe(0);
  expect((await t.werk("show", "login")).stdout).toContain("session");
}, SLOW);

test("08.4 removed id stays taken; cited source stays", async () => {
  seed(
    t.project,
    decided("login"),
    decided("billing"),
    open("rfc-6749", { kind: "source", title: "RFC 6749" }),
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  );
  expect((await t.werk("remove", "login", ...YOU)).code).toBe(0);
  const src = await t.werk("show", "rfc-6749");
  expect(src.code).toBe(0);
  expect(src.stdout).toContain("RFC 6749");
  expect((await t.werk("show", "billing")).stdout).toContain("rfc-6749");
  const events = t.project.events().length;
  const add = await t.werk("add", "login", "--title", "Again");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toContain("restore");
  expect(add.stderr).toContain("login");
  expect(t.project.events()).toHaveLength(events);
  expect(await shows("login")).toBe(false);
}, SLOW);

test("08.5 remove without --actor you refuses", async () => {
  seed(t.project, decided("login"));
  const n = t.project.events().length;
  const r = await t.werk("remove", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(true);
  expect(t.project.events()).toHaveLength(n);
}, SLOW);

test("08.6 restore without --actor you refuses", async () => {
  seed(t.project, decided("login"));
  expect((await t.werk("remove", "login", ...YOU)).code).toBe(0);
  const n = t.project.events().length;
  const r = await t.werk("restore", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(false);
  expect(t.project.events()).toHaveLength(n);
}, SLOW);

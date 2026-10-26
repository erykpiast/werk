import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, decided, link, open, seed, werkIn, logText, type Project } from "./support.ts";

let p: Project;
let werk: ReturnType<typeof werkIn>;
beforeEach(() => {
  p = createProject();
  werk = werkIn(p);
});
afterEach(() => p.dispose());

const ok = (r: { code: number; stdout: string; stderr: string }) => {
  expect(r.stderr).toBe("");
  expect(r.code).toBe(0);
  return r;
};

test("08.1 remove takes the subtree out in one step; restore brings it back", async () => {
  seed(p, [
    decided("auth"),
    open("login", { parent: "auth" }),
    open("session", { parent: "auth" }),
    open("audit"),
    link("login", "audit"),
  ]);
  const before = p.events().length;
  ok(await werk("remove", "auth", "--actor", "you"));
  for (const id of ["auth", "login", "session"]) {
    expect((await werk("show", id)).code).toBe(1);
  }
  expect(p.events().length).toBe(before + 1);
  expect((p.events().at(-1) as { type: string }).type).toBe("node.removed");
  const removed = ok(await werk("removed"));
  expect(removed.stdout).toContain("auth");
  expect(removed.stdout).toContain("login");
  expect(removed.stdout).toContain("session");
  ok(await werk("restore", "auth", "--actor", "you"));
  const shown = (await werk("show", "login")).stdout;
  expect(shown).toContain("auth");
  expect(shown).toContain("audit");
  expect((await werk("show", "session")).code).toBe(0);
  expect((await werk("removed")).stdout.trim()).toBe("");
});

test("08.2 remove with reparent moves the children up; restore puts them back", async () => {
  seed(p, [
    decided("platform"),
    decided("auth", { parent: "platform" }),
    open("login", { parent: "auth" }),
    open("session", { parent: "auth" }),
  ]);
  ok(await werk("remove", "auth", "--actor", "you", "--reparent"));
  expect((await werk("show", "auth")).code).toBe(1);
  for (const id of ["login", "session"]) {
    expect((await werk("show", id)).stdout).toMatch(/-> refines\s+platform/);
  }
  ok(await werk("restore", "auth", "--actor", "you"));
  expect((await werk("show", "auth")).stdout).toMatch(/-> refines\s+platform/);
  for (const id of ["login", "session"]) {
    const s = (await werk("show", id)).stdout;
    expect(s).toMatch(/-> refines\s+auth/);
    expect(s).not.toMatch(/-> refines\s+platform/);
  }
});

test("08.3 a link waits until both ends are back", async () => {
  seed(p, [open("login"), open("session"), link("login", "session")]);
  ok(await werk("remove", "login", "--actor", "you"));
  ok(await werk("remove", "session", "--actor", "you"));
  ok(await werk("restore", "login", "--actor", "you"));
  const s = (await werk("show", "login")).stdout;
  expect(s).toContain("login");
  expect(s).not.toContain("session");
  ok(await werk("restore", "session", "--actor", "you"));
  expect((await werk("show", "login")).stdout).toMatch(/->\s+depends_on\s+session/);
});

test("08.4 a removed card's id stays taken; a cited source stays", async () => {
  seed(p, [
    open("login"),
    open("billing"),
    open("rfc-6749", { kind: "source", title: "RFC 6749" }),
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  ]);
  ok(await werk("remove", "login", "--actor", "you"));
  const src = (await werk("show", "rfc-6749")).stdout;
  expect(src).toContain("rfc-6749");
  expect(src).toContain("billing");
  expect((await werk("show", "billing")).stdout).toContain("rfc-6749");
  const before = p.events().length;
  const add = await werk("add", "login", "--title", "New login");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toMatch(/restore/);
  expect(add.stderr).toContain("login");
  expect(p.events().length).toBe(before);
  expect((await werk("show", "login")).code).toBe(1);
});

test("08.5 remove refuses without --actor you", async () => {
  seed(p, [open("login")]);
  const before = logText(p);
  const r = await werk("remove", "login");
  expect(r.code).not.toBe(0);
  expect((await werk("show", "login")).code).toBe(0);
  expect(logText(p)).toBe(before);
});

test("08.6 restore refuses without --actor you", async () => {
  seed(p, [open("login")]);
  ok(await werk("remove", "login", "--actor", "you"));
  const before = logText(p);
  const r = await werk("restore", "login");
  expect(r.code).not.toBe(0);
  expect((await werk("show", "login")).code).toBe(1);
  expect(logText(p)).toBe(before);
});

import { expect, test } from "bun:test";
import { useProject } from "../../src/test-env/project.ts";
import { decided, real, werkIn } from "./05-08-helpers.ts";

const project = useProject();
const werk = (...a: string[]) => werkIn(project())(...a);
const link = (from: string, to: string, type = "depends_on") =>
  werk("link", from, to, "--type", type, "--why", "needs it");

test("08.1 remove takes the subtree in one step, restore brings it back", async () => {
  await decided(werk, "auth", "Auth");
  await real(werk, "login", "Login", "auth");
  await real(werk, "session", "Session", "auth");
  await real(werk, "audit", "Audit");
  expect((await link("login", "audit")).code).toBe(0);
  const n = project().events().length;
  const rm = await werk("remove", "auth", "--actor", "you");
  expect(rm.code).toBe(0);
  expect(project().events().length).toBe(n + 1);
  for (const id of ["auth", "login", "session"]) {
    const s = await werk("show", id);
    expect(s.code).not.toBe(0);
  }
  const removed = await werk("removed");
  expect(removed.stdout).toContain("auth");
  expect(removed.stdout).toContain("login");
  expect(removed.stdout).toContain("session");
  expect((await werk("show", "audit")).stdout).not.toContain("login");
  expect((await werk("restore", "auth", "--actor", "you")).code).toBe(0);
  const auth = await werk("show", "auth");
  expect(auth.stdout).toContain("login");
  expect(auth.stdout).toContain("session");
  expect((await werk("show", "login")).stdout).toMatch(/depends_on\s+audit/);
  expect((await werk("show", "audit")).stdout).toContain("login");
  expect((await werk("removed")).stdout).toContain("nothing is removed");
});

test("08.2 remove --reparent moves children up, restore puts them back", async () => {
  await decided(werk, "platform", "Platform");
  await real(werk, "auth", "Auth", "platform");
  await real(werk, "login", "Login", "auth");
  await real(werk, "session", "Session", "auth");
  expect((await werk("remove", "auth", "--actor", "you", "--reparent")).code).toBe(0);
  expect((await werk("show", "auth")).code).not.toBe(0);
  const login = (await werk("show", "login")).stdout;
  expect(login).toMatch(/refines\s+platform/);
  expect((await werk("show", "session")).stdout).toMatch(/refines\s+platform/);
  expect((await werk("restore", "auth", "--actor", "you")).code).toBe(0);
  expect((await werk("show", "auth")).stdout).toMatch(/refines\s+platform/);
  const l2 = (await werk("show", "login")).stdout;
  expect(l2).toMatch(/refines\s+auth/);
  expect(l2).not.toMatch(/refines\s+platform/);
  expect((await werk("show", "session")).stdout).toMatch(/refines\s+auth/);
});

test("08.3 a link waits until both ends are back", async () => {
  await real(werk, "p1", "P1");
  await real(werk, "p2", "P2");
  await real(werk, "login", "Login", "p1");
  await real(werk, "session", "Session", "p2");
  expect((await link("login", "session")).code).toBe(0);
  expect((await werk("remove", "login", "--actor", "you")).code).toBe(0);
  expect((await werk("remove", "session", "--actor", "you")).code).toBe(0);
  expect((await werk("restore", "login", "--actor", "you")).code).toBe(0);
  const login = (await werk("show", "login")).stdout;
  expect(login).toContain("Login");
  expect(login).not.toContain("session");
  expect((await werk("restore", "session", "--actor", "you")).code).toBe(0);
  expect((await werk("show", "login")).stdout).toMatch(/depends_on\s+session/);
});

test("08.4 a removed id stays taken, a cited source stays", async () => {
  await real(werk, "login", "Login");
  await real(werk, "billing", "Billing");
  for (const id of ["login", "billing"]) {
    // source ids are made once; the second add is a link to the same source
    if (id === "login") {
      await werk("add", "rfc-6749", "--kind", "source", "--title", "RFC 6749", "--why", "spec");
      expect((await werk("accept", "rfc-6749", "--actor", "you")).code).toBe(0);
    }
    const r = await werk("link", id, "rfc-6749", "--type", "supported_by", "--why", "cites");
    expect(r.code).toBe(0);
  }
  expect((await werk("remove", "login", "--actor", "you")).code).toBe(0);
  const src = await werk("show", "rfc-6749");
  expect(src.code).toBe(0);
  expect(src.stdout).toContain("RFC 6749");
  const billing = await werk("show", "billing");
  expect(billing.stdout).toMatch(/Ev:\n\s+rfc-6749/);
  const n = project().events().length;
  const add = await werk("add", "login", "--title", "Login again");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toContain("restore");
  expect(add.stderr).toContain("login");
  expect(project().events().length).toBe(n);
  expect((await werk("show", "login")).code).not.toBe(0);
});

test("08.5 remove refuses without the person's say-so", async () => {
  await real(werk, "login", "Login");
  const n = project().events().length;
  const r = await werk("remove", "login");
  expect(r.code).not.toBe(0);
  expect((await werk("show", "login")).code).toBe(0);
  expect(project().events().length).toBe(n);
});

test("08.6 restore refuses without the person's say-so", async () => {
  await real(werk, "login", "Login");
  expect((await werk("remove", "login", "--actor", "you")).code).toBe(0);
  const n = project().events().length;
  const r = await werk("restore", "login");
  expect(r.code).not.toBe(0);
  expect((await werk("show", "login")).code).not.toBe(0);
  expect(project().events().length).toBe(n);
});

import { expect, test } from "bun:test";
import { werkHarness } from "./h.ts";

const { project, werk, must, decide, real } = werkHarness();

async function tree() {
  await decide("auth");
  await real("login", { parent: "auth" });
  await real("session", { parent: "auth" });
  await real("audit");
}

test("08.1 remove takes a subtree in one step and restore brings everything back", async () => {
  await tree();
  await must("link", "login", "audit", "--type", "depends_on", "--why", "audits");
  expect((await werk("show", "audit")).stdout).toContain("login");
  const n = project().events().length;
  const r = await werk("remove", "auth", "--actor", "you");
  expect(r.code).toBe(0);
  expect(project().events().length).toBe(n + 1);
  const last = project().events().at(-1) as Record<string, unknown>;
  expect(last.type).toBe("node.removed");
  for (const id of ["auth", "login", "session"]) {
    const s = await werk("show", id);
    expect(s.code).not.toBe(0);
    expect((await werk("search")).stdout).not.toContain(id);
    expect((await werk("find")).stdout).not.toMatch(new RegExp(`\\b${id}\\b`));
  }
  const removed = (await werk("removed")).stdout;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect((await werk("show", "audit")).stdout).not.toContain("login");
  expect((await werk("restore", "auth", "--actor", "you")).code).toBe(0);
  const auth = (await werk("show", "auth")).stdout;
  expect(auth).toContain("login");
  expect(auth).toContain("session");
  expect((await werk("show", "audit")).stdout).toContain("login");
  expect((await werk("removed")).stdout).toContain("nothing is removed");
});

test("08.2 remove with reparent moves the children up, restore puts them back", async () => {
  await decide("platform");
  await real("auth", { parent: "platform" });
  await real("login", { parent: "auth" });
  await real("session", { parent: "auth" });
  expect((await werk("remove", "auth", "--actor", "you", "--reparent")).code).toBe(0);
  expect((await werk("show", "auth")).code).not.toBe(0);
  const platform = (await werk("show", "platform")).stdout;
  expect(platform).toContain("login");
  expect(platform).toContain("session");
  const login = (await werk("show", "login")).stdout;
  expect(login).toMatch(/refines[^\n]*platform/);
  expect((await werk("restore", "auth", "--actor", "you")).code).toBe(0);
  expect((await werk("show", "platform")).stdout).toContain("auth");
  const login2 = (await werk("show", "login")).stdout;
  expect(login2).toMatch(/refines[^\n]*auth/);
  expect(login2).not.toMatch(/refines[^\n]*platform/);
  expect((await werk("show", "session")).stdout).toMatch(/refines[^\n]*auth/);
  const platform2 = (await werk("show", "platform")).stdout;
  console.log(platform2);
});

test("08.3 a link waits until both its ends are back", async () => {
  await decide("root1");
  await real("login", { parent: "root1" });
  await real("session", { parent: "root1" });
  await must("link", "login", "session", "--type", "depends_on", "--why", "w");
  expect((await werk("show", "login")).stdout).toContain("session");
  await must("remove", "login", "--actor", "you");
  await must("remove", "session", "--actor", "you");
  await must("restore", "login", "--actor", "you");
  const login = await werk("show", "login");
  expect(login.code).toBe(0);
  expect(login.stdout).not.toContain("depends_on");
  expect(login.stdout).not.toMatch(/\bsession\b/);
  await must("restore", "session", "--actor", "you");
  expect((await werk("show", "login")).stdout).toMatch(/depends_on[^\n]*session|session[^\n]*depends_on/);
});

test("08.4 a removed card's id stays taken and a cited source stays", async () => {
  await decide("root1");
  await real("login", { parent: "root1" });
  await real("billing", { parent: "root1" });
  await must("add", "rfc-6749", "--title", "RFC 6749", "--kind", "source");
  await must("accept", "rfc-6749", "--actor", "you");
  await must("link", "login", "rfc-6749", "--type", "supported_by");
  await must("link", "billing", "rfc-6749", "--type", "supported_by");
  await must("remove", "login", "--actor", "you");
  const src = await werk("show", "rfc-6749");
  expect(src.code).toBe(0);
  expect(src.stdout).toContain("rfc-6749");
  const billing = (await werk("show", "billing")).stdout;
  expect(billing).toMatch(/Ev:\n\s+rfc-6749/);
  const n = project().events().length;
  const add = await werk("add", "login", "--title", "New login");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toMatch(/restore/i);
  expect(add.stderr).toContain("login");
  expect(project().events().length).toBe(n);
  expect((await werk("show", "login")).code).not.toBe(0);
});

test("08.5 remove refuses without --actor you", async () => {
  await real("login");
  const n = project().events().length;
  const r = await werk("remove", "login");
  expect(r.code).not.toBe(0);
  expect((await werk("show", "login")).code).toBe(0);
  expect(project().events().length).toBe(n);
});

test("08.6 restore refuses without --actor you", async () => {
  await real("login");
  await must("remove", "login", "--actor", "you");
  const n = project().events().length;
  const r = await werk("restore", "login");
  expect(r.code).not.toBe(0);
  expect((await werk("show", "login")).code).not.toBe(0);
  expect(project().events().length).toBe(n);
});

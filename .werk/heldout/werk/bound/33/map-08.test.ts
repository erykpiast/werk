import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { decide, setup } from "./map-support.ts";

const s = setup();
beforeEach(() => {
  s.make();
});
afterEach(() => s.done());
const shown = async (id: string) => await s.werk("show", id);
const gone = async (id: string) => {
  const r = await shown(id);
  expect(r.code).not.toBe(0);
};
const ok = (r: { code: number; stderr: string }) => {
  if (r.code !== 0) throw new Error(`exit ${r.code}: ${r.stderr}`);
};
/** Adds a card and accepts it, so it is a real card. */
const add = async (...args: string[]) => {
  ok(await s.werk("add", ...args));
  ok(await s.werk("accept", args[0] as string, "--actor", "you"));
};
const log = () => readFileSync(s.p.logPath, "utf8");

async function tree() {
  await decide(s.werk, "auth", "Auth");
  for (const c of ["login", "session"])
    await add(c, "--title", c, "--why", "w", "--parent", "auth");
}

test("08.1 remove takes subtree, restore brings it back", async () => {
  await tree();
  await add("audit", "--title", "Audit", "--why", "w");
  ok(await s.werk("link", "login", "audit", "--type", "depends_on", "--why", "needs"));
  expect((await shown("login")).stdout).toContain("audit");
  const n = s.p.events().length;
  const r = await s.werk("remove", "auth", "--actor", "you");
  expect(r.code).toBe(0);
  expect(s.p.events().length).toBe(n + 1);
  const ev = s.p.events().at(-1) as { type: string };
  expect(ev.type).toBe("node.removed");
  for (const id of ["auth", "login", "session"]) await gone(id);
  const removed = (await s.werk("removed")).stdout;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect((await shown("audit")).stdout).not.toContain("login");
  ok(await s.werk("restore", "auth", "--actor", "you"));
  const auth = (await shown("auth")).stdout;
  expect(auth).toContain("login");
  expect(auth).toContain("session");
  expect((await shown("login")).stdout).toContain("audit");
  expect((await shown("audit")).stdout).toContain("login");
  expect((await s.werk("removed")).stdout).toContain("nothing is removed");
});

test("08.2 reparent remove and restore", async () => {
  await decide(s.werk, "platform", "Platform");
  await add("auth", "--title", "Auth", "--why", "w", "--parent", "platform");
  for (const c of ["login", "session"])
    await add(c, "--title", c, "--why", "w", "--parent", "auth");
  const r = await s.werk("remove", "auth", "--actor", "you", "--reparent");
  ok(r);
  await gone("auth");
  const plat = (await shown("platform")).stdout;
  expect(plat).toContain("login");
  expect(plat).toContain("session");
  expect((await shown("login")).stdout).toMatch(/refines\s+platform/);
  ok(await s.werk("restore", "auth", "--actor", "you"));
  expect((await shown("auth")).stdout).toContain("platform");
  expect((await shown("login")).stdout).toMatch(/refines\s+auth/);
  expect((await shown("session")).stdout).toMatch(/refines\s+auth/);
  expect((await shown("platform")).stdout).not.toMatch(/<- refines\s+login/);
});

test("08.3 link waits for both ends", async () => {
  await add("login", "--title", "Login", "--why", "w");
  await add("session", "--title", "Session", "--why", "w");
  await s.werk("link", "login", "session", "--type", "depends_on", "--why", "r");
  for (const id of ["login", "session"]) ok(await s.werk("remove", id, "--actor", "you"));
  ok(await s.werk("restore", "login", "--actor", "you"));
  expect((await shown("login")).code).toBe(0);
  expect((await shown("login")).stdout).not.toContain("session");
  ok(await s.werk("restore", "session", "--actor", "you"));
  expect((await shown("login")).stdout).toContain("session");
});

test("08.4 removed id stays taken, cited source stays", async () => {
  await add("login", "--title", "Login", "--why", "w");
  await add("billing", "--title", "Billing", "--why", "w");
  await add("rfc-6749", "--title", "RFC", "--kind", "source");
  for (const c of ["login", "billing"]) await s.werk("link", c, "rfc-6749", "--type", "supported_by");
  ok(await s.werk("remove", "login", "--actor", "you"));
  const src = await shown("rfc-6749");
  expect(src.code).toBe(0);
  expect(src.stdout).toContain("rfc-6749");
  const billing = (await shown("billing")).stdout;
  expect(billing).toContain("rfc-6749");
  expect((await shown("login")).code).not.toBe(0);
  const n = s.p.events().length;
  const again = await s.werk("add", "login", "--title", "New", "--why", "w");
  expect(again.code).not.toBe(0);
  expect(again.stderr).toContain("restore");
  expect(again.stderr).toContain("login");
  expect(s.p.events().length).toBe(n);
  await gone("login");
});

test("08.5 remove without actor refuses", async () => {
  await add("login", "--title", "Login", "--why", "w");
  const n = s.p.events().length;
  const r = await s.werk("remove", "login");
  expect(r.code).not.toBe(0);
  expect((await shown("login")).code).toBe(0);
  expect(s.p.events().length).toBe(n);
});

test("08.6 restore without actor refuses", async () => {
  await add("login", "--title", "Login", "--why", "w");
  await s.werk("remove", "login", "--actor", "you");
  const n = s.p.events().length;
  const r = await s.werk("restore", "login");
  expect(r.code).not.toBe(0);
  await gone("login");
  expect(s.p.events().length).toBe(n);
});

import { afterEach, beforeEach, expect, test } from "bun:test";
import { card, createProject, decided, ev, link, type Project, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const shows = async (id: string) => (await werk(p, "show", id)).code === 0;

test("08.1 remove with its subtree and restore", async () => {
  decided(p, "auth", "Auth");
  decided(p, "login", "Login", { parent: "auth" });
  decided(p, "session", "Session", { parent: "auth" });
  decided(p, "audit", "Audit");
  link(p, "login", "audit", "depends_on", "audit trail");
  const before = p.events().length;
  const r = await werk(p, "remove", "auth", "--actor", "you");
  expect(r.code, `remove exit ${r.code}: ${r.stderr}`).toBe(0);
  for (const id of ["auth", "login", "session"]) expect(await shows(id)).toBe(false);
  expect(p.events().length).toBe(before + 1);
  const removed = await werk(p, "removed");
  expect(removed.code, `removed: ${removed.stderr}`).toBe(0);
  for (const id of ["auth", "login", "session"]) expect(removed.stdout).toContain(id);
  expect((await werk(p, "show", "audit")).stdout).not.toContain("login");
  const back = await werk(p, "restore", "auth", "--actor", "you");
  expect(back.code, `restore exit ${back.code}: ${back.stderr}`).toBe(0);
  const a = (await werk(p, "show", "auth")).stdout;
  expect(a).toContain("login");
  expect(a).toContain("session");
  expect((await werk(p, "show", "audit")).stdout).toContain("login");
  expect((await werk(p, "removed")).stdout.trim()).toBe("");
});

test("08.2 remove with reparent and restore", async () => {
  decided(p, "platform", "Platform");
  decided(p, "auth", "Auth", { parent: "platform" });
  decided(p, "login", "Login", { parent: "auth" });
  decided(p, "session", "Session", { parent: "auth" });
  const r = await werk(p, "remove", "auth", "--actor", "you", "--reparent");
  expect(r.code, `remove exit ${r.code}: ${r.stderr}`).toBe(0);
  expect(await shows("auth")).toBe(false);
  const plat = (await werk(p, "show", "platform")).stdout;
  expect(plat).toContain("login");
  expect(plat).toContain("session");
  const back = await werk(p, "restore", "auth", "--actor", "you");
  expect(back.code, `restore exit ${back.code}: ${back.stderr}`).toBe(0);
  const plat2 = (await werk(p, "show", "platform")).stdout;
  expect(plat2).toContain("auth");
  expect(plat2).not.toContain("login");
  const auth = (await werk(p, "show", "auth")).stdout;
  expect(auth).toContain("login");
  expect(auth).toContain("session");
});

test("08.3 a link waits until both ends are back", async () => {
  card(p, "top", "Top");
  card(p, "login", "Login");
  card(p, "session", "Session");
  link(p, "login", "session", "depends_on", "needs it");
  for (const [verb, id] of [
    ["remove", "login"],
    ["remove", "session"],
    ["restore", "login"],
  ] as const) {
    const r = await werk(p, verb, id, "--actor", "you");
    expect(r.code, `${verb} ${id} exit ${r.code}: ${r.stderr}`).toBe(0);
  }
  const l = (await werk(p, "show", "login")).stdout;
  expect(l).toContain("Login");
  expect(l).not.toContain("depends_on");
  const r = await werk(p, "restore", "session", "--actor", "you");
  expect(r.code, `restore exit ${r.code}: ${r.stderr}`).toBe(0);
  expect((await werk(p, "show", "login")).stdout).toContain("depends_on");
});

test("08.4 removed id stays taken, cited source stays", async () => {
  card(p, "login", "Login");
  card(p, "billing", "Billing");
  card(p, "rfc-6749", "RFC 6749", { kind: "source" });
  link(p, "login", "rfc-6749", "supported_by");
  link(p, "billing", "rfc-6749", "supported_by");
  const r = await werk(p, "remove", "login", "--actor", "you");
  expect(r.code, `remove exit ${r.code}: ${r.stderr}`).toBe(0);
  const s = await werk(p, "show", "rfc-6749");
  expect(s.code).toBe(0);
  expect(s.stdout).toContain("billing");
  const before = p.events().length;
  const add = await werk(p, "add", "login", "--title", "New login");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toContain("restore");
  expect(add.stderr).toContain("login");
  expect(p.events().length).toBe(before);
});

test("08.5 remove refuses without --actor you", async () => {
  card(p, "login", "Login");
  const before = p.events().length;
  const r = await werk(p, "remove", "login");
  expect(r.code, `remove without actor exit ${r.code}, stdout: ${r.stdout}`).not.toBe(0);
  expect(await shows("login")).toBe(true);
  expect(p.events().length).toBe(before);
});

test("08.6 restore refuses without --actor you", async () => {
  card(p, "login", "Login");
  const r1 = await werk(p, "remove", "login", "--actor", "you");
  expect(r1.code, `remove exit ${r1.code}: ${r1.stderr}`).toBe(0);
  const before = p.events().length;
  const r = await werk(p, "restore", "login");
  expect(r.code, `restore without actor exit ${r.code}`).not.toBe(0);
  expect(await shows("login")).toBe(false);
  expect(p.events().length).toBe(before);
});

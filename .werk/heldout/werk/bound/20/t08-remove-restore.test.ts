import { expect, test } from "bun:test";
import { useProject } from "../src/test-env/project.ts";
import { all, decided, edge, real, seed, werk } from "./helpers.ts";

const project = useProject();
type Ev = { type: string };
const count = (p: ReturnType<typeof project>, type: string) =>
  p.events().filter((e) => (e as Ev).type === type).length;

const gone = async (p: ReturnType<typeof project>, id: string) =>
  (await werk(p, "show", id)).code !== 0;

test("08.1 removing a card takes its subtree out in one step; restore brings it back", async () => {
  const p = project();
  seed(
    p,
    decided("auth"),
    real("login", { parent: "auth" }),
    real("session", { parent: "auth" }),
    real("audit"),
    edge("login", "audit", "depends_on", "login writes the audit trail"),
  );
  const before = p.events().length;
  const removed = await werk(p, "remove", "auth", "--actor", "you");
  expect(all(removed)).toContain("removed");
  expect(removed.code).toBe(0);
  for (const id of ["auth", "login", "session"]) expect(await gone(p, id)).toBe(true);
  expect(p.events().length).toBe(before + 1);
  expect(count(p, "node.removed")).toBe(1);
  const list = await werk(p, "removed");
  expect(list.code).toBe(0);
  for (const id of ["auth", "login", "session"]) expect(list.stdout).toContain(id);
  const audit = await werk(p, "show", "audit");
  expect(audit.stdout).not.toContain("login");

  const restored = await werk(p, "restore", "auth", "--actor", "you");
  expect(restored.code).toBe(0);
  const auth = await werk(p, "show", "auth");
  expect(auth.stdout).toMatch(/<- refines\s+login/);
  expect(auth.stdout).toMatch(/<- refines\s+session/);
  const audit2 = await werk(p, "show", "audit");
  expect(audit2.stdout).toMatch(/<- depends_on\s+login/);
  const list2 = await werk(p, "removed");
  expect(list2.code).toBe(0);
  expect(list2.stdout.trim()).toBe("");
});

test("08.2 remove --reparent moves the children up; restore puts them back", async () => {
  const p = project();
  seed(
    p,
    real("platform"),
    real("auth", { parent: "platform" }),
    real("login", { parent: "auth" }),
    real("session", { parent: "auth" }),
  );
  const removed = await werk(p, "remove", "auth", "--actor", "you", "--reparent");
  expect(removed.code).toBe(0);
  expect(await gone(p, "auth")).toBe(true);
  const platform = await werk(p, "show", "platform");
  expect(platform.stdout).toMatch(/<- refines\s+login/);
  expect(platform.stdout).toMatch(/<- refines\s+session/);
  const restored = await werk(p, "restore", "auth", "--actor", "you");
  expect(restored.code).toBe(0);
  const platform2 = await werk(p, "show", "platform");
  expect(platform2.stdout).toMatch(/<- refines\s+auth/);
  expect(platform2.stdout).not.toMatch(/<- refines\s+login/);
  expect(platform2.stdout).not.toMatch(/<- refines\s+session/);
  const auth = await werk(p, "show", "auth");
  expect(auth.stdout).toMatch(/<- refines\s+login/);
  expect(auth.stdout).toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both of its ends are back", async () => {
  const p = project();
  seed(
    p,
    real("a"),
    real("b"),
    real("login", { parent: "a" }),
    real("session", { parent: "b" }),
    edge("login", "session", "depends_on", "login needs the session"),
  );
  for (const id of ["login", "session"]) {
    const r = await werk(p, "remove", id, "--actor", "you");
    expect(r.code).toBe(0);
  }
  const r1 = await werk(p, "restore", "login", "--actor", "you");
  expect(r1.code).toBe(0);
  const login = await werk(p, "show", "login");
  expect(login.code).toBe(0);
  expect(login.stdout).not.toMatch(/-> depends_on\s+session/);
  const r2 = await werk(p, "restore", "session", "--actor", "you");
  expect(r2.code).toBe(0);
  const login2 = await werk(p, "show", "login");
  expect(login2.stdout).toMatch(/-> depends_on\s+session/);
});

test("08.4 a removed card's id stays taken and a cited source stays", async () => {
  const p = project();
  seed(
    p,
    real("login"),
    real("billing"),
    real("rfc-6749", { kind: "source", title: "OAuth 2.0 RFC" }),
    edge("login", "rfc-6749", "supported_by", "the RFC defines it"),
    edge("billing", "rfc-6749", "supported_by", "the RFC defines it"),
  );
  const removed = await werk(p, "remove", "login", "--actor", "you");
  expect(removed.code).toBe(0);
  const source = await werk(p, "show", "rfc-6749");
  expect(source.code).toBe(0);
  expect(source.stdout).toMatch(/<- supported_by\s+billing/);
  expect(source.stdout).not.toMatch(/<- supported_by\s+login/);
  const before = p.events().length;
  const add = await werk(p, "add", "login", "--title", "Login again");
  expect(add.code).not.toBe(0);
  expect(all(add)).toMatch(/restore/);
  expect(all(add)).toContain("login");
  expect(p.events().length).toBe(before);
  expect(await gone(p, "login")).toBe(true);
});

test("08.5 remove refuses without --actor you", async () => {
  const p = project();
  seed(p, real("login"));
  const before = p.events().length;
  const r = await werk(p, "remove", "login");
  expect(r.code).not.toBe(0);
  expect((await werk(p, "show", "login")).code).toBe(0);
  expect(p.events().length).toBe(before);
});

test("08.6 restore refuses without --actor you", async () => {
  const p = project();
  seed(p, real("login"), { type: "node.removed", id: "login" });
  const removed = p.events().length;
  // the person removes it with the real command
  void removed;
  const r0 = await werk(p, "show", "login");
  expect(r0.code).not.toBe(0);
  const before = p.events().length;
  const r = await werk(p, "restore", "login");
  expect(r.code).not.toBe(0);
  expect((await werk(p, "show", "login")).code).not.toBe(0);
  expect(p.events().length).toBe(before);
});

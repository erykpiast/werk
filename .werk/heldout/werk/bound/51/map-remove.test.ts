import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import { decided, edge, logText, put, real, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const shows = async (id: string) => (await werk(p, "show", id)).code === 0;

test("08.1 remove takes the subtree, restore brings it back", async () => {
  put(
    p,
    decided("auth", "Auth"),
    real("login", "Login", { parent: "auth" }),
    real("session", "Session", { parent: "auth" }),
    real("audit", "Audit"),
    edge("login", "audit", "depends_on"),
  );
  const before = p.events().length;
  const r = await werk(p, "remove", "auth", "--actor", "you");
  expect(r.stderr).toBe("");
  expect(r.code).toBe(0);
  for (const id of ["auth", "login", "session"]) expect(await shows(id)).toBe(false);
  expect(p.events().length).toBe(before + 1);
  const removed = await werk(p, "removed");
  expect(removed.code).toBe(0);
  expect(removed.stdout).toContain("auth");
  expect(removed.stdout).toContain("login");
  expect(removed.stdout).toContain("session");
  expect((await werk(p, "show", "audit")).stdout).not.toContain("login");
  const back = await werk(p, "restore", "auth", "--actor", "you");
  expect(back.code).toBe(0);
  const auth = (await werk(p, "show", "auth")).stdout;
  expect(auth).toContain("login");
  expect(auth).toContain("session");
  expect((await werk(p, "show", "audit")).stdout).toContain("login");
  expect((await werk(p, "removed")).stdout.trim()).toBe("");
});

test("08.2 remove with reparent moves children up, restore puts back", async () => {
  put(
    p,
    decided("platform", "Platform"),
    real("auth", "Auth", { parent: "platform" }),
    real("login", "Login", { parent: "auth" }),
    real("session", "Session", { parent: "auth" }),
  );
  const r = await werk(p, "remove", "auth", "--actor", "you", "--reparent");
  expect(r.stderr).toBe("");
  expect(r.code).toBe(0);
  expect(await shows("auth")).toBe(false);
  const plat = (await werk(p, "show", "platform")).stdout;
  expect(plat).toContain("login");
  expect(plat).toContain("session");
  const back = await werk(p, "restore", "auth", "--actor", "you");
  expect(back.code).toBe(0);
  const plat2 = (await werk(p, "show", "platform")).stdout;
  expect(plat2).toContain("auth");
  expect(plat2).not.toMatch(/<- refines\s+login/);
  expect((await werk(p, "show", "auth")).stdout).toMatch(/<- refines\s+login/);
});

test("08.3 a link waits until both ends are back", async () => {
  put(
    p,
    decided("root", "Root"),
    real("login", "Login", { parent: "root" }),
    real("session", "Session", { parent: "root" }),
    edge("login", "session", "depends_on"),
  );
  for (const id of ["login", "session"]) {
    const r = await werk(p, "remove", id, "--actor", "you");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  }
  expect((await werk(p, "restore", "login", "--actor", "you")).code).toBe(0);
  expect(await shows("login")).toBe(true);
  expect((await werk(p, "show", "login")).stdout).not.toMatch(/depends_on\s+session/);
  expect((await werk(p, "restore", "session", "--actor", "you")).code).toBe(0);
  expect((await werk(p, "show", "login")).stdout).toMatch(/depends_on\s+session/);
});

test("08.4 removed id stays taken, cited source stays", async () => {
  put(
    p,
    decided("root", "Root"),
    real("login", "Login", { parent: "root" }),
    real("billing", "Billing", { parent: "root" }),
    { type: "node.proposed", id: "rfc-6749", kind: "source", title: "RFC 6749", status: "open" },
    { type: "node.accepted", id: "rfc-6749", actor: "you" },
    edge("login", "rfc-6749", "supported_by"),
    edge("billing", "rfc-6749", "supported_by"),
  );
  const r = await werk(p, "remove", "login", "--actor", "you");
  expect(r.stderr).toBe("");
  expect(r.code).toBe(0);
  const src = (await werk(p, "show", "rfc-6749")).stdout;
  expect(src).toContain("RFC 6749");
  expect((await werk(p, "show", "billing")).stdout).toContain("RFC 6749");
  const add = await werk(p, "add", "login", "--title", "New login");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toContain("restore");
  expect(add.stderr).toContain("login");
  expect(logText(p)).not.toContain("New login");
});

test("08.5 remove without --actor you refuses", async () => {
  put(p, decided("root", "Root"), real("login", "Login", { parent: "root" }));
  const n = p.events().length;
  const r = await werk(p, "remove", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(true);
  expect(p.events().length).toBe(n);
});

test("08.6 restore without --actor you refuses", async () => {
  put(p, decided("root", "Root"), real("login", "Login", { parent: "root" }));
  const rm = await werk(p, "remove", "login", "--actor", "you");
  expect(rm.stderr).toBe("");
  expect(rm.code).toBe(0);
  const n = p.events().length;
  const r = await werk(p, "restore", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(false);
  expect(p.events().length).toBe(n);
});

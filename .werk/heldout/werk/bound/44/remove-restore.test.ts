import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import {
  decided,
  foldMap,
  ghost,
  link,
  problems,
  real,
  seed,
  werk,
} from "./lib.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const shown = async (id: string) => {
  const r = await werk(project, "show", id);
  return r.code === 0;
};
const logLines = () => project.events().length;

function authMap() {
  seed(project, [
    ...decided("root", "Root"),
    ...decided("auth", "Auth", { parent: "root" }),
    ...decided("login", "Login", { parent: "auth" }),
    ...decided("session", "Session", { parent: "auth" }),
    ...decided("audit", "Audit", { parent: "root" }),
    link("login", "audit", "depends_on", "login writes audit"),
  ]);
  expect(problems(project)).toEqual([]);
}

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  authMap();
  const before = logLines();
  const removed = await werk(project, "remove", "auth", "--actor", "you");
  expect(removed.code, removed.stderr).toBe(0);
  for (const id of ["auth", "login", "session"]) {
    expect(await shown(id), `${id} still shows`).toBe(false);
  }
  const index = (await werk(project, "search")).stdout;
  expect(index).not.toMatch(/\bauth\b|\blogin\b|\bsession\b/);
  expect(logLines()).toBe(before + 1);
  expect((project.events().at(-1) as { type: string }).type).toBe("node.removed");

  const list = await werk(project, "removed");
  expect(list.code, list.stderr).toBe(0);
  expect(list.stdout).toContain("auth");
  expect(list.stdout).toContain("login");
  expect(list.stdout).toContain("session");
  const audit = (await werk(project, "show", "audit")).stdout;
  expect(audit).not.toContain("login");

  const restored = await werk(project, "restore", "auth", "--actor", "you");
  expect(restored.code, restored.stderr).toBe(0);
  const auth = (await werk(project, "show", "auth")).stdout;
  expect(auth).toContain("login");
  expect(auth).toContain("session");
  expect((await werk(project, "show", "audit")).stdout).toContain("login");
  const empty = await werk(project, "removed");
  expect(empty.code, empty.stderr).toBe(0);
  expect(empty.stdout).not.toContain("auth");
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  seed(project, [
    ...decided("root", "Root"),
    ...decided("platform", "Platform", { parent: "root" }),
    ...decided("auth", "Auth", { parent: "platform" }),
    ...decided("login", "Login", { parent: "auth" }),
    ...decided("session", "Session", { parent: "auth" }),
  ]);
  expect(problems(project)).toEqual([]);
  const r = await werk(project, "remove", "auth", "--actor", "you", "--reparent");
  expect(r.code, r.stderr).toBe(0);
  expect(await shown("auth")).toBe(false);
  let map = foldMap(project);
  expect(map.parents.get("login")).toBe("platform");
  expect(map.parents.get("session")).toBe("platform");
  const back = await werk(project, "restore", "auth", "--actor", "you");
  expect(back.code, back.stderr).toBe(0);
  map = foldMap(project);
  expect(map.parents.get("auth")).toBe("platform");
  expect(map.parents.get("login")).toBe("auth");
  expect(map.parents.get("session")).toBe("auth");
});

test("08.3 a link waits until both of its ends are back", async () => {
  seed(project, [
    ...decided("root", "Root"),
    ...decided("a", "Branch A", { parent: "root" }),
    ...decided("b", "Branch B", { parent: "root" }),
    ...decided("login", "Login", { parent: "a" }),
    ...decided("session", "Session", { parent: "b" }),
    link("login", "session", "depends_on", "needs a session"),
  ]);
  expect(problems(project)).toEqual([]);
  expect((await werk(project, "remove", "login", "--actor", "you")).code).toBe(0);
  expect((await werk(project, "remove", "session", "--actor", "you")).code).toBe(0);
  expect((await werk(project, "restore", "login", "--actor", "you")).code).toBe(0);
  expect(await shown("login")).toBe(true);
  let map = foldMap(project);
  expect(map.edges.some((e) => e.from === "login" && e.to === "session")).toBe(false);
  expect((await werk(project, "restore", "session", "--actor", "you")).code).toBe(0);
  map = foldMap(project);
  expect(map.edges.some((e) => e.from === "login" && e.to === "session")).toBe(true);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  seed(project, [
    ...decided("root", "Root"),
    ...decided("login", "Login", { parent: "root" }),
    ...decided("billing", "Billing", { parent: "root" }),
    {
      type: "node.proposed",
      id: "rfc-6749",
      kind: "source",
      title: "RFC 6749",
      status: "open",
      why: "OAuth 2.0",
    },
    { type: "node.accepted", id: "rfc-6749", actor: "you" },
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  ]);
  expect(problems(project)).toEqual([]);
  const r = await werk(project, "remove", "login", "--actor", "you");
  expect(r.code, r.stderr).toBe(0);
  const billing = (await werk(project, "show", "billing")).stdout;
  expect(billing).toContain("rfc-6749");
  expect((await werk(project, "show", "rfc-6749")).code).toBe(0);
  const before = logLines();
  const add = await werk(project, "add", "login", "--title", "New login");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toMatch(/restore/);
  expect(add.stderr).toContain("login");
  expect(logLines()).toBe(before);
  expect(foldMap(project).nodes.get("login")).toBeUndefined();
});

test("08.5 remove refuses without the person's say-so", async () => {
  seed(project, [...decided("root", "Root"), ...decided("login", "Login", { parent: "root" })]);
  const before = logLines();
  const r = await werk(project, "remove", "login");
  expect(r.code).not.toBe(0);
  expect(await shown("login")).toBe(true);
  expect(logLines()).toBe(before);
});

test("08.6 restore refuses without the person's say-so", async () => {
  seed(project, [...decided("root", "Root"), ...decided("login", "Login", { parent: "root" })]);
  const rm = await werk(project, "remove", "login", "--actor", "you");
  expect(rm.code, rm.stderr).toBe(0);
  const before = logLines();
  const r = await werk(project, "restore", "login");
  expect(r.code).not.toBe(0);
  expect(await shown("login")).toBe(false);
  expect(logLines()).toBe(before);
});

import { afterEach, expect, test } from "bun:test";
import { decided, lines, link, mapOf, mk, open, type Project } from "./h.ts";
import { headerRead } from "../../src/serve/read-api.ts";
import { shapeRead } from "../../src/serve/read-api.ts";

let p: Project | undefined;
afterEach(() => p?.dispose());

const inMap = (project: Project, id: string) =>
  headerRead(mapOf(project)).entries.some((e) => e.id === id) &&
  shapeRead(mapOf(project)).nodes.some((n) => n.id === id);
const linked = (project: Project, a: string, b: string) =>
  shapeRead(mapOf(project)).edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));

const tree = () => [
  ...decided("auth"),
  ...open("login", { parent: "auth" }),
  ...open("session", { parent: "auth" }),
  ...open("audit"),
  link("login", "audit"),
];

test("08.1 remove subtree and restore", async () => {
  const { project, werk } = mk(tree());
  p = project;
  expect(linked(project, "login", "audit")).toBe(true);
  const n = lines(project).length;
  expect((await werk("remove", "auth", "--actor", "you")).code).toBe(0);
  for (const id of ["auth", "login", "session"]) expect(inMap(project, id)).toBe(false);
  expect(lines(project).length).toBe(n + 1);
  expect(linked(project, "login", "audit")).toBe(false);
  expect((await werk("show", "auth")).code).not.toBe(0);
  const removed = (await werk("removed")).stdout;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect((await werk("restore", "auth", "--actor", "you")).code).toBe(0);
  const shown = (await werk("show", "auth")).stdout;
  expect(shown).toContain("login");
  expect(shown).toContain("session");
  expect(linked(project, "login", "audit")).toBe(true);
  expect((await werk("removed")).stdout.trim()).toBe("nothing is removed");
});

test("08.2 reparent remove and restore", async () => {
  const { project, werk } = mk([
    ...decided("platform"),
    ...open("auth", { parent: "platform" }),
    ...open("login", { parent: "auth" }),
    ...open("session", { parent: "auth" }),
  ]);
  p = project;
  expect((await werk("remove", "auth", "--actor", "you", "--reparent")).code).toBe(0);
  expect(inMap(project, "auth")).toBe(false);
  let m = mapOf(project);
  expect(m.parents.get("login")).toBe("platform");
  expect(m.parents.get("session")).toBe("platform");
  expect((await werk("restore", "auth", "--actor", "you")).code).toBe(0);
  m = mapOf(project);
  expect(m.parents.get("auth")).toBe("platform");
  expect(m.parents.get("login")).toBe("auth");
  expect(m.parents.get("session")).toBe("auth");
});

test("08.3 link waits for both ends", async () => {
  const { project, werk } = mk([
    ...open("root"),
    ...open("a", { parent: "root" }),
    ...open("b", { parent: "root" }),
    ...open("login", { parent: "a" }),
    ...open("session", { parent: "b" }),
    link("login", "session"),
  ]);
  p = project;
  expect(linked(project, "login", "session")).toBe(true);
  await werk("remove", "login", "--actor", "you");
  await werk("remove", "session", "--actor", "you");
  expect((await werk("restore", "login", "--actor", "you")).code).toBe(0);
  expect(inMap(project, "login")).toBe(true);
  expect(linked(project, "login", "session")).toBe(false);
  expect((await werk("show", "login")).stdout).not.toContain("session");
  expect((await werk("restore", "session", "--actor", "you")).code).toBe(0);
  expect(linked(project, "login", "session")).toBe(true);
});

test("08.4 removed id stays taken, source stays", async () => {
  const { project, werk } = mk([
    ...open("root"),
    ...open("login", { parent: "root" }),
    ...open("billing", { parent: "root" }),
    ...open("rfc-6749", { kind: "source" }),
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  ]);
  p = project;
  expect(mapOf(project).problems).toEqual([]);
  expect((await werk("remove", "login", "--actor", "you")).code).toBe(0);
  expect(inMap(project, "rfc-6749")).toBe(true);
  expect(linked(project, "billing", "rfc-6749")).toBe(true);
  expect((await werk("show", "billing")).stdout).toContain("rfc-6749");
  const n = lines(project).length;
  const add = await werk("add", "login", "--title", "New login", "--parent", "root");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toContain("restore");
  expect(add.stderr).toContain("login");
  expect(lines(project).length).toBe(n);
  expect(mapOf(project).nodes.get("login")).toBeUndefined();
});

test("08.5 remove without actor refused", async () => {
  const { project, werk } = mk(open("login"));
  p = project;
  const n = lines(project).length;
  const r = await werk("remove", "login");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toContain("refused");
  expect(inMap(project, "login")).toBe(true);
  expect(lines(project).length).toBe(n);
});

test("08.6 restore without actor refused", async () => {
  const { project, werk } = mk(open("login"));
  p = project;
  expect((await werk("remove", "login", "--actor", "you")).code).toBe(0);
  const n = lines(project).length;
  const r = await werk("restore", "login");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toContain("refused");
  expect(inMap(project, "login")).toBe(false);
  expect(lines(project).length).toBe(n);
});

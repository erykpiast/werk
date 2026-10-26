import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readMap } from "../src/map/log-store.ts";
import { createProject, dec, link, type Project, runner, seed } from "./helpers.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const map = () => readMap(project.logPath).map;
const lines = () => readFileSync(project.logPath, "utf8").trim().split("\n").length;
const hasEdge = (a: string, b: string) =>
  map().edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));

test("08.1 remove takes the subtree out, restore brings it back", async () => {
  const w = runner(project);
  seed(project, dec("auth"), dec("login", "auth"), dec("session", "auth"), dec("audit"), link("login", "audit", "depends_on"));
  const n = lines();
  const r = await w("remove", "auth", "--actor", "you");
  expect(r.stderr).toBe("");
  expect(r.code).toBe(0);
  for (const id of ["auth", "login", "session"]) expect(map().nodes.has(id)).toBe(false);
  expect(lines()).toBe(n + 1);
  const removed = await w("removed");
  expect(removed.code).toBe(0);
  expect(removed.stdout).toContain("auth");
  expect(removed.stdout).toContain("login");
  expect(removed.stdout).toContain("session");
  expect(hasEdge("login", "audit")).toBe(false);
  const back = await w("restore", "auth", "--actor", "you");
  expect(back.code).toBe(0);
  expect(map().parents.get("login")).toBe("auth");
  expect(map().parents.get("session")).toBe("auth");
  expect(hasEdge("login", "audit")).toBe(true);
  expect((await w("removed")).stdout.trim()).toBe("");
});

test("08.2 remove --reparent moves the children up, restore puts them back", async () => {
  const w = runner(project);
  seed(project, dec("platform"), dec("auth", "platform"), dec("login", "auth"), dec("session", "auth"));
  const r = await w("remove", "auth", "--actor", "you", "--reparent");
  expect(r.stderr).toBe("");
  expect(map().nodes.has("auth")).toBe(false);
  expect(map().parents.get("login")).toBe("platform");
  expect(map().parents.get("session")).toBe("platform");
  const back = await w("restore", "auth", "--actor", "you");
  expect(back.code).toBe(0);
  expect(map().parents.get("auth")).toBe("platform");
  expect(map().parents.get("login")).toBe("auth");
  expect(map().parents.get("session")).toBe("auth");
});

test("08.3 a link waits until both ends are back", async () => {
  const w = runner(project);
  seed(project, dec("a"), dec("b"), dec("login", "a"), dec("session", "b"), link("login", "session", "depends_on"));
  expect((await w("remove", "login", "--actor", "you")).code).toBe(0);
  expect((await w("remove", "session", "--actor", "you")).code).toBe(0);
  expect((await w("restore", "login", "--actor", "you")).code).toBe(0);
  expect(map().nodes.has("login")).toBe(true);
  expect(hasEdge("login", "session")).toBe(false);
  expect((await w("restore", "session", "--actor", "you")).code).toBe(0);
  expect(hasEdge("login", "session")).toBe(true);
});

test("08.4 a removed id stays taken and a cited source stays", async () => {
  const w = runner(project);
  seed(project, dec("login"), dec("billing"),
    { type: "node.proposed", id: "rfc-6749", kind: "source", title: "RFC 6749", status: "open" },
    { type: "node.accepted", id: "rfc-6749", actor: "you" },
    link("login", "rfc-6749", "supported_by"), link("billing", "rfc-6749", "supported_by"));
  expect((await w("remove", "login", "--actor", "you")).code).toBe(0);
  expect(map().nodes.has("rfc-6749")).toBe(true);
  expect(map().edges.some((e) => e.from === "billing" && e.to === "rfc-6749")).toBe(true);
  const add = await w("add", "login", "--title", "New login");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toMatch(/restore/);
  expect(add.stderr).toContain("login");
  expect(map().nodes.has("login")).toBe(false);
});

test("08.5 remove without --actor you refuses", async () => {
  const w = runner(project);
  seed(project, dec("login"));
  const n = lines();
  const r = await w("remove", "login");
  expect(r.code).not.toBe(0);
  expect(map().nodes.has("login")).toBe(true);
  expect(lines()).toBe(n);
});

test("08.6 restore without --actor you refuses", async () => {
  const w = runner(project);
  seed(project, dec("login"));
  expect((await w("remove", "login", "--actor", "you")).code).toBe(0);
  const n = lines();
  const r = await w("restore", "login");
  expect(r.code).not.toBe(0);
  expect(map().nodes.has("login")).toBe(false);
  expect(lines()).toBe(n);
});

import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import { decided, link, logText, open, seed, viewEdges, viewIds, werk } from "./g2-util.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const tree = () =>
  seed(p, [
    decided("auth"),
    open("login", { parent: "auth" }),
    open("session", { parent: "auth" }),
    open("audit"),
    link("login", "audit", "depends_on"),
  ]);
const hasEdge = (a: string, b: string) =>
  viewEdges(p).some((e) => e.from === a && e.to === b && e.type === "depends_on");

test("08.1 remove takes the subtree, restore brings it back", async () => {
  tree();
  const before = p.events().length;
  const r = await werk(p, "remove", "auth", "--actor", "you");
  expect(r.code).toBe(0);
  const ids = viewIds(p);
  for (const id of ["auth", "login", "session"]) expect(ids).not.toContain(id);
  expect(p.events().length).toBe(before + 1);
  const last = p.events().at(-1) as { type: string };
  expect(last.type).toBe("node.removed");
  const removed = await werk(p, "removed");
  expect(removed.stdout).toContain("auth");
  expect(removed.stdout).toContain("login");
  expect(removed.stdout).toContain("session");
  expect(hasEdge("login", "audit")).toBe(false);
  const shown = await werk(p, "show", "audit");
  expect(shown.stdout).not.toContain("login");

  expect((await werk(p, "restore", "auth", "--actor", "you")).code).toBe(0);
  const after = await werk(p, "show", "auth");
  expect(after.code).toBe(0);
  expect(after.stdout).toContain("login");
  expect(after.stdout).toContain("session");
  expect(hasEdge("login", "audit")).toBe(true);
  expect((await werk(p, "removed")).stdout).toContain("nothing is removed");
});

test("08.2 remove --reparent moves children up, restore puts them back", async () => {
  seed(p, [
    decided("platform"),
    open("auth", { parent: "platform" }),
    open("login", { parent: "auth" }),
    open("session", { parent: "auth" }),
  ]);
  expect((await werk(p, "remove", "auth", "--actor", "you", "--reparent")).code).toBe(0);
  expect(viewIds(p)).not.toContain("auth");
  const parents = () => mapOf2();
  const mapOf2 = () => {
    const edges = viewEdges(p).filter((e) => e.type === "refines");
    return Object.fromEntries(edges.map((e) => [e.from, e.to]));
  };
  expect(parents().login).toBe("platform");
  expect(parents().session).toBe("platform");
  expect((await werk(p, "restore", "auth", "--actor", "you")).code).toBe(0);
  expect(parents().auth).toBe("platform");
  expect(parents().login).toBe("auth");
  expect(parents().session).toBe("auth");
});

test("08.3 a link waits until both ends are back", async () => {
  seed(p, [
    decided("root"),
    open("login", { parent: "root" }),
    open("session", { parent: "root" }),
    link("login", "session"),
  ]);
  await werk(p, "remove", "login", "--actor", "you");
  await werk(p, "remove", "session", "--actor", "you");
  await werk(p, "restore", "login", "--actor", "you");
  expect(viewIds(p)).toContain("login");
  expect(viewEdges(p).some((e) => e.type === "depends_on")).toBe(false);
  await werk(p, "restore", "session", "--actor", "you");
  expect(viewEdges(p).some((e) => e.from === "login" && e.to === "session" && e.type === "depends_on")).toBe(true);
});

test("08.4 removed id stays taken; cited source stays", async () => {
  seed(p, [
    decided("root"),
    open("login", { parent: "root" }),
    open("billing", { parent: "root" }),
    open("rfc-6749", { kind: "source" }),
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  ]);
  const ok = await werk(p, "remove", "login", "--actor", "you");
  expect(ok.code).toBe(0);
  expect(viewIds(p)).toContain("rfc-6749");
  const edges = viewEdges(p).filter((e) => e.to === "rfc-6749" || e.from === "rfc-6749");
  expect(edges.some((e) => e.from === "billing" || e.to === "billing")).toBe(true);
  expect(edges.some((e) => e.from === "login" || e.to === "login")).toBe(false);
  const before = p.events().length;
  const add = await werk(p, "add", "login", "--title", "New login");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toContain("restore");
  expect(add.stderr).toContain("login");
  expect(p.events().length).toBe(before);
  expect(viewIds(p)).not.toContain("login");
});

test("08.5 remove without --actor you refuses", async () => {
  seed(p, [...open("login")]);
  const before = logText(p);
  const r = await werk(p, "remove", "login");
  expect(r.code).not.toBe(0);
  expect(viewIds(p)).toContain("login");
  expect(logText(p)).toBe(before);
});

test("08.6 restore without --actor you refuses", async () => {
  seed(p, [...open("login")]);
  await werk(p, "remove", "login", "--actor", "you");
  const before = logText(p);
  const r = await werk(p, "restore", "login");
  expect(r.code).not.toBe(0);
  expect(viewIds(p)).not.toContain("login");
  expect(logText(p)).toBe(before);
});

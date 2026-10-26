import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createProject,
  decidedEvents,
  linkEvent,
  logLines,
  openEvents,
  type Project,
  seed,
  shape,
  shownIds,
  werk,
} from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const tree = () =>
  seed(
    p,
    decidedEvents("root"),
    decidedEvents("auth", { parent: "root" }),
    openEvents("login", { parent: "auth" }),
    openEvents("session", { parent: "auth" }),
    openEvents("audit", { parent: "root" }),
    linkEvent("login", "audit"),
  );
const linked = (a: string, b: string) =>
  shape(p).edges.some(
    (e) => (e.from === a && e.to === b) || (e.from === b && e.to === a),
  );
const must = (r: { code: number; stderr: string; stdout: string }) =>
  expect(r.code, r.stderr + r.stdout).toBe(0);

test("08.1 removing a card takes its subtree out in one step, and a restore brings it back", async () => {
  tree();
  const n = logLines(p);
  must(await werk(p, "remove", "auth", "--actor", "you"));
  const ids = shownIds(p);
  for (const id of ["auth", "login", "session"]) expect(ids).not.toContain(id);
  expect(logLines(p)).toBe(n + 1);
  const removed = await werk(p, "removed");
  expect(removed.code, removed.stderr).toBe(0);
  for (const id of ["auth", "login", "session"])
    expect(removed.stdout).toContain(id);
  expect(linked("login", "audit")).toBe(false);
  must(await werk(p, "restore", "auth", "--actor", "you"));
  for (const id of ["auth", "login", "session"])
    expect(shownIds(p)).toContain(id);
  expect(linked("login", "audit")).toBe(true);
  expect((await werk(p, "removed")).stdout.trim()).toBe("");
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  seed(
    p,
    decidedEvents("root"),
    decidedEvents("platform", { parent: "root" }),
    decidedEvents("auth", { parent: "platform" }),
    openEvents("login", { parent: "auth" }),
    openEvents("session", { parent: "auth" }),
  );
  const parentOf = (id: string) =>
    (require("./support.ts").mapOf(p) as any).parents.get(id);
  must(await werk(p, "remove", "auth", "--actor", "you", "--reparent"));
  expect(shownIds(p)).not.toContain("auth");
  expect(parentOf("login")).toBe("platform");
  expect(parentOf("session")).toBe("platform");
  must(await werk(p, "restore", "auth", "--actor", "you"));
  expect(parentOf("auth")).toBe("platform");
  expect(parentOf("login")).toBe("auth");
  expect(parentOf("session")).toBe("auth");
});

test("08.3 a link waits until both of its ends are back", async () => {
  seed(
    p,
    decidedEvents("root"),
    openEvents("a", { parent: "root" }),
    openEvents("b", { parent: "root" }),
  );
  seed(
    p,
    openEvents("login", { parent: "a" }),
    openEvents("session", { parent: "b" }),
    linkEvent("login", "session"),
  );
  must(await werk(p, "remove", "login", "--actor", "you"));
  must(await werk(p, "remove", "session", "--actor", "you"));
  must(await werk(p, "restore", "login", "--actor", "you"));
  expect(shownIds(p)).toContain("login");
  expect(linked("login", "session")).toBe(false);
  must(await werk(p, "restore", "session", "--actor", "you"));
  expect(linked("login", "session")).toBe(true);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  seed(
    p,
    decidedEvents("root"),
    openEvents("login", { parent: "root" }),
    openEvents("billing", { parent: "root" }),
    openEvents("rfc-6749", { kind: "source", parent: "root" }),
    linkEvent("login", "rfc-6749", "supported_by"),
    linkEvent("billing", "rfc-6749", "supported_by"),
  );
  must(await werk(p, "remove", "login", "--actor", "you"));
  expect(shownIds(p)).toContain("rfc-6749");
  expect(
    shape(p).edges.some((e) => e.from === "billing" && e.to === "rfc-6749"),
  ).toBe(true);
  const n = logLines(p);
  const add = await werk(p, "add", "login", "--title", "Again");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toMatch(/restore/);
  expect(add.stderr).toContain("login");
  expect(logLines(p)).toBe(n);
});

test("08.5 remove refuses without --actor you", async () => {
  seed(p, decidedEvents("root"), openEvents("login", { parent: "root" }));
  const n = logLines(p);
  const r = await werk(p, "remove", "login");
  expect(r.code, r.stdout).not.toBe(0);
  expect(shownIds(p)).toContain("login");
  expect(logLines(p)).toBe(n);
});

test("08.6 restore refuses without --actor you", async () => {
  seed(p, decidedEvents("root"), openEvents("login", { parent: "root" }), {
    type: "node.removed",
    id: "login",
  });
  const n = logLines(p);
  const r = await werk(p, "restore", "login");
  expect(r.code, r.stdout).not.toBe(0);
  expect(shownIds(p)).not.toContain("login");
  expect(logLines(p)).toBe(n);
});

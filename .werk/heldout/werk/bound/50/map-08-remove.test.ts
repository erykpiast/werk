import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createProject,
  decided,
  link,
  logLines,
  open,
  type Project,
  seedMap,
  werk,
} from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const shows = async (id: string) => (await werk(p, "show", id)).code === 0;

test("08.1 removing a card takes its subtree out in one step; restore brings it back", async () => {
  seedMap(
    p,
    decided("auth"),
    open("login", { parent: "auth" }),
    open("session", { parent: "auth" }),
    open("audit"),
    link("login", "audit"),
  );
  const before = logLines(p).length;
  const r = await werk(p, "remove", "auth", "--actor", "you");
  expect(r.code).toBe(0);
  for (const id of ["auth", "login", "session"])
    expect(await shows(id)).toBe(false);
  expect(logLines(p).length).toBe(before + 1);
  const removed = await werk(p, "removed");
  expect(removed.code).toBe(0);
  expect(removed.stdout).toContain("auth");
  expect(removed.stdout).toContain("login");
  expect(removed.stdout).toContain("session");
  expect((await werk(p, "show", "audit")).stdout).not.toContain("login");
  const back = await werk(p, "restore", "auth", "--actor", "you");
  expect(back.code).toBe(0);
  expect(await shows("login")).toBe(true);
  expect((await werk(p, "show", "audit")).stdout).toContain("login");
  expect((await werk(p, "removed")).stdout.trim()).toBe("");
});

test("08.2 remove with reparent moves the children up; restore puts them back", async () => {
  seedMap(
    p,
    decided("platform"),
    open("auth", { parent: "platform" }),
    open("login", { parent: "auth" }),
    open("session", { parent: "auth" }),
  );
  const r = await werk(p, "remove", "auth", "--actor", "you", "--reparent");
  expect(r.code).toBe(0);
  expect(await shows("auth")).toBe(false);
  const plat = (await werk(p, "show", "platform")).stdout;
  expect(plat).toMatch(/<- refines\s+login/);
  expect(plat).toMatch(/<- refines\s+session/);
  const back = await werk(p, "restore", "auth", "--actor", "you");
  expect(back.code).toBe(0);
  const plat2 = (await werk(p, "show", "platform")).stdout;
  expect(plat2).toMatch(/<- refines\s+auth/);
  expect(plat2).not.toMatch(/<- refines\s+login/);
  const auth = (await werk(p, "show", "auth")).stdout;
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both of its ends are back", async () => {
  seedMap(
    p,
    decided("root"),
    open("login", { parent: "root" }),
    open("session", { parent: "root" }),
    link("login", "session"),
  );
  expect((await werk(p, "remove", "login", "--actor", "you")).code).toBe(0);
  expect((await werk(p, "remove", "session", "--actor", "you")).code).toBe(0);
  expect((await werk(p, "restore", "login", "--actor", "you")).code).toBe(0);
  const login = (await werk(p, "show", "login")).stdout;
  expect(login).toContain("login");
  expect(login).not.toMatch(/depends_on\s+session/);
  expect((await werk(p, "restore", "session", "--actor", "you")).code).toBe(0);
  expect((await werk(p, "show", "login")).stdout).toMatch(
    /depends_on\s+session/,
  );
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  seedMap(
    p,
    decided("root"),
    open("login", { parent: "root" }),
    open("billing", { parent: "root" }),
    open("rfc-6749", { kind: "source" }),
    {
      type: "edge.added",
      from: "login",
      to: "rfc-6749",
      link: "supported_by",
      why: "w",
    },
    {
      type: "edge.added",
      from: "billing",
      to: "rfc-6749",
      link: "supported_by",
      why: "w",
    },
  );
  expect((await werk(p, "remove", "login", "--actor", "you")).code).toBe(0);
  const src = (await werk(p, "show", "rfc-6749")).stdout;
  expect(src).toContain("billing");
  expect(src).not.toContain("login");
  const before = logLines(p).length;
  const add = await werk(p, "add", "login", "--title", "New login");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toContain("restore");
  expect(add.stderr).toContain("login");
  expect(logLines(p).length).toBe(before);
});

test("08.5 remove refuses without --actor you", async () => {
  seedMap(p, decided("login"));
  const before = logLines(p).length;
  const r = await werk(p, "remove", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(true);
  expect(logLines(p).length).toBe(before);
});

test("08.6 restore refuses without --actor you", async () => {
  // The removal is seeded as an event: the Given only needs the card to be removed.
  seedMap(p, decided("login"), { type: "node.removed", id: "login" });
  expect(await shows("login")).toBe(false);
  const before = logLines(p).length;
  const r = await werk(p, "restore", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(false);
  expect(logLines(p).length).toBe(before);
});

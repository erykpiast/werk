import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import { decide, logTypes, must, realCard, werk } from "./helpers.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const shows = async (id: string) => (await werk(p, "show", id)).code === 0;
const removalEvents = () => logTypes(p).filter((t) => t === "node.removed");

test("08.1 remove takes the subtree out in one step and restore brings it back", async () => {
  await realCard(p, "auth");
  await decide(p, "auth");
  await realCard(p, "login", "auth");
  await realCard(p, "session", "auth");
  await realCard(p, "audit");
  await must(p, "link", "login", "audit", "--type", "depends_on", "--why", "w");
  const events = p.events().length;

  const rm = await werk(p, "remove", "auth", "--actor", "you");
  expect(rm.stderr).not.toContain("unknown flag");
  expect(rm.code).toBe(0);
  for (const id of ["auth", "login", "session"]) expect(await shows(id)).toBe(false);
  expect(p.events().length).toBe(events + 1);
  expect(removalEvents()).toHaveLength(1);
  const removed = await werk(p, "removed");
  expect(removed.code).toBe(0);
  for (const id of ["auth", "login", "session"]) expect(removed.stdout).toContain(id);
  expect((await werk(p, "show", "audit")).stdout).not.toContain("login");

  const back = await werk(p, "restore", "auth", "--actor", "you");
  expect(back.code).toBe(0);
  const auth = (await werk(p, "show", "auth")).stdout;
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
  expect((await werk(p, "show", "login")).stdout).toMatch(/->\s+depends_on\s+audit/);
  expect((await werk(p, "removed")).stdout.trim()).toBe("");
});

test("08.2 remove --reparent moves the children up and restore puts them back", async () => {
  await realCard(p, "platform");
  await realCard(p, "auth", "platform");
  await realCard(p, "login", "auth");
  await realCard(p, "session", "auth");

  const rm = await werk(p, "remove", "auth", "--actor", "you", "--reparent");
  expect(rm.stderr).not.toContain("unknown flag");
  expect(rm.code).toBe(0);
  expect(await shows("auth")).toBe(false);
  const platform = (await werk(p, "show", "platform")).stdout;
  expect(platform).toMatch(/<- refines\s+login/);
  expect(platform).toMatch(/<- refines\s+session/);

  const back = await werk(p, "restore", "auth", "--actor", "you");
  expect(back.code).toBe(0);
  const platform2 = (await werk(p, "show", "platform")).stdout;
  expect(platform2).toMatch(/<- refines\s+auth/);
  expect(platform2).not.toMatch(/<- refines\s+login/);
  const auth = (await werk(p, "show", "auth")).stdout;
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both ends are back", async () => {
  await realCard(p, "r1");
  await realCard(p, "r2");
  await realCard(p, "login", "r1");
  await realCard(p, "session", "r2");
  await must(p, "link", "login", "session", "--type", "depends_on", "--why", "w");

  expect((await werk(p, "remove", "login", "--actor", "you")).code).toBe(0);
  expect((await werk(p, "remove", "session", "--actor", "you")).code).toBe(0);
  expect((await werk(p, "restore", "login", "--actor", "you")).code).toBe(0);
  const login = (await werk(p, "show", "login")).stdout;
  expect(login).toContain("login");
  expect(login).not.toMatch(/depends_on\s+session/);
  expect((await werk(p, "restore", "session", "--actor", "you")).code).toBe(0);
  expect((await werk(p, "show", "login")).stdout).toMatch(/->\s+depends_on\s+session/);
});

test("08.4 a removed card's id stays taken and a cited source stays", async () => {
  await realCard(p, "login");
  await realCard(p, "billing");
  await must(p, "add", "rfc-6749", "--title", "RFC 6749", "--kind", "source", "--why", "finding");
  await must(p, "link", "login", "rfc-6749", "--type", "supported_by");
  await must(p, "link", "billing", "rfc-6749", "--type", "supported_by");
  await must(p, "accept", "rfc-6749", "--actor", "you");

  expect((await werk(p, "remove", "login", "--actor", "you")).code).toBe(0);
  const src = await werk(p, "show", "rfc-6749");
  expect(src.code).toBe(0);
  expect(src.stdout).toMatch(/<- supported_by\s+billing/);
  const events = p.events().length;
  const add = await werk(p, "add", "login", "--title", "New login");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toContain("login");
  expect(add.stderr).toMatch(/restore/);
  expect(p.events().length).toBe(events);
  expect((await werk(p, "show", "login")).code).not.toBe(0);
});

test("08.5 remove without --actor you refuses", async () => {
  await realCard(p, "login");
  const events = p.events().length;
  const rm = await werk(p, "remove", "login");
  expect(rm.code).not.toBe(0);
  expect(await shows("login")).toBe(true);
  expect(p.events().length).toBe(events);
});

test("08.6 restore without --actor you refuses", async () => {
  await realCard(p, "login");
  expect((await werk(p, "remove", "login", "--actor", "you")).code).toBe(0);
  const events = p.events().length;
  const back = await werk(p, "restore", "login");
  expect(back.code).not.toBe(0);
  expect(await shows("login")).toBe(false);
  expect(p.events().length).toBe(events);
});

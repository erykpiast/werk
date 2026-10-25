import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createProject, type Project } from "../test-env/project.ts";

const CLI = join(import.meta.dir, "..", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const YOU = ["--actor", "you"];

/** A real card, accepted by the person, under an optional parent. */
async function card(id: string, parent?: string) {
  await werk("add", id, "--title", id, ...(parent ? ["--parent", parent] : []));
  await werk("accept", id, ...YOU);
}

const shows = async (id: string) => (await werk("show", id)).code === 0;

test("a removal takes the subtree in one event, and a restore brings it and the link back", async () => {
  await card("auth");
  await card("login", "auth");
  await card("session", "auth");
  await card("audit");
  await werk("link", "login", "audit", "--type", "depends_on", "--why", "w");
  const before = project.events().length;

  expect((await werk("remove", "auth", ...YOU)).code).toBe(0);
  expect(project.events()).toHaveLength(before + 1);
  for (const id of ["auth", "login", "session"])
    expect(await shows(id)).toBe(false);
  expect((await werk("show", "audit")).stdout).not.toContain("login");
  const removed = await werk("removed");
  expect(removed.stdout).toContain("auth");
  expect(removed.stdout).toContain("login");
  expect(removed.stdout).toContain("session");

  expect((await werk("restore", "auth", ...YOU)).code).toBe(0);
  expect((await werk("show", "login")).stdout).toContain("auth");
  expect((await werk("show", "session")).stdout).toContain("auth");
  expect((await werk("show", "login")).stdout).toContain("audit");
  expect((await werk("removed")).stdout).not.toContain("auth");
});

test("a reparent removal moves the children up, and a restore puts them back", async () => {
  await card("platform");
  await card("auth", "platform");
  await card("login", "auth");
  await card("session", "auth");
  expect((await werk("remove", "auth", ...YOU, "--reparent")).code).toBe(0);
  expect(await shows("auth")).toBe(false);
  expect((await werk("show", "login")).stdout).toContain("platform");
  expect((await werk("show", "session")).stdout).toContain("platform");

  expect((await werk("restore", "auth", ...YOU)).code).toBe(0);
  expect((await werk("show", "auth")).stdout).toContain("platform");
  const login = (await werk("show", "login")).stdout;
  expect(login).toContain("auth");
  expect(login).not.toContain("platform");
});

test("a link waits until both of its ends are back", async () => {
  await card("login");
  await card("session");
  await werk("link", "login", "session", "--type", "depends_on", "--why", "w");
  await werk("remove", "login", ...YOU);
  await werk("remove", "session", ...YOU);
  await werk("restore", "login", ...YOU);
  expect(await shows("login")).toBe(true);
  expect((await werk("show", "login")).stdout).not.toContain("session");
  await werk("restore", "session", ...YOU);
  expect((await werk("show", "login")).stdout).toContain("session");
});

test("a removed id stays taken, and a source that another card cites stays", async () => {
  await card("login");
  await card("billing");
  await werk("add", "rfc-6749", "--kind", "source", "--title", "RFC 6749");
  await werk("accept", "rfc-6749", ...YOU);
  await werk("link", "login", "rfc-6749", "--type", "supported_by");
  await werk("link", "billing", "rfc-6749", "--type", "supported_by");
  await werk("remove", "login", ...YOU);
  expect((await werk("show", "billing")).stdout).toContain("rfc-6749");
  const before = project.events().length;
  const again = await werk("add", "login", "--title", "New");
  expect(again.code).toBe(1);
  expect(again.stderr).toContain('"login"');
  expect(again.stderr).toContain("restore");
  expect(project.events()).toHaveLength(before);
});

test("remove and restore refuse without the person's say-so", async () => {
  await card("login");
  const before = project.events().length;
  const refused = await werk("remove", "login");
  expect(refused.code).toBe(1);
  expect(await shows("login")).toBe(true);
  expect(project.events()).toHaveLength(before);

  await werk("remove", "login", ...YOU);
  const removedAt = project.events().length;
  const restore = await werk("restore", "login");
  expect(restore.code).toBe(1);
  expect(await shows("login")).toBe(false);
  expect(project.events()).toHaveLength(removedAt);
  expect((await werk("restore", "login", "--actor", "me")).code).toBe(1);
});

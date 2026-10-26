import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const YOU = ["--actor", "you"];
const SLOW = 90_000;

async function card(id: string, parent?: string) {
  await werk("add", id, "--title", id, ...(parent ? ["--parent", parent] : []));
  await werk("accept", id, ...YOU);
}
const shows = async (id: string) => (await werk("show", id)).code === 0;
const link = (a: string, b: string, type = "depends_on") =>
  werk("link", a, b, "--type", type, "--why", "w");
// every read view of the map: show of each card, find, inbox
async function anyView(id: string) {
  const texts = [
    await werk("find"),
    await werk("inbox"),
    await werk("search", id),
  ];
  return texts.some((r) => r.stdout.includes(id)) || (await shows(id));
}

test("08.1 subtree removal and restore", async () => {
  await card("auth");
  await card("login", "auth");
  await card("session", "auth");
  await card("audit");
  await link("login", "audit");
  const before = project.events().length;
  const r = await werk("remove", "auth", ...YOU);
  expect(r.code).toBe(0);
  const events = project.events() as { type: string }[];
  expect(events).toHaveLength(before + 1);
  expect(events.at(-1)?.type).toBe("node.removed");
  for (const id of ["auth", "login", "session"])
    expect(await anyView(id)).toBe(false);
  const removed = (await werk("removed")).stdout;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect((await werk("show", "audit")).stdout).not.toContain("login");

  expect((await werk("restore", "auth", ...YOU)).code).toBe(0);
  expect((await werk("show", "auth")).stdout).toContain("login");
  expect((await werk("show", "auth")).stdout).toContain("session");
  expect((await werk("show", "login")).stdout).toContain("audit");
  expect((await werk("show", "audit")).stdout).toContain("login");
  expect((await werk("removed")).stdout).toContain("nothing is removed");
}, SLOW);

test("08.2 reparent removal", async () => {
  await card("platform");
  await card("auth", "platform");
  await card("login", "auth");
  await card("session", "auth");
  expect((await werk("remove", "auth", ...YOU, "--reparent")).code).toBe(0);
  expect(await shows("auth")).toBe(false);
  const platform = (await werk("show", "platform")).stdout;
  expect(platform).toContain("login");
  expect(platform).toContain("session");
  expect((await werk("restore", "auth", ...YOU)).code).toBe(0);
  const p2 = (await werk("show", "platform")).stdout;
  expect(p2).toContain("auth");
  expect(p2).not.toContain("login");
  const a = (await werk("show", "auth")).stdout;
  expect(a).toContain("login");
  expect(a).toContain("session");
}, SLOW);

test("08.3 link waits for both ends", async () => {
  await card("login");
  await card("session");
  await link("login", "session");
  await werk("remove", "login", ...YOU);
  await werk("remove", "session", ...YOU);
  await werk("restore", "login", ...YOU);
  expect(await shows("login")).toBe(true);
  expect((await werk("show", "login")).stdout).not.toContain("session");
  await werk("restore", "session", ...YOU);
  expect((await werk("show", "login")).stdout).toContain("session");
}, SLOW);

test("08.4 id stays taken, cited source stays", async () => {
  await card("login");
  await card("billing");
  await werk("add", "rfc-6749", "--kind", "source", "--title", "RFC 6749");
  await werk("accept", "rfc-6749", ...YOU);
  await link("login", "rfc-6749", "supported_by");
  await link("billing", "rfc-6749", "supported_by");
  await werk("remove", "login", ...YOU);
  expect(await shows("rfc-6749")).toBe(true);
  expect((await werk("show", "billing")).stdout).toContain("rfc-6749");
  const before = project.events().length;
  const again = await werk("add", "login", "--title", "New");
  expect(again.code).not.toBe(0);
  expect(again.stderr).toContain("login");
  expect(again.stderr).toContain("restore");
  expect(project.events()).toHaveLength(before);
  expect((await werk("inbox")).stdout).not.toContain("login");
}, SLOW);

test("08.5 remove refuses without actor", async () => {
  await card("login");
  const before = project.events().length;
  const r = await werk("remove", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(true);
  expect(project.events()).toHaveLength(before);
}, SLOW);

test("08.6 restore refuses without actor", async () => {
  await card("login");
  await werk("remove", "login", ...YOU);
  const before = project.events().length;
  const r = await werk("restore", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(false);
  expect(project.events()).toHaveLength(before);
}, SLOW);

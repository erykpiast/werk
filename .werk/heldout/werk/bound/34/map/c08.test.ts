import { expect, test } from "bun:test";
import { harness, logLines, YOU } from "./util.ts";

const { project, werk } = harness();
const SLOW = 90_000;

async function card(id: string, parent?: string) {
  const r = await werk("add", id, "--title", id, ...(parent ? ["--parent", parent] : []));
  expect(r.code).toBe(0);
  expect((await werk("accept", id, ...YOU)).code).toBe(0);
}
const shows = async (id: string) => (await werk("show", id)).code === 0;
const link = (a: string, b: string) =>
  werk("link", a, b, "--type", "depends_on", "--why", "w");

test("08.1 removing a card takes its subtree out in one step and restore brings it back", async () => {
  await card("auth");
  await card("login", "auth");
  await card("session", "auth");
  await card("audit");
  expect((await link("login", "audit")).code).toBe(0);
  const before = logLines(project()).length;
  expect((await werk("remove", "auth", ...YOU)).code).toBe(0);
  expect(logLines(project()).length).toBe(before + 1);
  for (const id of ["auth", "login", "session"]) expect(await shows(id)).toBe(false);
  expect((await werk("show", "audit")).stdout).not.toContain("login");
  const removed = (await werk("removed")).stdout;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect((await werk("restore", "auth", ...YOU)).code).toBe(0);
  const login = (await werk("show", "login")).stdout;
  expect(login).toContain("auth");
  expect(login).toContain("audit");
  expect((await werk("show", "session")).stdout).toContain("auth");
  expect((await werk("show", "audit")).stdout).toContain("login");
  expect((await werk("removed")).stdout).not.toContain("auth");
}, SLOW);

test("08.2 removing with reparent moves children up and restore puts them back", async () => {
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
  expect(p2).not.toMatch(/<-\s+refines\s+login/);
  expect(p2).not.toMatch(/<-\s+refines\s+session/);
  const auth = (await werk("show", "auth")).stdout;
  expect(auth).toMatch(/<-\s+refines\s+login/);
  expect(auth).toMatch(/<-\s+refines\s+session/);
}, SLOW);

test("08.3 a link waits until both of its ends are back", async () => {
  await card("login");
  await card("session");
  expect((await link("login", "session")).code).toBe(0);
  await werk("remove", "login", ...YOU);
  await werk("remove", "session", ...YOU);
  await werk("restore", "login", ...YOU);
  const login = (await werk("show", "login")).stdout;
  expect(login).toContain("login");
  expect(login).not.toContain("session");
  await werk("restore", "session", ...YOU);
  expect((await werk("show", "login")).stdout).toContain("session");
}, SLOW);

test("08.4 a removed card's id stays taken and a cited source stays", async () => {
  await card("login");
  await card("billing");
  await werk("add", "rfc-6749", "--kind", "source", "--title", "OAuth RFC", "--why", "finding");
  await werk("link", "login", "rfc-6749", "--type", "supported_by", "--why", "w");
  await werk("link", "billing", "rfc-6749", "--type", "supported_by", "--why", "w");
  await werk("accept", "rfc-6749", ...YOU);
  expect((await werk("remove", "login", ...YOU)).code).toBe(0);
  const src = await werk("show", "rfc-6749");
  expect(src.code).toBe(0);
  expect(src.stdout).toContain("OAuth RFC");
  // show prints a card's cited sources, not who cites a source, so read the citing card.
  expect((await werk("show", "billing")).stdout).toMatch(/Ev:\n\s+rfc-6749/);
  const n = logLines(project()).length;
  const add = await werk("add", "login", "--title", "again");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toMatch(/restore/);
  expect(add.stderr).toContain("login");
  expect(logLines(project()).length).toBe(n);
  expect((await werk("show", "login")).code).not.toBe(0);
}, SLOW);

test("08.5 remove refuses without --actor you", async () => {
  await card("login");
  const n = logLines(project()).length;
  const r = await werk("remove", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(true);
  expect(logLines(project()).length).toBe(n);
}, SLOW);

test("08.6 restore refuses without --actor you", async () => {
  await card("login");
  await werk("remove", "login", ...YOU);
  const n = logLines(project()).length;
  const r = await werk("restore", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(false);
  expect(logLines(project()).length).toBe(n);
}, SLOW);

// Held-out steps 08.1-08.6: remove and restore. "Any view" is show, find, search (with and
// without a term), removed and the log fold read through show.
import { expect, test } from "bun:test";
import type { Project } from "../src/test/project.ts";
import { card, decided, events, lines, link, ok, show, withMap } from "./cli-a-lib.ts";

/** True when no command-line view prints the card id as a node of the map. */
async function absentEverywhere(project: Project, id: string, title: string) {
  expect((await show(project, id)).code).not.toBe(0);
  const find = (await ok(project, ["find"])).out;
  const searchAll = (await ok(project, ["search"])).out;
  const searchTerm = (await ok(project, ["search", title.split(" ")[0] as string])).out;
  const root = (await ok(project, ["show", "root"])).out;
  for (const out of [find, searchAll, searchTerm, root]) {
    expect(out.split("\n").some((line) => line.split(/\s+/).includes(id))).toBe(false);
  }
}

test("08.1 Removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const project = withMap([
    card("root", "Root"),
    card("auth", "Authentication by magic link", "root"),
    card("login", "Login form asks for mail", "auth"),
    card("session", "Session lasts a day", "auth"),
    card("audit", "Audit trail of logins", "root"),
    decided("auth"),
    link("login", "audit", "depends_on", "Login writes the audit trail"),
  ]);
  const count = lines(project).length;
  await ok(project, ["remove", "auth", "--actor", "you"]);
  for (const [id, title] of [
    ["auth", "Authentication by magic link"],
    ["login", "Login form asks for mail"],
    ["session", "Session lasts a day"],
  ] as const) {
    await absentEverywhere(project, id, title);
  }
  const added = events(project).slice(count);
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({ type: "node.removed", payload: { id: "auth" } });
  const removed = (await ok(project, ["removed"])).out;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect((await ok(project, ["show", "audit"])).out).not.toMatch(/depends_on\s+login/);

  await ok(project, ["restore", "auth", "--actor", "you"]);
  const auth = (await ok(project, ["show", "auth"])).out;
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
  expect((await ok(project, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(project, ["show", "session"])).out).toContain("parent: auth");
  expect((await ok(project, ["show", "audit"])).out).toMatch(/<- depends_on\s+login/);
  const after = (await ok(project, ["removed"])).out;
  expect(after).not.toContain("auth");
  expect(after).not.toContain("login");
}, 60_000);

test("08.2 Removing with reparent moves the children up, and a restore puts them back", async () => {
  const project = withMap([
    card("root", "Root"),
    card("platform", "Platform", "root"),
    card("auth", "Authentication", "platform"),
    card("login", "Login form", "auth"),
    card("session", "Session length", "auth"),
  ]);
  await ok(project, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect((await show(project, "auth")).code).not.toBe(0);
  expect((await ok(project, ["show", "platform"])).out).not.toMatch(/refines\s+auth\b/);
  expect((await ok(project, ["show", "login"])).out).toContain("parent: platform");
  expect((await ok(project, ["show", "session"])).out).toContain("parent: platform");
  await ok(project, ["restore", "auth", "--actor", "you"]);
  expect((await ok(project, ["show", "auth"])).out).toContain("parent: platform");
  expect((await ok(project, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(project, ["show", "session"])).out).toContain("parent: auth");
  const platform = (await ok(project, ["show", "platform"])).out;
  expect(platform).not.toMatch(/refines\s+login/);
  expect(platform).not.toMatch(/refines\s+session/);
}, 60_000);

test("08.3 A link waits until both of its ends are back", async () => {
  const project = withMap([
    card("root", "Root"),
    card("access", "Access", "root"),
    card("state", "State", "root"),
    card("login", "Login form", "access"),
    card("session", "Session length", "state"),
    link("login", "session", "depends_on", "Login opens a session"),
  ]);
  await ok(project, ["remove", "login", "--actor", "you"]);
  await ok(project, ["remove", "session", "--actor", "you"]);
  await ok(project, ["restore", "login", "--actor", "you"]);
  const login = await ok(project, ["show", "login"]);
  expect(login.out).not.toContain("session");
  await ok(project, ["restore", "session", "--actor", "you"]);
  expect((await ok(project, ["show", "login"])).out).toMatch(/-> depends_on\s+session/);
  expect((await ok(project, ["show", "session"])).out).toMatch(/<- depends_on\s+login/);
}, 60_000);

test("08.4 A removed card's id stays taken, and a cited source stays", async () => {
  const project = withMap([
    card("root", "Root"),
    card("login", "Login by OAuth", "root"),
    card("billing", "Billing by OAuth token", "root"),
    ["node.added", { id: "rfc-6749", kind: "source", title: "RFC 6749" }],
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  ]);
  await ok(project, ["remove", "login", "--actor", "you"]);
  const source = await ok(project, ["show", "rfc-6749"]);
  expect(source.out).toMatch(/<- supported_by\s+billing/);
  const before = lines(project);
  const again = await project.werk(["add", "login", "--title", "Login by password", "--parent", "root"]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("restore");
  expect(again.err).toContain("login");
  expect(lines(project)).toEqual(before);
  expect((await show(project, "login")).out).not.toContain("proposed");
  expect(events(project).some((event) => event.type === "node.proposed")).toBe(false);
}, 60_000);

test("08.5 Remove and restore refuse without the person's say-so", async () => {
  const project = withMap([card("root", "Root"), card("login", "Login form", "root")]);
  const before = lines(project);
  const refused = await project.werk(["remove", "login"]);
  expect(refused.code).not.toBe(0);
  expect((await show(project, "login")).code).toBe(0);
  expect(lines(project)).toEqual(before);
}, 60_000);

test("08.6 When the agent runs `werk restore login` without `--actor you`", async () => {
  const project = withMap([card("root", "Root"), card("login", "Login form", "root")]);
  await ok(project, ["remove", "login", "--actor", "you"]);
  const before = lines(project);
  const refused = await project.werk(["restore", "login"]);
  expect(refused.code).not.toBe(0);
  expect((await show(project, "login")).code).not.toBe(0);
  expect((await ok(project, ["find"])).out).not.toContain("login");
  expect(lines(project)).toEqual(before);
}, 60_000);

import { expect, test } from "bun:test";
import { card, decided, events, link, ok, type Project, withMap } from "./helpers.ts";

/** Each command-line view of the map: show, search (index and term), find. */
async function visible(p: Project, id: string, title: string): Promise<boolean> {
  const show = await p.werk(["show", id]);
  const index = (await ok(p, ["search"])).out;
  const term = (await ok(p, ["search", title.split(" ")[0] as string])).out;
  const find = (await ok(p, ["find"])).out;
  const listed = (text: string) => text.split("\n").some((l) => l.startsWith(`${id} `));
  return show.code === 0 || listed(index) || listed(term) || listed(find);
}

test("08.1", async () => {
  const p = withMap([
    card("root", "Root"),
    card("auth", "Authentication by link", "root"),
    card("login", "Login form", "auth"),
    card("session", "Session cookie", "auth"),
    card("audit", "Audit trail", "root"),
    decided("auth"),
    decided("login"),
    decided("session"),
    decided("audit"),
    link("login", "audit", "depends_on", "Login writes the audit trail"),
  ]);
  const before = events(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  for (const [id, title] of [
    ["auth", "Authentication by link"],
    ["login", "Login form"],
    ["session", "Session cookie"],
  ] as const)
    expect(await visible(p, id, title)).toBe(false);
  const added = events(p).slice(before);
  expect(added).toHaveLength(1);
  expect(added[0]?.type).toBe("node.removed");
  const removed = (await ok(p, ["removed"])).out;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect((await ok(p, ["show", "audit"])).out).not.toContain("login");

  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
  const audit = (await ok(p, ["show", "audit"])).out;
  const back = audit.split("\n").find((l) => l.includes("<- depends_on") && l.includes("login"));
  expect(back).toBeDefined();
  expect(back).not.toContain("held");
  const none = (await ok(p, ["removed"])).out;
  expect(none).not.toContain("auth");
  expect(none).not.toContain("login");
});

test("08.2", async () => {
  const p = withMap([
    card("platform", "Platform"),
    card("auth", "Authentication", "platform"),
    card("login", "Login form", "auth"),
    card("session", "Session cookie", "auth"),
  ]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect((await p.werk(["show", "auth"])).code).toBe(1);
  expect((await ok(p, ["show", "login"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: platform");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
  const platform = (await ok(p, ["show", "platform"])).out;
  expect(platform).not.toMatch(/<- refines\s+login/);
  expect(platform).not.toMatch(/<- refines\s+session/);
});

test("08.3", async () => {
  const p = withMap([
    card("a", "Branch A"),
    card("b", "Branch B"),
    card("login", "Login form", "a"),
    card("session", "Session cookie", "b"),
    link("login", "session", "depends_on", "Login opens a session"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const login = (await ok(p, ["show", "login"])).out;
  const shown = (out: string, other: string) =>
    out.split("\n").some((l) => /^\s+(->|<-) /.test(l) && l.includes(other) && !l.includes("held"));
  expect(shown(login, "session")).toBe(false);
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect(shown((await ok(p, ["show", "login"])).out, "session")).toBe(true);
});

test("08.4", async () => {
  const p = withMap([
    card("root", "Root"),
    card("login", "Login form", "root"),
    card("billing", "Billing", "root"),
    [
      "node.added",
      { id: "rfc-6749", kind: "source", title: "RFC 6749", url: "https://www.rfc-editor.org/rfc/rfc6749" },
    ],
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const src = (await ok(p, ["show", "rfc-6749"])).out;
  expect(src).toMatch(/<- supported_by\s+billing/);
  const before = events(p).length;
  const add = await p.werk(["add", "login", "--title", "Login again", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  expect(add.err).toContain("restore");
  expect(add.err).toContain("login");
  expect(events(p).length).toBe(before);
  expect((await p.werk(["show", "login"])).code).toBe(1);
});

test("08.5", async () => {
  const p = withMap([card("login", "Login form")]);
  const before = events(p).length;
  const run = await p.werk(["remove", "login"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("refused");
  expect((await p.werk(["show", "login"])).code).toBe(0);
  expect(events(p).length).toBe(before);
});

test("08.6", async () => {
  const p = withMap([card("login", "Login form")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const before = events(p).length;
  const run = await p.werk(["restore", "login"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("refused");
  expect((await p.werk(["show", "login"])).code).toBe(1);
  expect(events(p).length).toBe(before);
});

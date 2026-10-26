// Held-out steps 08.1-08.6: remove and restore at the command line, read back through every
// command-line view and the server's map reads.
import { expect, test } from "bun:test";
import type { Project } from "../src/test/project.ts";
import { card, lines, link, node, ok, withMap } from "./c-helpers.ts";

async function serve(project: Project): Promise<{ url: string }> {
  const proc = project.start([process.execPath, `${import.meta.dir}/../src/cli.ts`, "serve", "--port", "0"]);
  const reader = proc.stdout.getReader();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`serve exited: ${out}`);
    out += new TextDecoder().decode(value);
    const found = /http:\/\/\S+/.exec(out);
    if (found !== null) return { url: found[0].replace(/\/map$/, "") };
  }
}

const get = async (url: string) => {
  const res = await fetch(url);
  return { status: res.status, text: await res.text() };
};

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const p = withMap([
    card("root", "Root"),
    card("auth", "Auth", "root"),
    ["node.decided", { id: "auth" }],
    card("login", "Login", "auth"),
    card("session", "Session", "auth"),
    card("audit", "Audit", "root"),
    link("login", "audit", "depends_on", "login writes audit lines"),
  ]);
  const { url } = await serve(p);
  const count = lines(p).length;

  await ok(p, ["remove", "auth", "--actor", "you"]);

  // Then the map no longer shows "auth", "login" or "session" in any view
  for (const id of ["auth", "login", "session"]) {
    expect((await p.werk(["show", id])).code).not.toBe(0);
    expect((await get(`${url}/api/card/${id}`)).status).toBe(404);
  }
  const views = [
    (await ok(p, ["show", "root"])).out,
    (await ok(p, ["find"])).out,
    (await ok(p, ["search"])).out,
    (await ok(p, ["search", "auth"])).out,
    (await ok(p, ["search", "login"])).out,
    (await get(`${url}/api/graph?shape=1`)).text,
    (await get(`${url}/api/home`)).text,
    (await get(`${url}/api/card/root`)).text,
  ];
  for (const view of views)
    for (const word of ['"auth"', "Login", "Session", " auth "]) expect(view).not.toContain(word);

  // And the log has one new removal event for all three cards
  expect(lines(p)).toHaveLength(count + 1);
  expect(JSON.parse(lines(p).at(-1) as string)).toMatchObject({ type: "node.removed", payload: { id: "auth" } });

  // And `werk removed` lists "auth" with its two children
  const removed = (await ok(p, ["removed"])).out;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");

  // And the link from "login" to "audit" no longer shows
  expect((await ok(p, ["show", "audit"])).out).not.toContain("login");
  expect((await get(`${url}/api/card/audit`)).text).not.toContain("login");

  await ok(p, ["restore", "auth", "--actor", "you"]);

  // Then "auth" shows again with "login" and "session" under it
  const auth = (await ok(p, ["show", "auth"])).out;
  expect(auth).toMatch(/<- refines\s+login\s+Login/);
  expect(auth).toMatch(/<- refines\s+session\s+Session/);
  expect((await get(`${url}/api/card/auth`)).status).toBe(200);
  // And the link from "login" to "audit" shows again
  expect((await ok(p, ["show", "login"])).out).toMatch(/-> depends_on\s+audit\s+Audit/);
  expect((await ok(p, ["show", "audit"])).out).toContain("login");
  // And `werk removed` lists nothing
  expect((await ok(p, ["removed"])).out).not.toContain("auth");
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  const p = withMap([
    card("root", "Root"),
    card("platform", "Platform", "root"),
    card("auth", "Auth", "platform"),
    card("login", "Login", "auth"),
    card("session", "Session", "auth"),
  ]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect((await p.werk(["show", "auth"])).code).not.toBe(0);
  const platform = (await ok(p, ["show", "platform"])).out;
  expect(platform).not.toMatch(/refines\s+auth\s/);
  expect(platform).toMatch(/<- refines\s+login\s+Login/);
  expect(platform).toMatch(/<- refines\s+session\s+Session/);
  expect((await ok(p, ["show", "login"])).out).toContain("parent: platform");

  await ok(p, ["restore", "auth", "--actor", "you"]);
  const after = (await ok(p, ["show", "platform"])).out;
  expect(after).toMatch(/<- refines\s+auth\s+Auth/);
  expect(after).not.toMatch(/<- refines\s+login\s/);
  expect(after).not.toMatch(/<- refines\s+session\s/);
  const auth = (await ok(p, ["show", "auth"])).out;
  expect(auth).toContain("parent: platform");
  expect(auth).toMatch(/<- refines\s+login\s+Login/);
  expect(auth).toMatch(/<- refines\s+session\s+Session/);
});

test("08.3 a link waits until both of its ends are back", async () => {
  const p = withMap([
    card("root", "Root"),
    card("a", "Branch A", "root"),
    card("b", "Branch B", "root"),
    card("login", "Login", "a"),
    card("session", "Session", "b"),
    link("login", "session", "depends_on", "login opens a session"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const login = (await ok(p, ["show", "login"])).out;
  expect(login).toContain("Login");
  expect(login).not.toContain("session");
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toMatch(/-> depends_on\s+session\s+Session/);
  expect((await ok(p, ["show", "session"])).out).toContain("login");
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const p = withMap([
    card("root", "Root"),
    card("login", "Login", "root"),
    card("billing", "Billing", "root"),
    node({ id: "rfc-6749", kind: "source", title: "RFC 6749", url: "https://example.com/rfc6749" }),
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const source = (await ok(p, ["show", "rfc-6749"])).out;
  expect(source).toContain("billing");
  expect(source).not.toContain("login");

  const count = lines(p).length;
  const add = await p.werk(["add", "login", "--title", "A new login", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  const message = add.out + add.err;
  expect(message).toContain("restore");
  expect(message).toContain("login");
  expect(lines(p)).toHaveLength(count);
  expect((await p.werk(["show", "login"])).code).not.toBe(0);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const p = withMap([card("root", "Root"), card("login", "Login", "root")]);
  const count = lines(p).length;
  const run = await p.werk(["remove", "login"]);
  expect(run.code).not.toBe(0);
  expect((await ok(p, ["show", "login"])).out).toContain("Login");
  expect(lines(p)).toHaveLength(count);
});

test("08.6 restore refuses without the person's say-so", async () => {
  const p = withMap([card("root", "Root"), card("login", "Login", "root")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const count = lines(p).length;
  const run = await p.werk(["restore", "login"]);
  expect(run.code).not.toBe(0);
  expect((await p.werk(["show", "login"])).code).not.toBe(0);
  expect(lines(p)).toHaveLength(count);
});

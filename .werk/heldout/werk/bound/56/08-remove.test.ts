import { expect, test } from "bun:test";
import { card, type Held, held } from "./helpers.ts";

/** Every command-line view of the map, joined: the show of the root, the search index, the find list and the stale list. */
async function views(h: Held): Promise<string> {
  const runs = await Promise.all([h.w("show", "root"), h.w("search"), h.w("find"), h.w("stale")]);
  return runs.map((run) => run.out).join("\n");
}

const has = (text: string, id: string) => new RegExp(`(^|\\s)#?${id}(\\s|$|,)`, "m").test(text);

function authMap(): Held {
  const h = held();
  card(h, "root", "Root", {}, true);
  card(h, "auth", "Auth", { parent: "root" }, true);
  card(h, "login", "Login", { parent: "auth" }, true);
  card(h, "session", "Session", { parent: "auth" }, true);
  card(h, "audit", "Audit", { parent: "root" }, true);
  h.seed("edge.added", { from: "login", to: "audit", type: "depends_on", why: "a login writes an audit line" });
  return h;
}

const linkLine = (out: string) => out.split("\n").find((line) => line.includes("depends_on") && line.includes("login"));

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const h = authMap();
  expect(linkLine((await h.w("show", "audit")).out)).toBeDefined();
  const before = h.events().length;

  const remove = await h.w("remove", "auth", "--actor", "you");
  expect(remove.code).toBe(0);
  for (const id of ["auth", "login", "session"]) {
    expect((await h.w("show", id)).code).not.toBe(0);
    expect(has(await views(h), id)).toBe(false);
  }
  const fresh = h.events().slice(before);
  expect(fresh.length).toBe(1);
  expect(fresh[0]?.type).toBe("node.removed");

  const removed = await h.w("removed");
  expect(removed.out).toContain("auth");
  expect(removed.out).toContain("login");
  expect(removed.out).toContain("session");
  expect(linkLine((await h.w("show", "audit")).out)).toBeUndefined();

  const restore = await h.w("restore", "auth", "--actor", "you");
  expect(restore.code).toBe(0);
  const auth = await h.w("show", "auth");
  expect(auth.code).toBe(0);
  expect(auth.out).toMatch(/<- refines\s+login/);
  expect(auth.out).toMatch(/<- refines\s+session/);
  expect(linkLine((await h.w("show", "audit")).out)).toBeDefined();
  const after = await h.w("removed");
  expect(after.out).not.toContain("auth");
  expect(after.out).not.toContain("login");
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  const h = held();
  card(h, "platform", "Platform");
  card(h, "auth", "Auth", { parent: "platform" });
  card(h, "login", "Login", { parent: "auth" });
  card(h, "session", "Session", { parent: "auth" });

  expect((await h.w("remove", "auth", "--actor", "you", "--reparent")).code).toBe(0);
  expect((await h.w("show", "auth")).code).not.toBe(0);
  const platform = await h.w("show", "platform");
  expect(platform.out).not.toMatch(/refines\s+auth\b/);
  expect(platform.out).toMatch(/<- refines\s+login/);
  expect(platform.out).toMatch(/<- refines\s+session/);
  expect((await h.w("show", "login")).out).toContain("parent: platform");

  expect((await h.w("restore", "auth", "--actor", "you")).code).toBe(0);
  const back = await h.w("show", "platform");
  expect(back.out).toMatch(/<- refines\s+auth/);
  expect(back.out).not.toMatch(/<- refines\s+login/);
  expect(back.out).not.toMatch(/<- refines\s+session/);
  const auth = await h.w("show", "auth");
  expect(auth.out).toContain("parent: platform");
  expect(auth.out).toMatch(/<- refines\s+login/);
  expect(auth.out).toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both of its ends are back", async () => {
  const h = held();
  card(h, "root", "Root");
  card(h, "accounts", "Accounts", { parent: "root" });
  card(h, "sessions", "Sessions", { parent: "root" });
  card(h, "login", "Login", { parent: "accounts" });
  card(h, "session", "Session", { parent: "sessions" });
  h.seed("edge.added", { from: "login", to: "session", type: "depends_on", why: "a login opens a session" });
  const link = (out: string) => out.split("\n").find((line) => line.includes("depends_on") && line.includes("session"));

  expect((await h.w("remove", "login", "--actor", "you")).code).toBe(0);
  expect((await h.w("remove", "session", "--actor", "you")).code).toBe(0);
  expect((await h.w("restore", "login", "--actor", "you")).code).toBe(0);
  const login = await h.w("show", "login");
  expect(login.code).toBe(0);
  expect(link(login.out)).toBeUndefined();

  expect((await h.w("restore", "session", "--actor", "you")).code).toBe(0);
  expect(link((await h.w("show", "login")).out)).toBeDefined();
  expect((await h.w("show", "session")).out).toMatch(/<- depends_on\s+login/);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const h = held();
  card(h, "root", "Root");
  card(h, "login", "Login", { parent: "root" });
  card(h, "billing", "Billing", { parent: "root" });
  h.seed("node.added", {
    id: "rfc-6749",
    kind: "source",
    title: "RFC 6749",
    url: "https://www.rfc-editor.org/rfc/rfc6749",
  });
  h.seed("edge.added", { from: "login", to: "rfc-6749", type: "supported_by" });
  h.seed("edge.added", { from: "billing", to: "rfc-6749", type: "supported_by" });

  expect((await h.w("remove", "login", "--actor", "you")).code).toBe(0);
  const source = await h.w("show", "rfc-6749");
  expect(source.code).toBe(0);
  expect(source.out).toMatch(/<- supported_by\s+billing/);
  expect(source.out).not.toMatch(/supported_by\s+login/);

  const before = h.events().length;
  const add = await h.w("add", "login", "--title", "A new login", "--parent", "root");
  expect(add.code).not.toBe(0);
  expect(`${add.out}${add.err}`).toMatch(/restore #?login/);
  expect(h.events().length).toBe(before);
  expect((await h.w("show", "login")).code).not.toBe(0);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const h = held();
  card(h, "root", "Root");
  card(h, "login", "Login", { parent: "root" });
  const before = h.events().length;
  const remove = await h.w("remove", "login");
  expect(remove.code).not.toBe(0);
  expect((await h.w("show", "login")).code).toBe(0);
  expect(h.events().length).toBe(before);
});

test("08.6 restore refuses without the person's say-so", async () => {
  const h = held();
  card(h, "root", "Root");
  card(h, "login", "Login", { parent: "root" });
  expect((await h.w("remove", "login", "--actor", "you")).code).toBe(0);
  const before = h.events().length;
  const restore = await h.w("restore", "login");
  expect(restore.code).not.toBe(0);
  expect((await h.w("show", "login")).code).not.toBe(0);
  expect(h.events().length).toBe(before);
});

import { expect, test } from "bun:test";
import { card, type Map, map } from "./a-helpers.ts";

/** Every command-line view of the map, joined. */
async function views(m: Map): Promise<string> {
  const parts = [
    (await m.w("show")).out,
    (await m.w("find")).out,
    (await m.w("search")).out,
    (await m.w("stale")).out,
    (await m.w("show", "root")).out,
  ];
  return parts.join("\n");
}

test("08.1 removing a card takes its subtree out, and a restore brings everything back", async () => {
  const m = map();
  card(m, "auth", "Auth", "root", { status: "decided" });
  card(m, "login", "Login", "auth");
  card(m, "session", "Session", "auth");
  card(m, "audit", "Audit");
  m.seed("edge.added", { from: "login", to: "audit", type: "depends_on", why: "writes audit lines" });
  const before = m.events().length;
  expect((await m.w("remove", "auth", "--actor", "you")).code).toBe(0);
  const v = await views(m);
  for (const id of ["auth", "login", "session"]) {
    expect(v).not.toMatch(new RegExp(`\\b${id}\\b`));
    expect((await m.w("show", id)).code).not.toBe(0);
  }
  const added = m.events().slice(before);
  expect(added.length).toBe(1);
  expect(added[0]?.type).toBe("node.removed");
  const removed = await m.w("removed");
  expect(removed.out).toContain("auth");
  expect(removed.out).toContain("login");
  expect(removed.out).toContain("session");
  expect((await m.w("show", "audit")).out).not.toContain("login");
  expect((await m.w("restore", "auth", "--actor", "you")).code).toBe(0);
  const auth = await m.w("show", "auth");
  expect(auth.out).toMatch(/<- refines\s+login/);
  expect(auth.out).toMatch(/<- refines\s+session/);
  expect((await m.w("show", "audit")).out).toMatch(/<- depends_on\s+login/);
  const empty = await m.w("removed");
  expect(empty.out).not.toContain("auth");
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  const m = map();
  card(m, "platform", "Platform");
  card(m, "auth", "Auth", "platform");
  card(m, "login", "Login", "auth");
  card(m, "session", "Session", "auth");
  expect((await m.w("remove", "auth", "--actor", "you", "--reparent")).code).toBe(0);
  expect((await m.w("show", "auth")).code).not.toBe(0);
  const p = await m.w("show", "platform");
  expect(p.out).toMatch(/<- refines\s+login/);
  expect(p.out).toMatch(/<- refines\s+session/);
  expect(p.out).not.toMatch(/<- refines\s+auth/);
  expect((await m.w("restore", "auth", "--actor", "you")).code).toBe(0);
  const p2 = await m.w("show", "platform");
  expect(p2.out).toMatch(/<- refines\s+auth/);
  expect(p2.out).not.toMatch(/<- refines\s+login/);
  expect(p2.out).not.toMatch(/<- refines\s+session/);
  const a = await m.w("show", "auth");
  expect(a.out).toMatch(/<- refines\s+login/);
  expect(a.out).toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both of its ends are back", async () => {
  const m = map();
  card(m, "a", "A");
  card(m, "b", "B");
  card(m, "login", "Login", "a");
  card(m, "session", "Session", "b");
  m.seed("edge.added", { from: "login", to: "session", type: "depends_on", why: "reads the session" });
  expect((await m.w("remove", "login", "--actor", "you")).code).toBe(0);
  expect((await m.w("remove", "session", "--actor", "you")).code).toBe(0);
  expect((await m.w("restore", "login", "--actor", "you")).code).toBe(0);
  const l = await m.w("show", "login");
  expect(l.code).toBe(0);
  expect(l.out).not.toContain("session");
  expect((await m.w("restore", "session", "--actor", "you")).code).toBe(0);
  expect((await m.w("show", "login")).out).toMatch(/-> depends_on\s+session/);
  expect((await m.w("show", "session")).out).toMatch(/<- depends_on\s+login/);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const m = map();
  card(m, "login", "Login");
  card(m, "billing", "Billing");
  m.seed("node.added", { id: "rfc-6749", kind: "source", title: "RFC 6749", url: "https://example.invalid/rfc6749", finding: "OAuth" });
  m.seed("edge.added", { from: "login", to: "rfc-6749", type: "supported_by" });
  m.seed("edge.added", { from: "billing", to: "rfc-6749", type: "supported_by" });
  expect((await m.w("remove", "login", "--actor", "you")).code).toBe(0);
  const src = await m.w("show", "rfc-6749");
  expect(src.code).toBe(0);
  expect(src.out).toMatch(/<- supported_by\s+billing/);
  const before = m.events().length;
  const add = await m.w("add", "login", "--title", "New login", "--parent", "root");
  expect(add.code).not.toBe(0);
  expect(add.err + add.out).toMatch(/restore/);
  expect(add.err + add.out).toContain("login");
  expect(m.events().length).toBe(before);
  expect((await m.w("show", "login")).code).not.toBe(0);
});

test("08.5 remove refuses without --actor you", async () => {
  const m = map();
  card(m, "login", "Login");
  const before = m.events().length;
  const r = await m.w("remove", "login");
  expect(r.code).not.toBe(0);
  expect((await m.w("show", "login")).code).toBe(0);
  expect(m.events().length).toBe(before);
});

test("08.6 restore refuses without --actor you", async () => {
  const m = map();
  card(m, "login", "Login");
  expect((await m.w("remove", "login", "--actor", "you")).code).toBe(0);
  const before = m.events().length;
  const r = await m.w("restore", "login");
  expect(r.code).not.toBe(0);
  expect((await m.w("show", "login")).code).not.toBe(0);
  expect(m.events().length).toBe(before);
});

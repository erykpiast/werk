import { expect, test } from "bun:test";
import { make, type P } from "./lib.ts";

const first = (s: string) => s.split("\n")[0];
async function shows(p: P, id: string): Promise<boolean> {
  return (await p.w("show", id)).code === 0;
}

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  p.card("auth", { title: "Auth", parent: "root", status: "decided", who: "me" });
  p.card("login", { title: "Login", parent: "auth" });
  p.card("session", { title: "Session", parent: "auth" });
  p.card("audit", { title: "Audit", parent: "root" });
  p.seed("edge.added", { from: "login", to: "audit", type: "depends_on", why: "writes the audit trail" });
  const n = p.lines().length;
  const r = await p.w("remove", "auth", "--actor", "you");
  expect(r.code).toBe(0);
  for (const id of ["auth", "login", "session"]) expect(await shows(p, id)).toBe(false);
  const root = await p.w("show", "root");
  expect(root.out).not.toMatch(/\bauth\b|\blogin\b|\bsession\b/);
  const find = await p.w("find");
  expect(find.out).not.toMatch(/\blogin\b|\bsession\b/);
  const search = await p.w("search");
  expect(search.out).not.toMatch(/\bauth\b/);
  const ev = p.events().slice(n);
  expect(ev.length).toBe(1);
  expect(ev[0].type).toBe("node.removed");
  const removed = await p.w("removed");
  expect(removed.out).toContain("auth");
  expect(removed.out).toContain("login");
  expect(removed.out).toContain("session");
  const audit = await p.w("show", "audit");
  expect(audit.out).not.toContain("login");
  expect((await p.w("restore", "auth", "--actor", "you")).code).toBe(0);
  const a = await p.w("show", "auth");
  expect(a.out).toMatch(/<- refines +login/);
  expect(a.out).toMatch(/<- refines +session/);
  const audit2 = await p.w("show", "audit");
  expect(audit2.out).toMatch(/<- depends_on +login/);
  const removed2 = await p.w("removed");
  expect(removed2.out).not.toMatch(/\bauth\b/);
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  const p = make();
  p.card("platform", { title: "Platform" });
  p.card("auth", { title: "Auth", parent: "platform" });
  p.card("login", { title: "Login", parent: "auth" });
  p.card("session", { title: "Session", parent: "auth" });
  expect((await p.w("remove", "auth", "--actor", "you", "--reparent")).code).toBe(0);
  expect(await shows(p, "auth")).toBe(false);
  const pl = await p.w("show", "platform");
  expect(pl.out).toMatch(/<- refines +login/);
  expect(pl.out).toMatch(/<- refines +session/);
  expect((await p.w("restore", "auth", "--actor", "you")).code).toBe(0);
  const pl2 = await p.w("show", "platform");
  expect(pl2.out).toMatch(/<- refines +auth/);
  expect(pl2.out).not.toMatch(/<- refines +login/);
  expect(pl2.out).not.toMatch(/<- refines +session/);
  const au = await p.w("show", "auth");
  expect(au.out).toMatch(/<- refines +login/);
  expect(au.out).toMatch(/<- refines +session/);
});

test("08.3 a link waits until both of its ends are back", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  p.card("a", { title: "Branch A", parent: "root" });
  p.card("b", { title: "Branch B", parent: "root" });
  p.card("login", { title: "Login", parent: "a" });
  p.card("session", { title: "Session", parent: "b" });
  p.seed("edge.added", { from: "login", to: "session", type: "depends_on", why: "needs a session" });
  expect((await p.w("remove", "login", "--actor", "you")).code).toBe(0);
  expect((await p.w("remove", "session", "--actor", "you")).code).toBe(0);
  expect((await p.w("restore", "login", "--actor", "you")).code).toBe(0);
  const l = await p.w("show", "login");
  expect(l.code).toBe(0);
  expect(l.out).not.toContain("session");
  expect((await p.w("restore", "session", "--actor", "you")).code).toBe(0);
  const l2 = await p.w("show", "login");
  expect(l2.out).toMatch(/-> depends_on +session/);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  p.card("login", { title: "Login", parent: "root" });
  p.card("billing", { title: "Billing", parent: "root" });
  p.seed("node.added", { id: "rfc-6749", kind: "source", title: "OAuth 2.0", finding: "tokens" });
  p.seed("edge.added", { from: "login", to: "rfc-6749", type: "supported_by" });
  p.seed("edge.added", { from: "billing", to: "rfc-6749", type: "supported_by" });
  expect((await p.w("remove", "login", "--actor", "you")).code).toBe(0);
  const src = await p.w("show", "rfc-6749");
  expect(src.code).toBe(0);
  expect(src.out).toMatch(/<- supported_by +billing/);
  const n = p.lines().length;
  const add = await p.w("add", "login", "--title", "New login", "--parent", "root");
  expect(add.code).not.toBe(0);
  expect(`${add.out}${add.err}`).toMatch(/restore #?login/);
  expect(p.lines().length).toBe(n);
  expect(await shows(p, "login")).toBe(false);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  p.card("login", { title: "Login", parent: "root" });
  const n = p.lines().length;
  const r = await p.w("remove", "login");
  expect(r.code).not.toBe(0);
  expect(await shows(p, "login")).toBe(true);
  expect(p.lines().length).toBe(n);
});

test("08.6 restore refuses without --actor you", async () => {
  const p = make();
  p.card("root", { title: "Root" });
  p.card("login", { title: "Login", parent: "root" });
  expect((await p.w("remove", "login", "--actor", "you")).code).toBe(0);
  const n = p.lines().length;
  const r = await p.w("restore", "login");
  expect(r.code).not.toBe(0);
  expect(await shows(p, "login")).toBe(false);
  expect(p.lines().length).toBe(n);
  expect(first((await p.w("removed")).out)).toContain("login");
});

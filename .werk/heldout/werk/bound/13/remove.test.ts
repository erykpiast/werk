// Held-out steps 08.x: remove and restore.
import { expect, test } from "bun:test";
import { card, type P, project } from "./helpers.ts";

const shows = async (p: P, id: string) => (await p.werk(["show", id])).code === 0;

/** Every command-line view of the map: show, the search index and the open work. */
async function inAnyView(p: P, id: string): Promise<boolean> {
  if (await shows(p, id)) return true;
  const index = await p.ok("search");
  const work = await p.ok("find");
  const pattern = new RegExp(`^${id}\\s`, "m");
  return pattern.test(index) || pattern.test(work);
}

const depends = (from: string, to: string) => ({
  type: "edge.added",
  payload: { from, to, type: "depends_on", why: `${from} needs ${to}` },
});

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  const p = project();
  p.seed(
    card("root", "Root", { status: "decided" }),
    card("auth", "Auth", { parent: "root", status: "decided" }),
    card("login", "Login", { parent: "auth" }),
    card("session", "Session", { parent: "auth" }),
    card("audit", "Audit", { parent: "root" }),
    depends("login", "audit"),
  );
  expect(await p.ok("show", "audit")).toMatch(/<- depends_on\s+login/);
  const n = p.lines().length;
  await p.ok("remove", "auth", "--actor", "you");
  for (const id of ["auth", "login", "session"]) expect(await inAnyView(p, id)).toBe(false);
  expect(p.lines().length).toBe(n + 1);
  expect(p.lines().at(-1)?.type).toBe("node.removed");
  const removed = await p.ok("removed");
  expect(removed).toMatch(/^auth\b/m);
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect(await p.ok("show", "audit")).not.toContain("login");

  await p.ok("restore", "auth", "--actor", "you");
  const auth = await p.ok("show", "auth");
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
  expect(await p.ok("show", "audit")).toMatch(/<- depends_on\s+login/);
  expect(await p.ok("removed")).toBe("no card is removed\n");
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  const p = project();
  p.seed(
    card("platform", "Platform"),
    card("auth", "Auth", { parent: "platform" }),
    card("login", "Login", { parent: "auth" }),
    card("session", "Session", { parent: "auth" }),
  );
  await p.ok("remove", "auth", "--actor", "you", "--reparent");
  expect(await shows(p, "auth")).toBe(false);
  const platform = await p.ok("show", "platform");
  expect(platform).toMatch(/<- refines\s+login/);
  expect(platform).toMatch(/<- refines\s+session/);
  expect(await p.ok("show", "login")).toMatch(/parent: platform/);

  await p.ok("restore", "auth", "--actor", "you");
  expect(await p.ok("show", "auth")).toMatch(/parent: platform/);
  const after = await p.ok("show", "platform");
  expect(after).toMatch(/<- refines\s+auth/);
  expect(after).not.toMatch(/<- refines\s+login/);
  expect(after).not.toMatch(/<- refines\s+session/);
  expect(await p.ok("show", "login")).toMatch(/parent: auth/);
  expect(await p.ok("show", "session")).toMatch(/parent: auth/);
});

test("08.3 a link waits until both of its ends are back", async () => {
  const p = project();
  p.seed(
    card("root", "Root"),
    card("identity", "Identity", { parent: "root" }),
    card("storage", "Storage", { parent: "root" }),
    card("login", "Login", { parent: "identity" }),
    card("session", "Session", { parent: "storage" }),
    depends("login", "session"),
  );
  await p.ok("remove", "login", "--actor", "you");
  await p.ok("remove", "session", "--actor", "you");
  await p.ok("restore", "login", "--actor", "you");
  const login = await p.ok("show", "login");
  expect(login).not.toContain("session");
  await p.ok("restore", "session", "--actor", "you");
  expect(await p.ok("show", "login")).toMatch(/-> depends_on\s+session/);
  expect(await p.ok("show", "session")).toMatch(/<- depends_on\s+login/);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const p = project();
  p.seed(
    card("root", "Root"),
    card("login", "Login", { parent: "root" }),
    card("billing", "Billing", { parent: "root" }),
    { type: "node.added", payload: { id: "rfc-6749", kind: "source", title: "RFC 6749", url: "https://example.com" } },
    { type: "edge.added", payload: { from: "login", to: "rfc-6749", type: "supported_by" } },
    { type: "edge.added", payload: { from: "billing", to: "rfc-6749", type: "supported_by" } },
  );
  await p.ok("remove", "login", "--actor", "you");
  const source = await p.ok("show", "rfc-6749");
  expect(source).toMatch(/<- supported_by\s+billing/);
  const n = p.lines().length;
  const add = await p.werk(["add", "login", "--title", "A new login", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  expect(add.err).toMatch(/restore/);
  expect(add.err).toContain("login");
  expect(p.lines().length).toBe(n);
  expect(await shows(p, "login")).toBe(false);
});

test("08.5 remove refuses without the person's say-so", async () => {
  const p = project();
  p.seed(card("root", "Root"), card("login", "Login", { parent: "root" }));
  const n = p.lines().length;
  const run = await p.werk(["remove", "login"]);
  expect(run.code).not.toBe(0);
  expect(await shows(p, "login")).toBe(true);
  expect(p.lines().length).toBe(n);
});

test("08.6 restore refuses without the person's say-so", async () => {
  const p = project();
  p.seed(card("root", "Root"), card("login", "Login", { parent: "root" }));
  await p.ok("remove", "login", "--actor", "you");
  const n = p.lines().length;
  const run = await p.werk(["restore", "login"]);
  expect(run.code).not.toBe(0);
  expect(await shows(p, "login")).toBe(false);
  expect(p.lines().length).toBe(n);
});

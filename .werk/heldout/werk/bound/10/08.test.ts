// werk/08: remove a card with its subtree, restore it, and refuse both without the person's say-so.
import { expect, test } from "bun:test";
import { card, link, useWerk } from "./support.ts";

const w = useWerk();
const shows = async (id: string) => (await w.run("show", id)).code === 0;
const events = (project = w.project()) => project.events() as { type: string; id?: string }[];

function authMap() {
  w.seed(
    ...card("auth", { status: "decided" }),
    ...card("login", { parent: "auth", status: "decided" }),
    ...card("session", { parent: "auth", status: "decided" }),
    ...card("audit", { status: "decided" }),
    link("login", "audit", "depends_on"),
  );
}

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  authMap();
  const before = w.logLines();
  const removed = await w.run("remove", "auth", "--actor", "you");
  expect(removed.stderr).toBe("");
  expect(removed.code).toBe(0);
  for (const id of ["auth", "login", "session"]) expect(await shows(id)).toBe(false);
  expect(w.logLines()).toBe(before + 1);
  expect(events().at(-1)?.type).toBe("node.removed");
  const list = await w.run("removed");
  expect(list.code).toBe(0);
  expect(list.stdout).toContain("auth");
  expect(list.stdout).toContain("login");
  expect(list.stdout).toContain("session");
  expect((await w.run("show", "audit")).stdout).not.toContain("login");
  const restored = await w.run("restore", "auth", "--actor", "you");
  expect(restored.code).toBe(0);
  const auth = (await w.run("show", "auth")).stdout;
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
  expect((await w.run("show", "login")).stdout).toMatch(/-> depends_on\s+audit/);
  expect((await w.run("removed")).stdout.trim()).toBe("");
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  w.seed(
    ...card("platform", { status: "decided" }),
    ...card("auth", { parent: "platform", status: "decided" }),
    ...card("login", { parent: "auth", status: "decided" }),
    ...card("session", { parent: "auth", status: "decided" }),
  );
  const removed = await w.run("remove", "auth", "--actor", "you", "--reparent");
  expect(removed.stderr).toBe("");
  expect(removed.code).toBe(0);
  expect(await shows("auth")).toBe(false);
  const platform = (await w.run("show", "platform")).stdout;
  expect(platform).toMatch(/<- refines\s+login/);
  expect(platform).toMatch(/<- refines\s+session/);
  expect((await w.run("restore", "auth", "--actor", "you")).code).toBe(0);
  const after = (await w.run("show", "platform")).stdout;
  expect(after).toMatch(/<- refines\s+auth/);
  expect(after).not.toMatch(/<- refines\s+login/);
  expect(after).not.toMatch(/<- refines\s+session/);
  const auth = (await w.run("show", "auth")).stdout;
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both of its ends are back", async () => {
  w.seed(
    ...card("root", { status: "decided" }),
    ...card("a", { parent: "root", status: "decided" }),
    ...card("b", { parent: "root", status: "decided" }),
    ...card("login", { parent: "a", status: "decided" }),
    ...card("session", { parent: "b", status: "decided" }),
    link("login", "session", "depends_on"),
  );
  expect((await w.run("remove", "login", "--actor", "you")).code).toBe(0);
  expect((await w.run("remove", "session", "--actor", "you")).code).toBe(0);
  expect((await w.run("restore", "login", "--actor", "you")).code).toBe(0);
  const login = await w.run("show", "login");
  expect(login.code).toBe(0);
  expect(login.stdout).not.toMatch(/depends_on\s+session/);
  expect((await w.run("restore", "session", "--actor", "you")).code).toBe(0);
  expect((await w.run("show", "login")).stdout).toMatch(/-> depends_on\s+session/);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  w.seed(
    ...card("login", { status: "decided" }),
    ...card("billing", { status: "decided" }),
    { type: "node.proposed", id: "rfc-6749", kind: "source", title: "OAuth 2.0", status: "open" },
    { type: "node.accepted", id: "rfc-6749", actor: "you" },
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  );
  expect((await w.run("remove", "login", "--actor", "you")).code).toBe(0);
  const source = await w.run("show", "rfc-6749");
  expect(source.code).toBe(0);
  expect(source.stdout).toMatch(/<- supported_by\s+billing/);
  const before = w.logLines();
  const again = await w.run("add", "login", "--title", "Login again");
  expect(again.code).not.toBe(0);
  expect(again.stderr).toMatch(/restore/);
  expect(again.stderr).toContain("login");
  expect(w.logLines()).toBe(before);
});

test("08.5 remove refuses without the person's say-so", async () => {
  w.seed(...card("login", { status: "decided" }));
  const before = w.logLines();
  const result = await w.run("remove", "login");
  expect(result.code).not.toBe(0);
  expect(await shows("login")).toBe(true);
  expect(w.logLines()).toBe(before);
});

test("08.6 restore refuses without the person's say-so", async () => {
  w.seed(...card("login", { status: "decided" }));
  expect((await w.run("remove", "login", "--actor", "you")).code).toBe(0);
  const before = w.logLines();
  const result = await w.run("restore", "login");
  expect(result.code).not.toBe(0);
  expect(await shows("login")).toBe(false);
  expect(w.logLines()).toBe(before);
});

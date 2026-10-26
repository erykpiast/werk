import { expect, test } from "bun:test";
import { card, edge, setupWerk } from "./support.ts";

const { werk, seed, logLines } = setupWerk();

const shows = async (id: string) => (await werk("show", id)).code === 0;

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  seed(
    card("auth", { title: "Auth", status: "decided" }),
    card("login", { title: "Login", parent: "auth" }),
    card("session", { title: "Session", parent: "auth" }),
    card("audit", { title: "Audit" }),
    edge("login", "audit", "depends_on", "login is audited"),
  );
  const before = logLines().length;
  const removed = await werk("remove", "auth", "--actor", "you");
  expect(removed.stderr).toBe("");
  expect(removed.code).toBe(0);
  for (const id of ["auth", "login", "session"]) {
    expect(await shows(id)).toBe(false);
  }
  expect(logLines()).toHaveLength(before + 1);
  expect(logLines().at(-1)).toContain("node.removed");
  const list = await werk("removed");
  expect(list.code).toBe(0);
  expect(list.stdout).toContain("auth");
  expect(list.stdout).toContain("login");
  expect(list.stdout).toContain("session");
  expect((await werk("show", "audit")).stdout).not.toContain("login");
  const restored = await werk("restore", "auth", "--actor", "you");
  expect(restored.code).toBe(0);
  const auth = (await werk("show", "auth")).stdout;
  expect(auth).toContain("login");
  expect(auth).toContain("session");
  expect((await werk("show", "audit")).stdout).toContain("login");
  expect((await werk("removed")).stdout.trim()).toBe("");
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  seed(
    card("platform", { title: "Platform", status: "decided" }),
    card("auth", { title: "Auth", parent: "platform" }),
    card("login", { title: "Login", parent: "auth" }),
    card("session", { title: "Session", parent: "auth" }),
  );
  const removed = await werk("remove", "auth", "--actor", "you", "--reparent");
  expect(removed.code).toBe(0);
  expect(await shows("auth")).toBe(false);
  for (const id of ["login", "session"]) {
    const t = (await werk("show", id)).stdout;
    expect(t).toMatch(/-> refines\s+platform/);
  }
  expect((await werk("restore", "auth", "--actor", "you")).code).toBe(0);
  expect((await werk("show", "auth")).stdout).toMatch(/-> refines\s+platform/);
  for (const id of ["login", "session"]) {
    const t = (await werk("show", id)).stdout;
    expect(t).toMatch(/-> refines\s+auth/);
    expect(t).not.toMatch(/-> refines\s+platform/);
  }
});

test("08.3 a link waits until both of its ends are back", async () => {
  seed(
    card("a", { title: "A" }),
    card("b", { title: "B" }),
    card("login", { title: "Login", parent: "a" }),
    card("session", { title: "Session", parent: "b" }),
    edge("login", "session", "depends_on", "login needs a session"),
  );
  expect((await werk("remove", "login", "--actor", "you")).code).toBe(0);
  expect((await werk("remove", "session", "--actor", "you")).code).toBe(0);
  expect((await werk("restore", "login", "--actor", "you")).code).toBe(0);
  const login = (await werk("show", "login")).stdout;
  expect(login).toContain("Login");
  expect(login).not.toContain("depends_on");
  expect((await werk("restore", "session", "--actor", "you")).code).toBe(0);
  expect((await werk("show", "login")).stdout).toContain("depends_on");
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  seed(
    card("login", { title: "Login" }),
    card("billing", { title: "Billing" }),
    card("rfc-6749", { kind: "source", title: "RFC 6749" }),
    edge("login", "rfc-6749", "supported_by"),
    edge("billing", "rfc-6749", "supported_by"),
  );
  expect((await werk("remove", "login", "--actor", "you")).code).toBe(0);
  const src = await werk("show", "rfc-6749");
  expect(src.code).toBe(0);
  expect(src.stdout).toContain("billing");
  const before = logLines().length;
  const again = await werk("add", "login", "--title", "New login");
  expect(again.code).not.toBe(0);
  expect(again.stderr).toContain("restore");
  expect(again.stderr).toContain("login");
  expect(logLines()).toHaveLength(before);
});

test("08.5 remove refuses without --actor you", async () => {
  seed(card("login", { title: "Login" }));
  const before = logLines().length;
  const r = await werk("remove", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(true);
  expect(logLines()).toHaveLength(before);
});

test("08.6 restore refuses without --actor you", async () => {
  seed(card("login", { title: "Login" }), [
    { type: "node.removed", id: "login" },
  ]);
  const before = logLines().length;
  const r = await werk("restore", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(false);
  expect(logLines()).toHaveLength(before);
});

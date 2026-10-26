// 08.1 - 08.6: remove, restore, reparent, waiting links, taken ids, and the person's say-so.
import { expect, test } from "bun:test";
import { decided, ghost, link, open } from "../src/map/mark-fixtures.ts";
import { useTools } from "./support.ts";

const t = useTools();
const lastType = () => (t().project.events().at(-1) as { type?: string })?.type;

function tree() {
  t().seed(
    decided("auth", { title: "Auth" }),
    decided("login", { title: "Login", parent: "auth" }),
    decided("session", { title: "Session", parent: "auth" }),
    decided("audit", { title: "Audit" }),
    link("login", "audit"),
  );
}

test("08.1 remove takes the subtree out in one step, restore brings it back", async () => {
  tree();
  const { werk, project } = t();
  const n = project.events().length;
  const r = await werk("remove", "auth", "--actor", "you");
  expect(r.code, r.stderr).toBe(0);
  for (const id of ["auth", "login", "session"]) {
    expect((await werk("show", id)).code, id).not.toBe(0);
    expect((await werk("search", id)).stdout).not.toContain(`${id} `);
  }
  expect(project.events().length).toBe(n + 1);
  expect(lastType()).toBe("node.removed");
  const listed = await werk("removed");
  expect(listed.code, listed.stderr).toBe(0);
  expect(listed.stdout).toContain("auth");
  expect(listed.stdout).toContain("login");
  expect(listed.stdout).toContain("session");
  expect((await werk("show", "audit")).stdout).not.toContain("login");
  const back = await werk("restore", "auth", "--actor", "you");
  expect(back.code, back.stderr).toBe(0);
  expect((await werk("show", "auth")).stdout).toContain("login");
  expect((await werk("show", "auth")).stdout).toContain("session");
  expect((await werk("show", "audit")).stdout).toContain("login");
  const none = await werk("removed");
  expect(none.code, none.stderr).toBe(0);
  expect(none.stdout.trim()).toBe("");
});

test("08.2 remove with reparent moves children up, restore puts them back", async () => {
  t().seed(
    decided("platform", { title: "Platform" }),
    decided("auth", { title: "Auth", parent: "platform" }),
    decided("login", { title: "Login", parent: "auth" }),
    decided("session", { title: "Session", parent: "auth" }),
  );
  const { werk } = t();
  const r = await werk("remove", "auth", "--actor", "you", "--reparent");
  expect(r.code, r.stderr).toBe(0);
  expect((await werk("show", "auth")).code).not.toBe(0);
  const platform = (await werk("show", "platform")).stdout;
  expect(platform).toMatch(/<- refines\s+login/);
  expect(platform).toMatch(/<- refines\s+session/);
  const back = await werk("restore", "auth", "--actor", "you");
  expect(back.code, back.stderr).toBe(0);
  const p2 = (await werk("show", "platform")).stdout;
  expect(p2).toMatch(/<- refines\s+auth/);
  expect(p2).not.toMatch(/<- refines\s+login/);
  const a2 = (await werk("show", "auth")).stdout;
  expect(a2).toMatch(/<- refines\s+login/);
  expect(a2).toMatch(/<- refines\s+session/);
});

test("08.3 a link waits until both ends are back", async () => {
  t().seed(
    decided("root", { title: "Root" }),
    decided("a", { title: "A", parent: "root" }),
    decided("b", { title: "B", parent: "root" }),
    decided("login", { title: "Login", parent: "a" }),
    decided("session", { title: "Session", parent: "b" }),
    link("login", "session"),
  );
  const { werk } = t();
  for (const id of ["login", "session"]) {
    const r = await werk("remove", id, "--actor", "you");
    expect(r.code, r.stderr).toBe(0);
  }
  const r = await werk("restore", "login", "--actor", "you");
  expect(r.code, r.stderr).toBe(0);
  const shown = (await werk("show", "login")).stdout;
  expect(shown.split("\n")[0]).toContain("login");
  expect(shown).not.toMatch(/depends_on\s+session/);
  const r2 = await werk("restore", "session", "--actor", "you");
  expect(r2.code, r2.stderr).toBe(0);
  expect((await werk("show", "login")).stdout).toMatch(/depends_on\s+session/);
});

test("08.4 a removed id stays taken and a cited source stays", async () => {
  t().seed(
    decided("login", { title: "Login" }),
    decided("billing", { title: "Billing" }),
    open("rfc-6749", { kind: "source", title: "RFC 6749" }),
    { type: "edge.added", from: "login", to: "rfc-6749", link: "supported_by" },
    { type: "edge.added", from: "billing", to: "rfc-6749", link: "supported_by" },
  );
  const { werk, project } = t();
  const r = await werk("remove", "login", "--actor", "you");
  expect(r.code, r.stderr).toBe(0);
  const src = await werk("show", "rfc-6749");
  expect(src.code, src.stderr).toBe(0);
  expect(src.stdout).toContain("billing");
  expect(src.stdout).not.toContain("login");
  const n = project.events().length;
  const add = await werk("add", "login", "--title", "Again");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toMatch(/restore\b.*login|login.*restore/i);
  expect(project.events().length).toBe(n);
  expect((await werk("show", "login")).stdout).not.toContain("proposed");
});

test("08.5 remove without --actor you refuses", async () => {
  t().seed(decided("login", { title: "Login" }));
  const { werk, project } = t();
  const n = project.events().length;
  const r = await werk("remove", "login");
  expect(r.code).not.toBe(0);
  expect((await werk("show", "login")).code).toBe(0);
  expect(project.events().length).toBe(n);
});

test("08.6 restore without --actor you refuses", async () => {
  t().seed(decided("login", { title: "Login" }));
  const { werk, project } = t();
  const rm = await werk("remove", "login", "--actor", "you");
  expect(rm.code, rm.stderr).toBe(0);
  const n = project.events().length;
  const r = await werk("restore", "login");
  expect(r.code).not.toBe(0);
  expect((await werk("show", "login")).code).not.toBe(0);
  expect(project.events().length).toBe(n);
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, decided, ghost, link, map, open, seed, werk, type Project } from "../support.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const w = (...args: string[]) => werk(project, ...args);
const spoken = (text: string) => ({ speaker: "person", at: "10:02", session: "6ae61be7", kind: "spoken", text });
const chat = (name: string, ...lines: unknown[]) => {
  const dir = join(project.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.jsonl`), lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
};

describe("06 excerpt ghost", () => {
  test("06.1 a new excerpt stages as a ghost and the card is unchanged", async () => {
    seed(project, decided("pay", { title: "We charge per seat", why: "simple" }));
    chat("pricing", spoken("yes: seats are the unit we bill"));
    const before = (await w("show", "pay")).stdout;
    const q = await w("quote", "pay", "pricing", "seats are the unit we bill");
    expect(q.code).toBe(0);
    expect(q.stdout).toContain("proposed");
    expect(q.stdout).not.toContain("added");
    const m = map(project);
    expect(m.nodes.get("pay:ex0")?.proposed).toBe(true);
    // the link is pending: held in ghostEdges, not live
    expect(m.ghostEdges.some((e) => e.from === "pay" && e.to === "pay:ex0" && e.type === "supported_by")).toBe(true);
    expect(m.edges.some((e) => e.to === "pay:ex0")).toBe(false);
    expect(m.nodes.get("pay")?.status).toBe("decided");
    expect(m.nodes.get("pay")?.title).toBe("We charge per seat");
    const shown = (await w("show", "pay")).stdout;
    expect(shown).toContain("proposed");
    expect(shown).toContain("[decided]");
    expect(shown.split("\n")[0]).toBe(before.split("\n")[0]);
  });

  test("06.2 an accepted excerpt is real and its link is live", async () => {
    seed(project, decided("pay", { title: "We charge per seat" }));
    chat("pricing", spoken("yes: seats are the unit we bill"));
    await w("quote", "pay", "pricing", "seats are the unit we bill");
    const acc = await w("accept", "pay:ex0", "--actor", "you");
    expect(acc.code).toBe(0);
    const m = map(project);
    expect(m.nodes.get("pay:ex0")?.proposed).toBe(false);
    expect(m.edges.some((e) => e.from === "pay" && e.to === "pay:ex0" && e.type === "supported_by")).toBe(true);
    expect(m.ghostEdges).toHaveLength(0);
    const shown = (await w("show", "pay")).stdout;
    expect(shown).toContain("Say:\n  person: seats are the unit we bill");
    expect(shown).not.toMatch(/Say:[\s\S]*proposed/);
  });
});

describe("08 removal", () => {
  const tree = () =>
    seed(
      project,
      decided("audit", { title: "Audit" }),
      decided("auth", { title: "Auth" }),
      open("login", { title: "Login", parent: "auth" }),
      open("session", { title: "Session", parent: "auth" }),
      link("login", "audit"),
    );

  test("08.1 remove takes the subtree in one event and restore brings it back", async () => {
    tree();
    const n = project.events().length;
    const r = await w("remove", "auth", "--actor", "you");
    expect(r.code).toBe(0);
    expect(project.events().length).toBe(n + 1);
    expect((project.events().at(-1) as { type: string }).type).toBe("node.removed");
    for (const id of ["auth", "login", "session"]) {
      expect((await w("show", id)).code).toBe(1);
    }
    expect((await w("search", "")).stdout).not.toContain("auth");
    expect((await w("find")).stdout).not.toContain("Login");
    expect((await w("removed")).stdout.trim()).toBe("auth (with login, session)");
    expect((await w("show", "audit")).stdout).not.toContain("login");
    const rs = await w("restore", "auth", "--actor", "you");
    expect(rs.code).toBe(0);
    const shown = (await w("show", "auth")).stdout;
    expect(shown).toContain("login");
    expect(shown).toContain("session");
    expect((await w("show", "audit")).stdout).toContain("login");
    expect((await w("removed")).stdout.trim()).toBe("nothing is removed");
  });

  test("08.2 reparent moves the children up and restore puts them back", async () => {
    seed(
      project,
      decided("platform", { title: "Platform" }),
      decided("auth", { title: "Auth", parent: "platform" }),
      open("login", { title: "Login", parent: "auth" }),
      open("session", { title: "Session", parent: "auth" }),
    );
    expect((await w("remove", "auth", "--actor", "you", "--reparent")).code).toBe(0);
    let m = map(project);
    expect(m.nodes.has("auth")).toBe(false);
    expect(m.parents.get("login")).toBe("platform");
    expect(m.parents.get("session")).toBe("platform");
    expect((await w("restore", "auth", "--actor", "you")).code).toBe(0);
    m = map(project);
    expect(m.parents.get("auth")).toBe("platform");
    expect(m.parents.get("login")).toBe("auth");
    expect(m.parents.get("session")).toBe("auth");
  });

  test("08.3 a link waits until both ends are back", async () => {
    seed(
      project,
      decided("root", { title: "Root" }),
      open("a", { title: "A", parent: "root" }),
      open("login", { title: "Login", parent: "a" }),
      open("b", { title: "B", parent: "root" }),
      open("session", { title: "Session", parent: "b" }),
      link("login", "session"),
    );
    const live = () => map(project).edges.some((e) => e.from === "login" && e.to === "session");
    expect(live()).toBe(true);
    expect((await w("remove", "login", "--actor", "you")).code).toBe(0);
    expect((await w("remove", "session", "--actor", "you")).code).toBe(0);
    expect((await w("restore", "login", "--actor", "you")).code).toBe(0);
    expect(map(project).nodes.has("login")).toBe(true);
    expect(live()).toBe(false);
    expect((await w("show", "login")).stdout).not.toContain("session");
    expect((await w("restore", "session", "--actor", "you")).code).toBe(0);
    expect(live()).toBe(true);
    expect((await w("show", "login")).stdout).toContain("session");
  });

  test("08.4 a removed id stays taken and a shared source stays", async () => {
    seed(
      project,
      decided("root", { title: "Root" }),
      open("login", { title: "Login", parent: "root" }),
      open("billing", { title: "Billing", parent: "root" }),
      ghost("rfc-6749", { kind: "source", title: "RFC 6749", why: "oauth" }),
      { type: "node.accepted", id: "rfc-6749", actor: "you" },
      { type: "edge.added", from: "login", to: "rfc-6749", link: "supported_by" },
      { type: "edge.added", from: "billing", to: "rfc-6749", link: "supported_by" },
    );
    expect((await w("remove", "login", "--actor", "you")).code).toBe(0);
    expect(map(project).nodes.has("rfc-6749")).toBe(true);
    const shown = (await w("show", "billing")).stdout;
    expect(shown).toContain("Ev:");
    expect(shown).toContain("RFC 6749");
    const n = project.events().length;
    const add = await w("add", "login", "--title", "New login");
    expect(add.code).not.toBe(0);
    expect(add.stderr).toContain("restore");
    expect(add.stderr).toContain("login");
    expect(project.events().length).toBe(n);
    expect(map(project).nodes.has("login")).toBe(false);
  });

  test("08.5 remove without --actor you refuses", async () => {
    seed(project, open("login", { title: "Login" }));
    const n = project.events().length;
    const r = await w("remove", "login");
    expect(r.code).not.toBe(0);
    expect(map(project).nodes.has("login")).toBe(true);
    expect(project.events().length).toBe(n);
  });

  test("08.6 restore without --actor you refuses", async () => {
    seed(project, open("login", { title: "Login" }));
    expect((await w("remove", "login", "--actor", "you")).code).toBe(0);
    const n = project.events().length;
    const r = await w("restore", "login");
    expect(r.code).not.toBe(0);
    expect(map(project).nodes.has("login")).toBe(false);
    expect(project.events().length).toBe(n);
  });
});

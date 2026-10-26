import { afterEach, beforeEach, expect, test } from "bun:test";
import { shapeRead } from "../src/serve/read-api.ts";
import {
  createProject,
  decide,
  events,
  mapOf,
  must,
  type Project,
  real,
  werk,
} from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

/** Whether any view of the map shows the card: the folded map, the shape read and `werk show`. */
async function shows(id: string): Promise<boolean> {
  const map = mapOf(p);
  const inShape = shapeRead(map).nodes.some((n) => n.id === id);
  const shown = (await werk(p, "show", id)).code === 0;
  expect(inShape).toBe(map.nodes.has(id));
  expect(shown).toBe(map.nodes.has(id));
  return map.nodes.has(id);
}
const linked = (from: string, to: string) =>
  mapOf(p).edges.some((e) => e.from === from && e.to === to);
const parentOf = (id: string) => mapOf(p).parents.get(id);

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  await decide(p, "auth");
  await real(p, "login", { parent: "auth" });
  await real(p, "session", { parent: "auth" });
  await real(p, "audit");
  await must(p, "link", "login", "audit", "--type", "depends_on", "--why", "w");
  expect(linked("login", "audit")).toBe(true);
  const before = events(p).length;

  const removed = await werk(p, "remove", "auth", "--actor", "you");
  expect(removed.stderr).toBe("");
  expect(removed.code).toBe(0);
  for (const id of ["auth", "login", "session"]) {
    expect(await shows(id)).toBe(false);
  }
  const after = events(p);
  expect(after.length).toBe(before + 1);
  expect(after.at(-1)?.type).toBe("node.removed");
  expect(linked("login", "audit")).toBe(false);

  const list = await werk(p, "removed");
  expect(list.code).toBe(0);
  expect(list.stdout).toContain("auth");
  expect(list.stdout).toContain("login");
  expect(list.stdout).toContain("session");

  const restored = await werk(p, "restore", "auth", "--actor", "you");
  expect(restored.code).toBe(0);
  expect(await shows("auth")).toBe(true);
  expect(parentOf("login")).toBe("auth");
  expect(parentOf("session")).toBe("auth");
  expect(linked("login", "audit")).toBe(true);
  expect((await werk(p, "removed")).stdout.trim()).toBe("");
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  await decide(p, "platform");
  await real(p, "auth", { parent: "platform" });
  await real(p, "login", { parent: "auth" });
  await real(p, "session", { parent: "auth" });

  const removed = await werk(p, "remove", "auth", "--actor", "you", "--reparent");
  expect(removed.stderr).toBe("");
  expect(removed.code).toBe(0);
  expect(await shows("auth")).toBe(false);
  expect(parentOf("login")).toBe("platform");
  expect(parentOf("session")).toBe("platform");

  const restored = await werk(p, "restore", "auth", "--actor", "you");
  expect(restored.code).toBe(0);
  expect(parentOf("auth")).toBe("platform");
  expect(parentOf("login")).toBe("auth");
  expect(parentOf("session")).toBe("auth");
});

test("08.3 a link waits until both of its ends are back", async () => {
  await real(p, "branch-a");
  await real(p, "branch-b");
  await real(p, "login", { parent: "branch-a" });
  await real(p, "session", { parent: "branch-b" });
  await must(p, "link", "login", "session", "--type", "depends_on", "--why", "w");

  for (const id of ["login", "session"]) {
    const r = await werk(p, "remove", id, "--actor", "you");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  }
  expect((await werk(p, "restore", "login", "--actor", "you")).code).toBe(0);
  expect(await shows("login")).toBe(true);
  expect(linked("login", "session")).toBe(false);
  expect((await werk(p, "restore", "session", "--actor", "you")).code).toBe(0);
  expect(linked("login", "session")).toBe(true);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  await real(p, "login");
  await real(p, "billing");
  await must(p, "add", "rfc-6749", "--kind", "source", "--title", "RFC 6749");
  await must(p, "link", "login", "rfc-6749", "--type", "supported_by");
  await must(p, "link", "billing", "rfc-6749", "--type", "supported_by");
  await must(p, "accept", "rfc-6749", "--actor", "you");

  const removed = await werk(p, "remove", "login", "--actor", "you");
  expect(removed.stderr).toBe("");
  expect(removed.code).toBe(0);
  expect(await shows("rfc-6749")).toBe(true);
  expect(linked("billing", "rfc-6749")).toBe(true);

  const before = events(p).length;
  const again = await werk(p, "add", "login", "--title", "Login again");
  expect(again.code).not.toBe(0);
  expect(again.stderr).toMatch(/restore/i);
  expect(again.stderr).toContain("login");
  expect(events(p).length).toBe(before);
  expect(mapOf(p).nodes.has("login")).toBe(false);
});

test("08.5 remove refuses without the person's say-so", async () => {
  await real(p, "login");
  const before = events(p).length;
  const r = await werk(p, "remove", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(true);
  expect(events(p).length).toBe(before);
});

test("08.6 restore refuses without the person's say-so", async () => {
  await real(p, "login");
  const removed = await werk(p, "remove", "login", "--actor", "you");
  expect(removed.stderr).toBe("");
  expect(removed.code).toBe(0);
  const before = events(p).length;
  const r = await werk(p, "restore", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(false);
  expect(events(p).length).toBe(before);
});

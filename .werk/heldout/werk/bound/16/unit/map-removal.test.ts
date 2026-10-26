import { describe, expect, test } from "bun:test";
import { makeCard, useWerk } from "./support.ts";

const w = useWerk();
const shown = async (id: string) => {
  const r = await w().run("show", id);
  return r.code === 0;
};

describe("08 remove and restore", () => {
  test("08.1 removing takes the subtree out in one step, a restore brings it back", async () => {
    const t = w();
    await makeCard(t, "auth", { decided: true });
    await makeCard(t, "login", { parent: "auth" });
    await makeCard(t, "session", { parent: "auth" });
    await makeCard(t, "audit");
    await t.ok("link", "login", "audit", "--type", "depends_on", "--why", "audit trail");
    const before = t.events().length;

    const removed = await t.run("remove", "auth", "--actor", "you");
    expect(removed.code, removed.stderr).toBe(0);
    for (const id of ["auth", "login", "session"]) expect(await shown(id)).toBe(false);
    const events = t.events();
    expect(events.length).toBe(before + 1);
    expect(events.at(-1)?.type).toBe("node.removed");
    const list = await t.run("removed");
    expect(list.code, list.stderr).toBe(0);
    expect(list.stdout).toContain("auth");
    expect(list.stdout).toContain("login");
    expect(list.stdout).toContain("session");
    expect((await t.run("show", "audit")).stdout).not.toContain("login");

    const restored = await t.run("restore", "auth", "--actor", "you");
    expect(restored.code, restored.stderr).toBe(0);
    const auth = (await t.run("show", "auth")).stdout;
    expect(auth).toContain("login");
    expect(auth).toContain("session");
    expect((await t.run("show", "audit")).stdout).toContain("login");
    expect((await t.run("removed")).stdout.trim()).toBe("");
  });

  test("08.2 remove with reparent moves the children up, a restore puts them back", async () => {
    const t = w();
    await makeCard(t, "platform");
    await makeCard(t, "auth", { parent: "platform" });
    await makeCard(t, "login", { parent: "auth" });
    await makeCard(t, "session", { parent: "auth" });
    const r = await t.run("remove", "auth", "--actor", "you", "--reparent");
    expect(r.code, r.stderr).toBe(0);
    expect(await shown("auth")).toBe(false);
    const platform = (await t.run("show", "platform")).stdout;
    expect(platform).toMatch(/<- refines\s+login/);
    expect(platform).toMatch(/<- refines\s+session/);
    const back = await t.run("restore", "auth", "--actor", "you");
    expect(back.code, back.stderr).toBe(0);
    const platform2 = (await t.run("show", "platform")).stdout;
    expect(platform2).toMatch(/<- refines\s+auth/);
    expect(platform2).not.toMatch(/<- refines\s+login/);
    const auth = (await t.run("show", "auth")).stdout;
    expect(auth).toMatch(/<- refines\s+login/);
    expect(auth).toMatch(/<- refines\s+session/);
  });

  test("08.3 a link waits until both of its ends are back", async () => {
    const t = w();
    await makeCard(t, "b1");
    await makeCard(t, "b2");
    await makeCard(t, "login", { parent: "b1" });
    await makeCard(t, "session", { parent: "b2" });
    await t.ok("link", "login", "session", "--type", "depends_on", "--why", "needs it");
    for (const id of ["login", "session"]) {
      const r = await t.run("remove", id, "--actor", "you");
      expect(r.code, r.stderr).toBe(0);
    }
    const r1 = await t.run("restore", "login", "--actor", "you");
    expect(r1.code, r1.stderr).toBe(0);
    const login = await t.run("show", "login");
    expect(login.code).toBe(0);
    expect(login.stdout).not.toMatch(/-> depends_on\s+session/);
    const r2 = await t.run("restore", "session", "--actor", "you");
    expect(r2.code, r2.stderr).toBe(0);
    expect((await t.run("show", "login")).stdout).toMatch(/-> depends_on\s+session/);
  });

  test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
    const t = w();
    await makeCard(t, "login");
    await makeCard(t, "billing");
    await t.ok("add", "rfc-6749", "--kind", "source", "--title", "OAuth 2.0");
    await t.ok("link", "login", "rfc-6749", "--type", "supported_by");
    await t.ok("link", "billing", "rfc-6749", "--type", "supported_by");
    const r = await t.run("remove", "login", "--actor", "you");
    expect(r.code, r.stderr).toBe(0);
    expect(await shown("rfc-6749")).toBe(true);
    expect((await t.run("show", "billing")).stdout).toContain("rfc-6749");
    const again = await t.run("add", "login", "--title", "New login");
    expect(again.code).not.toBe(0);
    expect(again.stderr).toMatch(/restore/);
    expect(again.stderr).toContain("login");
    expect(await shown("login")).toBe(false);
  });

  test("08.5 remove without --actor you refuses", async () => {
    const t = w();
    await makeCard(t, "login");
    const before = t.events().length;
    const r = await t.run("remove", "login");
    expect(r.code).not.toBe(0);
    expect(await shown("login")).toBe(true);
    expect(t.events().length).toBe(before);
  });

  test("08.6 restore without --actor you refuses", async () => {
    const t = w();
    await makeCard(t, "login");
    const removed = await t.run("remove", "login", "--actor", "you");
    expect(removed.code, removed.stderr).toBe(0);
    const before = t.events().length;
    const r = await t.run("restore", "login");
    expect(r.code).not.toBe(0);
    expect(await shown("login")).toBe(false);
    expect(t.events().length).toBe(before);
  });
});

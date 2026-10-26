import { expect, setDefaultTimeout, test } from "bun:test";

setDefaultTimeout(120000);
import { createProject, decide, makeWerk, real } from "./support.ts";

async function withW<T>(body: (w: ReturnType<typeof makeWerk>, p: ReturnType<typeof createProject>) => Promise<T>) {
  const p = createProject();
  try {
    return await body(makeWerk(p), p);
  } finally {
    await p.dispose();
  }
}

test("08.1 remove takes the subtree, restore brings it back", () =>
  withW(async (w, p) => {
    await real(w, "auth", "Auth");
    await decide(w, "auth");
    await real(w, "login", "Login", { parent: "auth" });
    await real(w, "session", "Session", { parent: "auth" });
    await real(w, "audit", "Audit");
    expect((await w("link", "login", "audit", "--type", "depends_on", "--why", "needs it")).code).toBe(0);
    const before = p.events().length;
    const r = await w("remove", "auth", "--actor", "you");
    expect(r.all).toBe("removed\n\n");
    expect(r.code).toBe(0);
    for (const id of ["auth", "login", "session"]) expect((await w("show", id)).code).toBe(1);
    const removals = p.events().slice(before);
    expect(removals.length).toBe(1);
    const listed = await w("removed");
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("auth");
    expect(listed.stdout).toContain("login");
    expect(listed.stdout).toContain("session");
    expect((await w("show", "audit")).stdout).not.toContain("login");
    expect((await w("restore", "auth", "--actor", "you")).code).toBe(0);
    expect((await w("show", "auth")).code).toBe(0);
    expect((await w("show", "login")).stdout).toContain("auth");
    expect((await w("show", "login")).stdout).toContain("audit");
    expect((await w("removed")).stdout.trim()).toBe("");
  }));

test("08.2 remove --reparent moves children up, restore puts them back", () =>
  withW(async (w) => {
    await real(w, "platform", "Platform");
    await real(w, "auth", "Auth", { parent: "platform" });
    await real(w, "login", "Login", { parent: "auth" });
    await real(w, "session", "Session", { parent: "auth" });
    const r = await w("remove", "auth", "--actor", "you", "--reparent");
    expect(r.code).toBe(0);
    expect((await w("show", "auth")).code).toBe(1);
    const parentOf = async (id: string) => (await w("show", id)).stdout;
    expect(await parentOf("login")).toMatch(/<-\s+refines\s+platform|->\s+refines\s+platform/);
    expect(await parentOf("session")).toMatch(/refines\s+platform/);
    expect((await w("restore", "auth", "--actor", "you")).code).toBe(0);
    expect((await w("show", "auth")).stdout).toMatch(/refines\s+platform/);
    expect(await parentOf("login")).toMatch(/refines\s+auth/);
    expect(await parentOf("login")).not.toMatch(/refines\s+platform/);
    expect(await parentOf("session")).toMatch(/refines\s+auth/);
  }));

test("08.3 a link waits until both ends are back", () =>
  withW(async (w) => {
    await real(w, "root", "Root");
    await real(w, "a", "A", { parent: "root" });
    await real(w, "b", "B", { parent: "root" });
    await real(w, "login", "Login", { parent: "a" });
    await real(w, "session", "Session", { parent: "b" });
    expect((await w("link", "login", "session", "--type", "depends_on", "--why", "w")).code).toBe(0);
    expect((await w("remove", "login", "--actor", "you")).code).toBe(0);
    expect((await w("remove", "session", "--actor", "you")).code).toBe(0);
    expect((await w("restore", "login", "--actor", "you")).code).toBe(0);
    const s = await w("show", "login");
    expect(s.code).toBe(0);
    expect(s.stdout).not.toContain("session");
    expect((await w("restore", "session", "--actor", "you")).code).toBe(0);
    expect((await w("show", "login")).stdout).toContain("session");
  }));

test("08.4 a removed card's id stays taken, a cited source stays", () =>
  withW(async (w, p) => {
    await real(w, "root", "Root");
    await real(w, "login", "Login", { parent: "root" });
    await real(w, "billing", "Billing", { parent: "root" });
    expect((await w("add", "rfc-6749", "--title", "RFC 6749", "--kind", "source")).code).toBe(0);
    expect((await w("accept", "rfc-6749", "--actor", "you")).code).toBe(0);
    expect((await w("link", "login", "rfc-6749", "--type", "supported_by", "--why", "w")).code).toBe(0);
    expect((await w("link", "billing", "rfc-6749", "--type", "supported_by", "--why", "w")).code).toBe(0);
    expect((await w("remove", "login", "--actor", "you")).code).toBe(0);
    const src = await w("show", "rfc-6749");
    expect(src.code).toBe(0);
    expect(src.stdout).toContain("billing");
    const before = p.events().length;
    const add = await w("add", "login", "--title", "New login");
    expect(add.code).not.toBe(0);
    expect(add.all).toMatch(/restore/);
    expect(add.all).toContain("login");
    expect(p.events().length).toBe(before);
  }));

test("08.5 remove refuses without --actor you", () =>
  withW(async (w, p) => {
    await real(w, "login", "Login");
    const before = p.events().length;
    const r = await w("remove", "login");
    expect(r.code).not.toBe(0);
    expect((await w("show", "login")).code).toBe(0);
    expect(p.events().length).toBe(before);
  }));

test("08.6 restore refuses without --actor you", () =>
  withW(async (w, p) => {
    await real(w, "login", "Login");
    expect((await w("remove", "login", "--actor", "you")).code).toBe(0);
    const before = p.events().length;
    const r = await w("restore", "login");
    expect(r.code).not.toBe(0);
    expect((await w("show", "login")).code).toBe(1);
    expect(p.events().length).toBe(before);
  }));

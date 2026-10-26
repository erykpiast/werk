// Steps 08.1 to 08.6: remove and restore, driven by the command line with the person's say-so.
import { describe, expect, test } from "bun:test";
import { addCard, decidedCard, ok, useWerk } from "./support.ts";

const { project, werk, map } = useWerk();

const shows = async (id: string) => (await werk("show", id)).code === 0;
const eventCount = () => project().events().length;

describe("remove and restore", () => {
  test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
    await decidedCard(werk, "auth");
    await addCard(werk, "login", { parent: "auth" });
    await addCard(werk, "session", { parent: "auth" });
    await addCard(werk, "audit");
    await ok(werk, "link", "login", "audit", "--type", "depends_on", "--why", "logs it");
    const before = eventCount();

    const removed = await werk("remove", "auth", "--actor", "you");
    expect(removed.code).toBe(0);
    for (const id of ["auth", "login", "session"]) {
      expect(await shows(id)).toBe(false);
      expect(map().nodes.has(id)).toBe(false);
    }
    const events = project().events() as { type: string }[];
    expect(events).toHaveLength(before + 1);
    expect(events.at(-1)?.type).toBe("node.removed");
    const list = await werk("removed");
    expect(list.code).toBe(0);
    for (const id of ["auth", "login", "session"]) expect(list.stdout).toContain(id);
    expect((await werk("show", "audit")).stdout).not.toContain("login");

    const restored = await werk("restore", "auth", "--actor", "you");
    expect(restored.code).toBe(0);
    const auth = await werk("show", "auth");
    expect(auth.stdout).toContain("login");
    expect(auth.stdout).toContain("session");
    expect((await werk("show", "audit")).stdout).toContain("login");
    expect((await werk("removed")).stdout.trim()).toBe("");
  });

  test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
    await decidedCard(werk, "platform");
    await addCard(werk, "auth", { parent: "platform" });
    await addCard(werk, "login", { parent: "auth" });
    await addCard(werk, "session", { parent: "auth" });

    const removed = await werk("remove", "auth", "--actor", "you", "--reparent");
    expect(removed.code).toBe(0);
    expect(await shows("auth")).toBe(false);
    const platform = (await werk("show", "platform")).stdout;
    expect(platform).toContain("login");
    expect(platform).toContain("session");

    expect((await werk("restore", "auth", "--actor", "you")).code).toBe(0);
    expect((await werk("show", "platform")).stdout).toContain("auth");
    expect((await werk("show", "platform")).stdout).not.toContain("login");
    const auth = (await werk("show", "auth")).stdout;
    expect(auth).toContain("login");
    expect(auth).toContain("session");
  });

  test("08.3 a link waits until both of its ends are back", async () => {
    await addCard(werk, "login");
    await addCard(werk, "session");
    await ok(werk, "link", "login", "session", "--type", "depends_on", "--why", "needs it");

    expect((await werk("remove", "login", "--actor", "you")).code).toBe(0);
    expect((await werk("remove", "session", "--actor", "you")).code).toBe(0);
    expect((await werk("restore", "login", "--actor", "you")).code).toBe(0);
    const login = await werk("show", "login");
    expect(login.code).toBe(0);
    expect(login.stdout).not.toContain("session");

    expect((await werk("restore", "session", "--actor", "you")).code).toBe(0);
    expect((await werk("show", "login")).stdout).toContain("session");
  });

  test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
    await addCard(werk, "login");
    await addCard(werk, "billing");
    await ok(werk, "add", "rfc-6749", "--title", "OAuth", "--kind", "source");
    await ok(werk, "accept", "rfc-6749", "--actor", "you");
    await ok(werk, "link", "login", "rfc-6749", "--type", "supported_by");
    await ok(werk, "link", "billing", "rfc-6749", "--type", "supported_by");

    expect((await werk("remove", "login", "--actor", "you")).code).toBe(0);
    const source = await werk("show", "rfc-6749");
    expect(source.code).toBe(0);
    expect(source.stdout).toContain("billing");

    const before = eventCount();
    const again = await werk("add", "login", "--title", "New login");
    expect(again.code).not.toBe(0);
    expect(again.stderr).toMatch(/restore "?login"?/);
    expect(eventCount()).toBe(before);
    expect(map().nodes.has("login")).toBe(false);
  });

  test("08.5 remove refuses without the person's say-so", async () => {
    await addCard(werk, "login");
    const before = eventCount();
    const result = await werk("remove", "login");
    expect(result.code).not.toBe(0);
    expect(await shows("login")).toBe(true);
    expect(eventCount()).toBe(before);
  });

  test("08.6 restore refuses without the person's say-so", async () => {
    await addCard(werk, "login");
    expect((await werk("remove", "login", "--actor", "you")).code).toBe(0);
    const before = eventCount();
    const result = await werk("restore", "login");
    expect(result.code).not.toBe(0);
    expect(await shows("login")).toBe(false);
    expect(eventCount()).toBe(before);
  });
});

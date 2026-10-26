import { expect, test } from "bun:test";
import { card, childrenOf, decided, hasLink, lines, link, nodeIds, ok, seeded, werk } from "./c-helpers.ts";

const T = 60_000;

test(
  "08.1 remove takes the subtree out in one step, restore brings everything back",
  async () => {
    const p = seeded([
      decided("root", "Root"),
      decided("auth", "Auth", "root"),
      card("login", "Login", "auth"),
      card("session", "Session", "auth"),
      card("audit", "Audit", "root"),
      link("login", "audit", "depends_on", "login writes the audit trail"),
    ]);
    const before = lines(p).length;
    await ok(p, "remove", "auth", "--actor", "you");
    for (const id of ["auth", "login", "session"]) {
      expect((await werk(p, "show", id)).code).not.toBe(0);
      expect(nodeIds(p)).not.toContain(id);
      expect((await ok(p, "find")).includes(`${id} `)).toBe(false);
      expect((await ok(p, "search")).includes(`${id} `)).toBe(false);
    }
    expect(lines(p).length).toBe(before + 1);
    expect(JSON.parse(lines(p).at(-1) as string).type).toBe("node.removed");
    const removed = await ok(p, "removed");
    expect(removed).toContain("auth");
    expect(removed).toContain("login");
    expect(removed).toContain("session");
    expect(hasLink(p, "login", "audit")).toBe(false);
    expect(await ok(p, "show", "audit")).not.toContain("login");

    await ok(p, "restore", "auth", "--actor", "you");
    expect(childrenOf(p, "auth")).toEqual(["login", "session"]);
    expect(await ok(p, "show", "login")).toContain("parent: auth");
    expect(hasLink(p, "login", "audit")).toBe(true);
    expect(await ok(p, "show", "audit")).toContain("depends_on      login");
    expect(await ok(p, "removed")).toBe("no card is removed\n");
  },
  T,
);

test(
  "08.2 remove with reparent moves children up, restore puts them back",
  async () => {
    const p = seeded([
      decided("root", "Root"),
      decided("platform", "Platform", "root"),
      decided("auth", "Auth", "platform"),
      card("login", "Login", "auth"),
      card("session", "Session", "auth"),
    ]);
    await ok(p, "remove", "auth", "--actor", "you", "--reparent");
    expect(nodeIds(p)).not.toContain("auth");
    expect((await werk(p, "show", "auth")).code).not.toBe(0);
    expect(childrenOf(p, "platform")).toEqual(["login", "session"]);
    expect(await ok(p, "show", "login")).toContain("parent: platform");
    await ok(p, "restore", "auth", "--actor", "you");
    expect(childrenOf(p, "platform")).toEqual(["auth"]);
    expect(childrenOf(p, "auth")).toEqual(["login", "session"]);
    expect(await ok(p, "show", "session")).toContain("parent: auth");
  },
  T,
);

test(
  "08.3 a link waits until both of its ends are back",
  async () => {
    const p = seeded([
      decided("root", "Root"),
      card("left", "Left", "root"),
      card("right", "Right", "root"),
      card("login", "Login", "left"),
      card("session", "Session", "right"),
      link("login", "session", "depends_on", "login opens a session"),
    ]);
    await ok(p, "remove", "login", "--actor", "you");
    await ok(p, "remove", "session", "--actor", "you");
    await ok(p, "restore", "login", "--actor", "you");
    expect(nodeIds(p)).toContain("login");
    expect(hasLink(p, "login", "session")).toBe(false);
    expect(await ok(p, "show", "login")).not.toContain("session");
    await ok(p, "restore", "session", "--actor", "you");
    expect(hasLink(p, "login", "session")).toBe(true);
    expect(await ok(p, "show", "login")).toContain("depends_on      session");
  },
  T,
);

test(
  "08.4 a removed card's id stays taken, and a cited source stays",
  async () => {
    const p = seeded([
      decided("root", "Root"),
      card("login", "Login", "root"),
      card("billing", "Billing", "root"),
      ["node.added", { id: "rfc-6749", kind: "source", title: "RFC 6749", url: "https://example.com/rfc6749" }],
      link("login", "rfc-6749", "supported_by"),
      link("billing", "rfc-6749", "supported_by"),
    ]);
    await ok(p, "remove", "login", "--actor", "you");
    expect(nodeIds(p)).toContain("rfc-6749");
    expect(hasLink(p, "billing", "rfc-6749")).toBe(true);
    expect(await ok(p, "show", "rfc-6749")).toContain("billing");
    const before = lines(p).length;
    const add = await werk(p, "add", "login", "--title", "A new login", "--parent", "root");
    expect(add.code).not.toBe(0);
    expect(`${add.err}${add.out}`).toMatch(/restore #?login/);
    expect(lines(p).length).toBe(before);
    expect(nodeIds(p)).not.toContain("login");
  },
  T,
);

test(
  "08.5 remove refuses without the person's say-so",
  async () => {
    const p = seeded([decided("root", "Root"), card("login", "Login", "root")]);
    const before = lines(p).length;
    const run = await werk(p, "remove", "login");
    expect(run.code).not.toBe(0);
    expect(nodeIds(p)).toContain("login");
    expect((await werk(p, "show", "login")).code).toBe(0);
    expect(lines(p).length).toBe(before);
  },
  T,
);

test(
  "08.6 restore refuses without the person's say-so",
  async () => {
    const p = seeded([decided("root", "Root"), card("login", "Login", "root")]);
    await ok(p, "remove", "login", "--actor", "you");
    const before = lines(p).length;
    const run = await werk(p, "restore", "login");
    expect(run.code).not.toBe(0);
    expect(nodeIds(p)).not.toContain("login");
    expect((await werk(p, "show", "login")).code).not.toBe(0);
    expect(lines(p).length).toBe(before);
  },
  T,
);

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  createProject,
  decidedCard,
  link,
  real,
  werk,
  writeLog,
} from "./support.ts";

const text = (p: ReturnType<typeof createProject>) => readFileSync(p.logPath, "utf8");

async function withProject<T>(
  events: unknown[],
  body: (p: ReturnType<typeof createProject>) => Promise<T>,
) {
  const p = createProject();
  try {
    writeLog(p, events);
    return await body(p);
  } finally {
    await p.dispose();
  }
}

const tree = () => [
  ...decidedCard("auth"),
  ...real("login", { parent: "auth" }),
  ...real("session", { parent: "auth" }),
  ...real("audit"),
  link("login", "audit"),
];

const shown = async (p: ReturnType<typeof createProject>, id: string) =>
  (await werk(p, "show", id)).code === 0;

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  await withProject(tree(), async (p) => {
    const before = p.events().length;
    const removed = await werk(p, "remove", "auth", "--actor", "you");
    expect(removed.stderr).toBe("");
    expect(removed.code).toBe(0);
    for (const id of ["auth", "login", "session"]) {
      expect(await shown(p, id)).toBe(false);
    }
    expect(p.events().length).toBe(before + 1);
    const listed = await werk(p, "removed");
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("auth");
    expect(listed.stdout).toContain("login");
    expect(listed.stdout).toContain("session");
    expect((await werk(p, "show", "audit")).stdout).not.toContain("login");
    const restored = await werk(p, "restore", "auth", "--actor", "you");
    expect(restored.code).toBe(0);
    const auth = (await werk(p, "show", "auth")).stdout;
    expect(auth).toContain("login");
    expect(auth).toContain("session");
    expect((await werk(p, "show", "audit")).stdout).toContain("login");
    expect((await werk(p, "removed")).stdout.trim()).toBe("");
  });
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  await withProject(
    [
      ...decidedCard("platform"),
      ...decidedCard("auth", { parent: "platform" }),
      ...real("login", { parent: "auth" }),
      ...real("session", { parent: "auth" }),
    ],
    async (p) => {
      const removed = await werk(p, "remove", "auth", "--actor", "you", "--reparent");
      expect(removed.stderr).toBe("");
      expect(removed.code).toBe(0);
      expect(await shown(p, "auth")).toBe(false);
      const platform = (await werk(p, "show", "platform")).stdout;
      expect(platform).toContain("login");
      expect(platform).toContain("session");
      expect((await werk(p, "restore", "auth", "--actor", "you")).code).toBe(0);
      const platformAfter = (await werk(p, "show", "platform")).stdout;
      expect(platformAfter).toContain("auth");
      expect(platformAfter).not.toMatch(/<- refines\s+login/);
      const auth = (await werk(p, "show", "auth")).stdout;
      expect(auth).toMatch(/<- refines\s+login/);
      expect(auth).toMatch(/<- refines\s+session/);
    },
  );
});

test("08.3 a link waits until both of its ends are back", async () => {
  await withProject(
    [
      ...decidedCard("root"),
      ...real("a", { parent: "root" }),
      ...real("b", { parent: "root" }),
      ...real("login", { parent: "a" }),
      ...real("session", { parent: "b" }),
      link("login", "session"),
    ],
    async (p) => {
      expect((await werk(p, "remove", "login", "--actor", "you")).code).toBe(0);
      expect((await werk(p, "remove", "session", "--actor", "you")).code).toBe(0);
      expect((await werk(p, "restore", "login", "--actor", "you")).code).toBe(0);
      const login = await werk(p, "show", "login");
      expect(login.code).toBe(0);
      expect(login.stdout).not.toMatch(/depends_on\s+session/);
      expect((await werk(p, "restore", "session", "--actor", "you")).code).toBe(0);
      expect((await werk(p, "show", "login")).stdout).toMatch(/depends_on\s+session/);
    },
  );
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  await withProject(
    [
      ...decidedCard("root"),
      ...real("login", { parent: "root" }),
      ...real("billing", { parent: "root" }),
      ...real("rfc-6749", { kind: "source", title: "RFC 6749" }),
      { type: "edge.added", from: "login", to: "rfc-6749", link: "supported_by" },
      { type: "edge.added", from: "billing", to: "rfc-6749", link: "supported_by" },
    ],
    async (p) => {
      expect((await werk(p, "remove", "login", "--actor", "you")).code).toBe(0);
      const source = await werk(p, "show", "rfc-6749");
      expect(source.code).toBe(0);
      expect((await werk(p, "show", "billing")).stdout).toContain("RFC 6749");
      const before = text(p);
      const add = await werk(p, "add", "login", "--title", "Again");
      expect(add.code).not.toBe(0);
      expect(add.stderr).toContain("restore");
      expect(add.stderr).toContain("login");
      expect(text(p)).toBe(before);
    },
  );
});

test("08.5 remove refuses without --actor you", async () => {
  await withProject([...decidedCard("root"), ...real("login", { parent: "root" })], async (p) => {
    const before = text(p);
    const result = await werk(p, "remove", "login");
    expect(result.code).not.toBe(0);
    expect((await werk(p, "show", "login")).code).toBe(0);
    expect(text(p)).toBe(before);
  });
});

test("08.6 restore refuses without --actor you", async () => {
  await withProject([...decidedCard("root"), ...real("login", { parent: "root" })], async (p) => {
    const removed = await werk(p, "remove", "login", "--actor", "you");
    expect(removed.code).toBe(0);
    const before = text(p);
    const result = await werk(p, "restore", "login");
    expect(result.code).not.toBe(0);
    expect((await werk(p, "show", "login")).code).not.toBe(0);
    expect(text(p)).toBe(before);
  });
});

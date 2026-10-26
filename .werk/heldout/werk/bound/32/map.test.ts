import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readMap } from "../src/map/log-store.ts";
import {
  decided,
  ghost,
  link,
  open,
  reopen,
} from "../src/map/mark-fixtures.ts";
import {
  createProject,
  type Project,
  SLOW,
  seedMap,
  werkIn,
  YOU,
} from "./cli-support.ts";

let project: Project;
let werk: ReturnType<typeof werkIn>;
beforeEach(() => {
  project = createProject();
  werk = werkIn(project);
});
afterEach(() => project.dispose());

const chat = (name: string, ...lines: unknown[]) => {
  const dir = join(project.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.jsonl`),
    lines.map((l) => `${JSON.stringify(l)}\n`).join(""),
  );
};
const spoken = (text: string) => ({
  speaker: "person",
  at: "10:02",
  session: "6ae61be7",
  kind: "spoken",
  text,
});
const show = async (id?: string) =>
  (await werk("show", ...(id ? [id] : []))).stdout;
const shows = async (id: string) => (await werk("show", id)).code === 0;

describe("06 excerpt ghost", () => {
  test("06.1 a new excerpt stages as a ghost and waits for the accept", async () => {
    seedMap(project, [decided("pay", { title: "Pay per seat" })]);
    chat("talk", spoken("yes we bill per seat"));
    const before = await show("pay");
    const quoted = await werk("quote", "pay", "talk", "bill per seat");
    expect(quoted.code).toBe(0);
    expect(quoted.stdout).toContain("proposed");
    expect(quoted.stdout).not.toContain("added");
    const { map } = readMap(project.logPath);
    const ex = map.nodes.get("pay:ex0");
    expect(ex?.proposed).toBe(true);
    // the link is held (pending)
    expect(
      map.ghostEdges.some((e) => e.from === "pay" && e.to === "pay:ex0"),
    ).toBe(true);
    expect(map.edges.some((e) => e.from === "pay" && e.to === "pay:ex0")).toBe(
      false,
    );
    const after = await show("pay");
    expect(after).toContain("bill per seat  proposed");
    expect(map.nodes.get("pay")?.status).toBe("decided");
    expect(map.nodes.get("pay")?.title).toBe("Pay per seat");
    // the card's own head lines are unchanged
    expect(after.split("\n").slice(0, 2)).toEqual(
      before.split("\n").slice(0, 2),
    );
    expect(await show("pay:ex0")).toContain("proposed");
  });

  test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
    seedMap(project, [decided("pay", { title: "Pay per seat" })]);
    chat("talk", spoken("yes we bill per seat"));
    await werk("quote", "pay", "talk", "bill per seat");
    expect((await werk("accept", "pay:ex0", ...YOU)).code).toBe(0);
    const { map } = readMap(project.logPath);
    expect(map.nodes.get("pay:ex0")?.proposed).toBe(false);
    expect(
      map.edges.some(
        (e) =>
          e.from === "pay" && e.to === "pay:ex0" && e.type === "supported_by",
      ),
    ).toBe(true);
    expect(map.ghostEdges).toHaveLength(0);
    const card = await show("pay");
    expect(card).toContain("Say:\n  person: bill per seat");
    expect(card).not.toContain("proposed");
    // no second accept: only one accept event for the excerpt
    expect(
      project
        .events()
        .filter((e) => (e as { type: string }).type === "node.accepted"),
    ).toHaveLength(2);
  });
});

describe("08 removal", () => {
  async function card(id: string, parent?: string) {
    await werk(
      "add",
      id,
      "--title",
      id,
      ...(parent ? ["--parent", parent] : []),
    );
    await werk("accept", id, ...YOU);
  }
  const typesOf = () =>
    project.events().map((e) => (e as { type: string }).type);

  test(
    "08.1 removing a card takes the subtree in one step, a restore brings all back",
    async () => {
      await card("auth");
      await card("login", "auth");
      await card("session", "auth");
      await card("audit");
      await werk(
        "link",
        "login",
        "audit",
        "--type",
        "depends_on",
        "--why",
        "w",
      );
      const before = project.events().length;
      expect((await werk("remove", "auth", ...YOU)).code).toBe(0);
      const events = project.events() as { type: string }[];
      expect(events).toHaveLength(before + 1);
      expect(events.at(-1)?.type).toBe("node.removed");
      for (const id of ["auth", "login", "session"])
        expect(await shows(id)).toBe(false);
      expect((await werk("show", "audit")).stdout).not.toContain("login");
      const removed = (await werk("removed")).stdout;
      expect(removed).toContain("auth");
      expect(removed).toContain("login");
      expect(removed).toContain("session");
      expect((await werk("restore", "auth", ...YOU)).code).toBe(0);
      const login = (await werk("show", "login")).stdout;
      expect(login).toContain("auth");
      expect(login).toContain("audit");
      expect((await werk("show", "session")).stdout).toContain("auth");
      expect((await werk("removed")).stdout).toContain("nothing is removed");
    },
    SLOW,
  );

  test(
    "08.2 removing with reparent moves the children up, a restore puts them back",
    async () => {
      await card("platform");
      await card("auth", "platform");
      await card("login", "auth");
      await card("session", "auth");
      expect((await werk("remove", "auth", ...YOU, "--reparent")).code).toBe(0);
      expect(await shows("auth")).toBe(false);
      for (const id of ["login", "session"]) {
        const text = (await werk("show", id)).stdout;
        expect(text).toContain("platform");
      }
      expect((await werk("restore", "auth", ...YOU)).code).toBe(0);
      expect((await werk("show", "auth")).stdout).toContain("platform");
      for (const id of ["login", "session"]) {
        const text = (await werk("show", id)).stdout;
        expect(text).toContain("auth");
        expect(text).not.toContain("platform");
      }
    },
    SLOW,
  );

  test(
    "08.3 a link waits until both of its ends are back",
    async () => {
      await card("login");
      await card("session");
      await werk(
        "link",
        "login",
        "session",
        "--type",
        "depends_on",
        "--why",
        "w",
      );
      await werk("remove", "login", ...YOU);
      await werk("remove", "session", ...YOU);
      await werk("restore", "login", ...YOU);
      expect(await shows("login")).toBe(true);
      expect((await werk("show", "login")).stdout).not.toContain("session");
      await werk("restore", "session", ...YOU);
      expect((await werk("show", "login")).stdout).toContain("session");
    },
    SLOW,
  );

  test(
    "08.4 a removed card's id stays taken, a cited source stays",
    async () => {
      await card("login");
      await card("billing");
      await werk("add", "rfc-6749", "--title", "OAuth RFC", "--kind", "source");
      await werk("accept", "rfc-6749", ...YOU);
      await werk(
        "link",
        "login",
        "rfc-6749",
        "--type",
        "supported_by",
        "--why",
        "cites",
      );
      await werk(
        "link",
        "billing",
        "rfc-6749",
        "--type",
        "supported_by",
        "--why",
        "cites",
      );
      expect((await werk("remove", "login", ...YOU)).code).toBe(0);
      const billing = (await werk("show", "billing")).stdout;
      expect(billing).toContain("rfc-6749");
      expect((await werk("show", "rfc-6749")).code).toBe(0);
      const before = project.events().length;
      const add = await werk("add", "login", "--title", "New login");
      expect(add.code).not.toBe(0);
      expect(add.stderr.toLowerCase()).toContain("restore");
      expect(add.stderr).toContain("login");
      expect(project.events()).toHaveLength(before);
      expect(await shows("login")).toBe(false);
      void typesOf;
    },
    SLOW,
  );

  test("08.5 remove refuses without the person's say-so", async () => {
    await card("login");
    const before = project.events().length;
    const result = await werk("remove", "login");
    expect(result.code).not.toBe(0);
    expect(await shows("login")).toBe(true);
    expect(project.events()).toHaveLength(before);
  });

  test("08.5b restore refuses without the person's say-so", async () => {
    await card("login");
    await werk("remove", "login", ...YOU);
    expect(await shows("login")).toBe(false);
    const before = project.events().length;
    const result = await werk("restore", "login");
    expect(result.code).not.toBe(0);
    expect(await shows("login")).toBe(false);
    expect(project.events()).toHaveLength(before);
  });
});

describe("09 search and find", () => {
  test("09.1 an agent lists the index of decided cards", async () => {
    seedMap(project, [
      decided("a", { title: "Alpha" }),
      decided("b", { title: "Beta" }),
      decided("c", { title: "Gamma" }),
      open("o", { title: "Open one" }),
      [
        ghost("g", { title: "Ghosty" }),
        { type: "node.edited", id: "g", who: "me", noBasis: "t" },
        { type: "criterion.added", id: "g", form: "revisit" },
        { type: "node.decided", id: "g" },
      ],
    ]);
    const out = (await werk("search")).stdout.trim().split("\n");
    expect(out).toEqual(["a  Alpha", "b  Beta", "c  Gamma"]);
  });

  test("09.2 two terms, best match first", async () => {
    seedMap(project, [
      decided("layout", {
        title: "Cache layout",
        body: "Cache eviction and the eviction policy",
      }),
      open("timer", {
        title: "Eviction timer",
        why: "eviction",
        body: "CACHE warmup",
      }),
      decided("size", { title: "Cache size" }),
      decided("gone", { title: "Gone", body: "cache eviction" }),
      { type: "node.removed", id: "gone", actor: "you" },
    ]);
    const out = (await werk("search", "cache", "eviction")).stdout
      .trim()
      .split("\n");
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("layout");
    expect(out[0]).toContain("[decided]");
    expect(out[0]).toContain("Cache layout");
    expect(out[1]).toContain("timer");
    expect(out[1]).toContain("[open]");
    const all = out.join("\n");
    expect(all).not.toContain("Cache size");
    expect(all).not.toContain("gone");
  });

  test("09.3 a word in a rejected option, narrowed", async () => {
    seedMap(project, [
      decided("parent", { title: "Parent topic" }),
      decided("storage", { title: "Storage format", parent: "parent" }),
      open("opt", {
        kind: "option",
        title: "SQLite store",
        why: "SQLite needs a native build",
      }),
      link("opt", "storage", "alternative_to"),
      open("other", { title: "Elsewhere", body: "we could use sqlite here" }),
    ]);
    const all = (await werk("search", "sqlite")).stdout;
    expect(all).toContain("storage  [decided]  Storage format");
    expect(all).toContain("other");
    const under = (await werk("search", "sqlite", "--under", "parent")).stdout
      .trim()
      .split("\n");
    expect(under).toHaveLength(1);
    expect(under[0]).toContain("storage");
    const dec = (await werk("search", "sqlite", "--status", "decided")).stdout
      .trim()
      .split("\n");
    expect(dec).toHaveLength(1);
    expect(dec[0]).toContain("storage");
  });

  test("09.4 an agent finds the open work under one card", async () => {
    seedMap(project, [
      decided("client", { title: "Client" }),
      decided("base", { title: "Base" }),
      decided("pos", { title: "Postponed one", parent: "client" }),
      open("routing", { title: "Routing", parent: "client" }),
      open("theme", { title: "Theme", parent: "client", status: "proto" }),
      open("guards", { title: "Route guards", parent: "routing" }),
      open("pau", { title: "Paused one", parent: "client" }),
      link("pau", "pos"),
      open("sta", { title: "Stale one", parent: "client" }),
      link("sta", "base"),
      open("opt", { kind: "option", title: "An option" }),
      link("opt", "routing", "alternative_to"),
      open("src", { kind: "source", title: "A source" }),
      link("routing", "src", "supported_by"),
      open("billing", { title: "Billing" }),
      reopen("base", { reason: "invalidated", text: "x" }),
      reopen("pos", { reason: "postponed", text: "later" }),
    ]);
    const marks = readMap(project.logPath).map;
    expect(marks.nodes.get("pau")?.marks.map((m) => m.kind)).toEqual([
      "paused",
    ]);
    expect(marks.nodes.get("sta")?.marks.map((m) => m.kind)).toEqual(["stale"]);
    expect(marks.nodes.get("pos")?.marks.map((m) => m.kind)).toEqual([
      "postponed",
    ]);
    const r = await werk("find", "routing");
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split("\n");
    expect(lines[0]).toContain("routing");
    expect(lines[1]).toContain("guards");
    expect(r.stdout).not.toContain("Billing");
    expect(r.stdout).not.toContain("An option");
    expect(r.stdout).not.toContain("A source");
    const c = await werk("find", "client");
    const ids = c.stdout
      .trim()
      .split("\n")
      .map((l) => l.split(" ")[0]);
    expect(ids.slice(0, 2).sort()).toEqual(["routing", "theme"]);
    expect(ids.indexOf("guards")).toBeGreaterThan(1);
    expect(ids).not.toContain("client");
    for (const gone of ["pau", "sta", "pos"]) expect(ids).not.toContain(gone);
  });

  test("09.5 a card reopened as rejected comes back in every tree", async () => {
    seedMap(project, [
      open("t1", { title: "Tree one" }),
      open("t2", { title: "Tree two" }),
      decided("auth", { title: "Auth flow" }),
      reopen("auth", { reason: "rejected", text: "no" }),
    ]);
    const out = (await werk("find")).stdout;
    expect(out).toContain("t1");
    expect(out).toContain("t2");
    expect(out).toContain("Auth flow");
    expect(out).not.toContain("[decided]");
  });
});

describe("11 show and rollup", () => {
  const tree = () =>
    seedMap(project, [
      decided("root", { title: "Root card" }),
      decided("c1", { title: "Child one", parent: "root" }),
      open("c2", { title: "Child two", parent: "root", status: "proto" }),
      decided("g1", { title: "Grandchild", parent: "c1" }),
      reopen("c1", { reason: "rejected", text: "x" }),
    ]);

  test("11.1 the rollup counts the card and its whole refines subtree", async () => {
    tree();
    const out = await show("root");
    const lines = out.split("\n").filter((l) => l.startsWith("rollup:"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("rollup: 4 cards: 1 open, 1 proto, 2 decided");
  });

  test("11.2 each incoming refines link shows the child's own rollup", async () => {
    seedMap(project, [
      decided("parent", { title: "Parent" }),
      decided("child", { title: "Child", parent: "parent" }),
      open("gc1", { title: "GC open", parent: "child" }),
      decided("gc2", { title: "GC decided", parent: "child" }),
    ]);
    const out = await show("parent");
    expect(out).toContain("rollup: 4 cards");
    const row = out.split("\n").find((l) => l.includes("<- refines"));
    expect(row).toBeDefined();
    expect(row).toContain("child");
    expect(row).toContain("rollup: 3 cards");
  });

  test("11.3 a card prints options, excerpts and a proposed source with their words", async () => {
    seedMap(project, [
      decided("dep", { title: "The dependency" }),
      open("main", { title: "Main card" }),
      link("main", "dep", "depends_on"),
      open("opt", { kind: "option", title: "Option title", why: "too slow" }),
      link("opt", "main", "alternative_to"),
    ]);
    // the link's reason is written by the link helper as "main takes dep"
    chat("talk", spoken("hello exact words here"));
    await werk("quote", "main", "talk", "exact words");
    await werk("accept", "main:ex0", ...YOU);
    await werk(
      "add",
      "src1",
      "--title",
      "Source title",
      "--why",
      "the finding text",
      "--kind",
      "source",
    );
    await werk(
      "link",
      "main",
      "src1",
      "--type",
      "supported_by",
      "--why",
      "supports",
    );
    const out = await show("main");
    const depAt = out.indexOf("depends_on");
    expect(depAt).toBeGreaterThan(-1);
    expect(out).toContain("main takes dep");
    const optionsAt = out.indexOf("Options:");
    expect(optionsAt).toBeGreaterThan(depAt);
    expect(out).toContain("Option title");
    expect(out).toContain("why not: too slow");
    expect(out).toContain("Say:\n  person: exact words");
    expect(out).toContain("Ev:");
    expect(out).toMatch(/src1 {2}Source title {2}proposed/);
    expect(out).toContain("finding: the finding text");
  });

  test("11.4 a card with no options prints no Options section", async () => {
    seedMap(project, [open("main", { title: "Main card" })]);
    chat("talk", spoken("hello exact words here"));
    await werk("quote", "main", "talk", "exact words");
    await werk("accept", "main:ex0", ...YOU);
    await werk("add", "s", "--title", "Src", "--why", "f", "--kind", "source");
    await werk("link", "main", "s", "--type", "supported_by", "--why", "w");
    const out = await show("main");
    expect(out).toContain("Say:");
    expect(out).toContain("Ev:");
    expect(out).not.toContain("Options");
  });

  test("11.5 show with no id prints the root card", async () => {
    seedMap(project, [
      open("rootc", { title: "The root" }),
      open("second", { title: "Second", parent: "rootc" }),
    ]);
    const out = await show();
    expect(out).toContain("The root");
    expect(out).toContain("rollup:");
    const row = out.split("\n").find((l) => l.includes("<- refines"));
    expect(row).toContain("second");
    expect(row).toContain("rollup:");
  });
});

import { expect, test } from "bun:test";
import {
  chatLog,
  createProject,
  decidedCard,
  ghost,
  lines,
  link,
  real,
  werk,
  writeLog,
} from "./support.ts";

type P = ReturnType<typeof createProject>;
async function withProject<T>(events: unknown[], body: (p: P) => Promise<T>) {
  const p = createProject();
  try {
    writeLog(p, events);
    return await body(p);
  } finally {
    await p.dispose();
  }
}
const run = async (p: P, ...args: string[]) => {
  const r = await werk(p, ...args);
  expect(r.stderr).toBe("");
  expect(r.code).toBe(0);
  return r.stdout;
};

test("09.1 an agent lists the index of decided cards", async () => {
  await withProject(
    [
      ...decidedCard("d1", { title: "Decided one" }),
      ...decidedCard("d2", { title: "Decided two" }),
      ...decidedCard("d3", { title: "Decided three" }),
      ...real("o1", { title: "Open card" }),
      // A ghost that carries the status decided.
      ghost("g1", { title: "Ghost card", status: "decided" }),
    ],
    async (p) => {
      const out = await run(p, "search");
      const rows = lines(out);
      expect(rows).toHaveLength(3);
      expect(rows[0]).toContain("d1");
      expect(rows[0]).toContain("Decided one");
      expect(out).not.toContain("Open card");
      expect(out).not.toContain("Ghost card");
    },
  );
});

test("09.2 an agent searches with two terms and sees the best match first", async () => {
  await withProject(
    [
      ...decidedCard("layout", {
        title: "Cache layout",
        body: "Cache eviction happens by the eviction policy.",
      }),
      ...real("timer", {
        title: "Eviction timer",
        why: "eviction",
        body: "CACHE warmup",
      }),
      ...decidedCard("size", { title: "Cache size", body: "cache only" }),
      ...real("gone", { title: "Gone", body: "cache eviction" }),
      { type: "node.removed", id: "gone" },
    ],
    async (p) => {
      const out = await run(p, "search", "cache", "eviction");
      const rows = lines(out);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toContain("layout");
      expect(rows[0]).toContain("[decided]");
      expect(rows[0]).toContain("Cache layout");
      expect(rows[1]).toContain("timer");
      expect(rows[1]).toContain("[open]");
      expect(out).not.toContain("Cache size");
      expect(out).not.toContain("Gone");
    },
  );
});

test("09.3 an agent finds a card by a word in a rejected option and narrows the search", async () => {
  await withProject(
    [
      ...decidedCard("parent", { title: "Parent topic" }),
      ...decidedCard("storage", { title: "Storage format", parent: "parent" }),
      ...real("storage:opt0", {
        kind: "option",
        title: "A file store",
        why: "SQLite needs a native build",
      }),
      {
        type: "edge.added",
        from: "storage:opt0",
        to: "storage",
        link: "alternative_to",
      },
      ...real("elsewhere", { title: "Elsewhere", body: "we may use sqlite" }),
    ],
    async (p) => {
      const all = await run(p, "search", "sqlite");
      expect(all).toContain("storage");
      expect(all).toMatch(/storage\s+\[decided\]\s+Storage format/);
      expect(all).toContain("Elsewhere");
      const under = await run(p, "search", "sqlite", "--under", "parent");
      expect(lines(under)).toHaveLength(1);
      expect(under).toContain("Storage format");
      const decided = await run(p, "search", "sqlite", "--status", "decided");
      expect(lines(decided)).toHaveLength(1);
      expect(decided).toContain("Storage format");
    },
  );
});

function clientTree() {
  return [
    ...decidedCard("client", { title: "Client" }),
    ...real("routing", { title: "Routing", parent: "client" }),
    ...real("theme", { title: "Theme", parent: "client", status: "proto" }),
    ...real("guards", { title: "Route guards", parent: "routing" }),
    // An option and a source on Routing.
    ...real("routing:opt0", { kind: "option", title: "Option card", why: "no" }),
    { type: "edge.added", from: "routing:opt0", to: "routing", link: "alternative_to" },
    ...real("routing:src", { kind: "source", title: "Source card" }),
    { type: "edge.added", from: "routing", to: "routing:src", link: "supported_by" },
    ...real("billing", { title: "Billing" }),
    // Cards that a reopen marks, and the cards that carry the marks.
    ...decidedCard("other", { title: "Other tree" }),
    ...decidedCard("pp0", { title: "Postponer", parent: "other" }),
    ...decidedCard("sd0", { title: "Staler", parent: "other" }),
    ...real("pau", { title: "Paused card", parent: "client" }),
    link("pau", "pp0"),
    ...real("stl", { title: "Stale card", parent: "client" }),
    link("stl", "sd0"),
    ...decidedCard("pos", { title: "Postponed card", parent: "client" }),
    { type: "node.reopened", id: "pp0", reason: "postponed", at: "2026-10-10T09:00:00.000Z" },
    { type: "node.reopened", id: "sd0", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" },
    { type: "node.reopened", id: "pos", reason: "postponed", at: "2026-10-10T09:00:00.000Z" },
  ];
}

test("09.4 an agent finds the open work under one card", async () => {
  await withProject(clientTree(), async (p) => {
    const routing = await run(p, "find", "routing");
    const order = lines(routing).map((l) => l.split(/\s+/)[0]);
    expect(order[0]).toBe("routing");
    expect(order[1]).toBe("guards");
    for (const hidden of ["Billing", "Option card", "Source card"]) {
      expect(routing).not.toContain(hidden);
    }
    const client = await run(p, "find", "client");
    const ids = lines(client).map((l) => l.split(/\s+/)[0]);
    expect(ids.indexOf("routing")).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("theme")).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("guards")).toBeGreaterThan(ids.indexOf("routing"));
    expect(ids.indexOf("guards")).toBeGreaterThan(ids.indexOf("theme"));
    expect(ids).not.toContain("client");
    for (const hidden of ["pau", "stl", "pos"]) expect(ids).not.toContain(hidden);
  });
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  await withProject(
    [
      ...real("a1", { title: "Tree A open" }),
      ...real("b1", { title: "Tree B open" }),
      ...decidedCard("auth", { title: "Auth flow" }),
      { type: "node.reopened", id: "auth", reason: "rejected", at: "2026-10-10T09:00:00.000Z" },
    ],
    async (p) => {
      const out = await run(p, "find");
      expect(out).toContain("Tree A open");
      expect(out).toContain("Tree B open");
      expect(out).toContain("Auth flow");
      expect(out).not.toContain("[decided]");
    },
  );
});

const rollupLines = (text: string) =>
  text.split("\n").filter((l) => l.startsWith("rollup:"));

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  await withProject(
    [
      ...decidedCard("root", { title: "Root card" }),
      ...decidedCard("c1", { title: "Child one", parent: "root" }),
      ...real("c2", { title: "Child two", parent: "root", status: "proto" }),
      ...decidedCard("g1", { title: "Grandchild", parent: "c1" }),
      { type: "node.reopened", id: "c1" },
    ],
    async (p) => {
      const out = await run(p, "show", "root");
      const rows = rollupLines(out);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toBe("rollup: 4 cards: 1 open, 1 proto, 2 decided");
    },
  );
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  await withProject(
    [
      ...decidedCard("parent", { title: "Parent card" }),
      ...decidedCard("child", { title: "Child card", parent: "parent" }),
      ...real("g1", { title: "Grandchild open", parent: "child" }),
      ...decidedCard("g2", { title: "Grandchild decided", parent: "child" }),
      { type: "node.reopened", id: "child" },
    ],
    async (p) => {
      const out = await run(p, "show", "parent");
      expect(rollupLines(out)[0]).toContain("rollup: 4 cards");
      const row = out.split("\n").find((l) => /<- refines\s+child/.test(l));
      expect(row).toBeDefined();
      expect(row).toContain("rollup: 3 cards");
    },
  );
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const p = createProject();
  try {
    writeLog(p, [
      ...decidedCard("dep", { title: "Dependency card" }),
      ...real("x", { title: "Card X" }),
      link("x", "dep", "depends_on"),
      ...real("x:opt0", { kind: "option", title: "The other way", why: "it is slow" }),
      { type: "edge.added", from: "x:opt0", to: "x", link: "alternative_to" },
      ghost("x:src", { kind: "source", title: "A study", why: "it found a thing" }),
      { type: "edge.added", from: "x", to: "x:src", link: "supported_by" },
    ]);
    chatLog(p, "talk", {
      speaker: "person",
      at: "10:02",
      session: "6ae61be7",
      kind: "spoken",
      text: "we bill by the seat, always",
    });
    expect((await werk(p, "quote", "x", "talk", "we bill by the seat")).code).toBe(0);
    const out = await run(p, "show", "x");
    expect(out).toMatch(/depends_on\s+dep/);
    expect(out).toContain("why: x takes dep");
    const at = (s: string) => out.indexOf(s);
    expect(at("Options:")).toBeGreaterThan(at("depends_on"));
    expect(out).toMatch(/Options:\n\s+x:opt0\s+The other way\n\s+why not: it is slow/);
    expect(out).toMatch(/Say:\n\s+person: we bill by the seat/);
    expect(out).toMatch(/Ev:\n\s+x:src\s+A study\s+proposed\n\s+finding: it found a thing/);
  } finally {
    await p.dispose();
  }
});

test("11.4 a card with no options prints no Options section", async () => {
  const p = createProject();
  try {
    writeLog(p, [
      ...real("x", { title: "Card X" }),
      ...real("x:src", { kind: "source", title: "A study", why: "a finding" }),
      { type: "edge.added", from: "x", to: "x:src", link: "supported_by" },
    ]);
    chatLog(p, "talk", {
      speaker: "person",
      at: "10:02",
      session: "6ae61be7",
      kind: "spoken",
      text: "we bill by the seat",
    });
    expect((await werk(p, "quote", "x", "talk", "bill by the seat")).code).toBe(0);
    const out = await run(p, "show", "x");
    expect(out).toContain("Say:");
    expect(out).toContain("Ev:");
    expect(out).not.toContain("Options");
  } finally {
    await p.dispose();
  }
});

test("11.5 show with no id prints the root card", async () => {
  await withProject(
    [
      ...real("root", { title: "The root title" }),
      ...real("second", { title: "Second card", parent: "root" }),
      ...real("third", { title: "Third card", parent: "second" }),
    ],
    async (p) => {
      const out = await run(p, "show");
      expect(out).toContain("The root title");
      expect(rollupLines(out)).toHaveLength(1);
      const row = out.split("\n").find((l) => /<- refines\s+second/.test(l));
      expect(row).toBeDefined();
      expect(row).toContain("rollup: 2 cards");
    },
  );
});

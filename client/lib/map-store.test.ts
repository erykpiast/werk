import { expect, test } from "bun:test";
import { createMapStore, type MapStoreDeps, type OpenView } from "./map-store";

/** A live channel that the test drives, and an open card that the test changes between reads. */
function setup(initial: OpenView = { id: "root", html: "one" }) {
  let view = initial;
  const listeners = new Map<string, () => void>();
  const reads: string[] = [];
  const shown: OpenView[] = [];
  let reloads = 0;
  let stashes = 0;
  let closed = false;
  const deps: MapStoreDeps = {
    fetch: async (url) => {
      reads.push(url);
      return Response.json(view);
    },
    connect: () => ({
      addEventListener: (type, listener) => void listeners.set(type, listener),
      close: () => {
        closed = true;
      },
    }),
    show: (next) => void shown.push(next),
    reload: () => void reloads++,
    stashDraft: () => void stashes++,
  };
  return {
    store: createMapStore(deps, "my project"),
    settled: () => Bun.sleep(20),
    reads,
    shown,
    emit: (type: string) => listeners.get(type)?.(),
    setView: (next: OpenView) => {
      view = next;
    },
    counts: () => ({ reloads, stashes, closed }),
  };
}

test("each connect reads the open card, and a later connect reads it again", async () => {
  const t = setup();
  t.store.start();
  expect(t.reads).toEqual([]);
  t.emit("open");
  await t.settled();
  expect(t.shown).toEqual([{ id: "root", html: "one" }]);

  t.setView({ id: "root", html: "two" });
  t.emit("open");
  await t.settled();
  expect(t.shown.at(-1)).toEqual({ id: "root", html: "two" });
});

test("a bare changed signal reads the open card again", async () => {
  const t = setup();
  t.store.start();
  t.emit("open");
  await t.settled();
  t.setView({ id: "root", html: "changed" });
  t.emit("changed");
  await t.settled();
  expect(t.shown.at(-1)?.html).toBe("changed");
  expect(t.reads).toEqual([
    "/api/projects/my%20project/open",
    "/api/projects/my%20project/open",
  ]);
});

test("a reload signal stashes the draft, then reloads, and reads nothing", () => {
  const t = setup();
  t.store.start();
  t.emit("reload");
  expect(t.counts()).toMatchObject({ stashes: 1, reloads: 1 });
  expect(t.reads).toEqual([]);
});

test("a read that a later read overtakes is dropped", async () => {
  const t = setup();
  t.store.start();
  t.emit("changed");
  t.setView({ id: "root", html: "newer" });
  t.emit("changed");
  await t.settled();
  expect(t.shown).toEqual([{ id: "root", html: "newer" }]);
});

test("a failed read shows nothing, and the next signal reads again", async () => {
  const shown: OpenView[] = [];
  let ok = false;
  const listeners = new Map<string, () => void>();
  const store = createMapStore(
    {
      fetch: async () =>
        ok
          ? Response.json({ id: "root", html: "back" })
          : new Response("nope", { status: 500 }),
      connect: () => ({
        addEventListener: (type, l) => void listeners.set(type, l),
        close() {},
      }),
      show: (v) => void shown.push(v),
      reload() {},
      stashDraft() {},
    },
    "my project",
  );
  store.start();
  listeners.get("open")?.();
  await Bun.sleep(20);
  expect(shown).toEqual([]);
  ok = true;
  listeners.get("changed")?.();
  await Bun.sleep(20);
  expect(shown).toEqual([{ id: "root", html: "back" }]);
});

test("a read that throws is dropped, and stop closes the channel once", async () => {
  const t = setup();
  t.store.start();
  t.store.start();
  t.store.stop();
  t.store.stop();
  expect(t.counts().closed).toBe(true);

  const shown: OpenView[] = [];
  const store = createMapStore(
    {
      fetch: async () => {
        throw new Error("offline");
      },
      connect: () => ({
        addEventListener: (type, l) => void (type === "open" && l()),
        close() {},
      }),
      show: (v) => void shown.push(v),
      reload() {},
      stashDraft() {},
    },
    "my project",
  );
  store.start();
  await Bun.sleep(20);
  expect(shown).toEqual([]);
});

test("opening a card reads that card's page, and opening null reads the open card again", async () => {
  const t = setup();
  t.store.start();
  t.store.open("a:b");
  await t.settled();
  expect(t.reads.at(-1)).toBe("/api/projects/my%20project/open?card=a%3Ab");
  t.emit("changed");
  await t.settled();
  expect(t.reads.at(-1)).toBe("/api/projects/my%20project/open?card=a%3Ab");
  t.store.open(null);
  await t.settled();
  expect(t.reads.at(-1)).toBe("/api/projects/my%20project/open");
});

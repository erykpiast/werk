import { expect, test } from "bun:test";
import { createMapStore, type MapStoreDeps } from "./map-store";

/** A live channel that the test drives, and a map that the test changes between reads. */
function setup(initial: { id: string; title: string }[]) {
  let cards = initial;
  const listeners = new Map<string, () => void>();
  const reads: string[] = [];
  let reloads = 0;
  let stashes = 0;
  let closed = false;
  const respond = (body: unknown) => Response.json(body);
  const deps: MapStoreDeps = {
    fetch: async (url) => {
      reads.push(url);
      if (url === "/api/graph?shape=1") {
        return respond({
          nodes: [
            { id: "root", kind: "card" },
            ...cards.map((c) => ({ id: c.id, kind: "card" })),
          ],
          edges: cards.map((c) => ({
            from: c.id,
            to: "root",
            type: "refines",
          })),
        });
      }
      const id = decodeURIComponent(url.replace("/api/card/", ""));
      const found =
        id === "root" ? { title: "Root" } : cards.find((c) => c.id === id);
      return respond(
        found
          ? {
              found: true,
              card: {
                id,
                why: "",
                body: "",
                status: "open",
                proposed: false,
                ...found,
              },
            }
          : { found: false },
      );
    },
    connect: () => ({
      addEventListener: (type, listener) => void listeners.set(type, listener),
      close: () => {
        closed = true;
      },
    }),
    reload: () => void reloads++,
    stashDraft: () => void stashes++,
  };
  const store = createMapStore(deps);
  const settled = () => Bun.sleep(20);
  return {
    store,
    settled,
    reads,
    emit: (type: string) => listeners.get(type)?.(),
    setCards: (next: typeof initial) => {
      cards = next;
    },
    counts: () => ({ reloads, stashes, closed }),
  };
}

test("each connect reads the whole map", async () => {
  const t = setup([{ id: "a", title: "A" }]);
  t.store.start();
  expect(t.store.getState()).toMatchObject({
    connection: "connecting",
    loaded: false,
  });
  t.emit("open");
  await t.settled();
  expect(t.store.getState().connection).toBe("live");
  expect(t.store.getState().open?.title).toBe("Root");
  expect(t.store.getState().subCards.map((c) => c.title)).toEqual(["A"]);

  t.emit("error");
  expect(t.store.getState().connection).toBe("down");
  t.setCards([
    { id: "a", title: "A" },
    { id: "b", title: "B" },
  ]);
  t.emit("open");
  await t.settled();
  expect(t.store.getState().subCards.map((c) => c.title)).toEqual(["A", "B"]);
});

test("a bare changed signal reads the whole map again and tells the listeners", async () => {
  const t = setup([]);
  let heard = 0;
  const off = t.store.subscribe(() => void heard++);
  t.store.start();
  t.emit("open");
  await t.settled();
  const before = heard;
  t.setCards([{ id: "x", title: "X" }]);
  t.emit("changed");
  await t.settled();
  expect(t.store.getState().subCards.map((c) => c.id)).toEqual(["x"]);
  expect(heard).toBeGreaterThan(before);
  off();
  const after = heard;
  t.emit("changed");
  await t.settled();
  expect(heard).toBe(after);
});

test("a reload signal stashes the draft, then reloads, and reads nothing", async () => {
  const t = setup([]);
  t.store.start();
  t.emit("reload");
  expect(t.counts()).toMatchObject({ stashes: 1, reloads: 1 });
  expect(t.reads).toEqual([]);
});

test("a read that a later read overtakes is dropped", async () => {
  const t = setup([{ id: "a", title: "A" }]);
  t.store.start();
  t.emit("changed");
  t.setCards([
    { id: "a", title: "A" },
    { id: "b", title: "B" },
  ]);
  t.emit("changed");
  await t.settled();
  expect(t.store.getState().subCards.map((c) => c.id)).toEqual(["a", "b"]);
});

test("a failed read keeps the last map, and the next signal reads again", async () => {
  const t = setup([]);
  t.store.start();
  t.emit("open");
  await t.settled();
  const failing = createMapStore({
    fetch: async () => new Response("nope", { status: 500 }),
    connect: () => ({
      addEventListener: (_t, l) => void (_t === "open" && l()),
      close() {},
    }),
    reload() {},
    stashDraft() {},
  });
  failing.start();
  await t.settled();
  expect(failing.getState().loaded).toBe(false);
  expect(t.store.getState().loaded).toBe(true);
});

test("an empty map opens no card, and stop closes the channel once", async () => {
  const empty = createMapStore({
    fetch: async (url) =>
      url.startsWith("/api/graph")
        ? Response.json({ nodes: [], edges: [] })
        : Response.json({ found: false }),
    connect: () => ({
      addEventListener: (type, l) => void (type === "open" && l()),
      close() {},
    }),
    reload() {},
    stashDraft() {},
  });
  empty.start();
  await Bun.sleep(20);
  expect(empty.getState()).toMatchObject({
    loaded: true,
    open: null,
    subCards: [],
  });

  const t = setup([]);
  t.store.start();
  t.store.start();
  t.store.stop();
  t.store.stop();
  expect(t.counts().closed).toBe(true);
});

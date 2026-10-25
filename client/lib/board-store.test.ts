import { expect, test } from "bun:test";
import { type BoardState, createBoardStore } from "./board-store";

const board = {
  columns: { blocked: [], ready: [], building: [], merging: [], done: [] },
};

function setup(ticket: string | null = null) {
  const urls: string[] = [];
  const shown: BoardState[] = [];
  let beat: (() => void) | undefined;
  let stopped = 0;
  let ok = true;
  const store = createBoardStore(
    {
      fetch: async (url) => {
        urls.push(url);
        if (!ok) return new Response("", { status: 500 });
        return url.includes("/board/log")
          ? Response.json({ lines: [{ time: "t", text: "x" }] })
          : Response.json(board);
      },
      logTicket: () => ticket,
      show: (state) => void shown.push(state),
      every: (_ms, run) => {
        beat = run;
        return () => void stopped++;
      },
    },
    "my project",
  );
  return {
    store,
    urls,
    shown,
    beat: () => beat?.(),
    stopped: () => stopped,
    fail: () => {
      ok = false;
    },
  };
}

test("start reads the board of the project at once and again on each poll beat", async () => {
  const s = setup();
  s.store.start();
  await Bun.sleep(10);
  expect(s.urls).toEqual(["/api/projects/my%20project/board"]);
  expect(s.shown[0]).toEqual({ board, lines: null });
  s.beat();
  await Bun.sleep(10);
  expect(s.shown).toHaveLength(2);
});

test("the log of the open ticket is read with the board", async () => {
  const s = setup("r/01");
  await s.store.refresh();
  expect(s.urls[1]).toBe("/api/projects/my%20project/board/log?ticket=r%2F01");
  expect(s.shown[0]?.lines).toEqual([{ time: "t", text: "x" }]);
});

test("a failed read shows nothing, and stop ends the poll and drops a read in flight", async () => {
  const s = setup();
  s.fail();
  await s.store.refresh();
  expect(s.shown).toEqual([]);
  s.store.start();
  s.store.stop();
  expect(s.stopped()).toBe(1);
  await Bun.sleep(10);
  expect(s.shown).toEqual([]);
});

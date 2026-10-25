import { expect, test } from "bun:test";
import { emptyQueue, enqueue, exitAll, finish, holds } from "./turn-queue.ts";

const a = { turn: "a", text: "A", card: null };
const b = { turn: "b", text: "B", card: "x" };

test("the first turn starts at once, and a second one waits", () => {
  const first = enqueue(emptyQueue, a);
  expect(first.start).toEqual(a);
  const second = enqueue(first.queue, b);
  expect(second.start).toBeNull();
  expect(second.queue.active).toEqual(a);
  expect(second.queue.waiting).toEqual([b]);
  expect(holds(second.queue, "b")).toBe(true);
  expect(holds(second.queue, "c")).toBe(false);
});

test("the end line closes the active turn and starts the next one", () => {
  const queue = enqueue(enqueue(emptyQueue, a).queue, b).queue;
  const done = finish(queue);
  expect(done.ended).toBe("a");
  expect(done.start).toEqual(b);
  expect(done.queue.active).toEqual(b);
  const last = finish(done.queue);
  expect(last.ended).toBe("b");
  expect(last.start).toBeNull();
  expect(last.queue).toEqual(emptyQueue);
});

test("an end line with no open turn ends nothing", () => {
  expect(finish(emptyQueue).ended).toBeNull();
});

test("an exit ends every open turn in the order they were sent", () => {
  const queue = enqueue(enqueue(emptyQueue, a).queue, b).queue;
  const out = exitAll(queue);
  expect(out.ended).toEqual(["a", "b"]);
  expect(out.queue).toEqual(emptyQueue);
  expect(exitAll(emptyQueue).ended).toEqual([]);
});

import { expect, test } from "bun:test";
import { fold } from "./fold.ts";
import { inboxLines, threadLines } from "./thread.ts";

const node = (title: string) => ({
  type: "node.proposed",
  id: "x",
  kind: "card",
  title,
  status: "open",
});
const note = (text: string) => ({
  type: "note.added",
  id: "x",
  by: "agent",
  text,
});
const map = fold(
  [
    node("first"), // 1
    note("N1"), // 2
    { type: "node.discarded", id: "x" }, // 3
    node("second"), // 4
    note("N2"), // 5
  ].map((event, i) => ({ line: i + 1, event })),
);

test("a thread lists the old note, the marker, then the new note", () => {
  expect(map.problems).toEqual([]);
  expect(threadLines(map.threads.get("x") ?? [])).toEqual([
    "  agent: N1",
    "  -- proposed again --",
    "  agent: N2",
  ]);
});

test("the inbox lists entries by log position, after a start and up to a count", () => {
  expect(inboxLines(map, 0, 20)).toEqual([
    "2  x  agent: N1",
    "4  x  -- proposed again --",
    "5  x  agent: N2",
  ]);
  expect(inboxLines(map, 2, 20)).toHaveLength(2);
  expect(inboxLines(map, 0, 1)).toEqual(["2  x  agent: N1"]);
});

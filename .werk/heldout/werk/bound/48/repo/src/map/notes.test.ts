import { expect, test } from "bun:test";
import { fold } from "./fold.ts";
import { EARLIER_WORDS, formatInbox, formatThread } from "./notes.ts";
import type { Draft } from "./types.ts";

const mapOf = (...drafts: Draft[]) =>
  fold(drafts.map((d, i) => JSON.stringify({ seq: i + 1, at: "t", ...d })).join("\n"));
const proposed = (title: string): Draft => ({
  type: "node.proposed",
  actor: "agent",
  payload: { id: "x", kind: "card", title },
});
const note = (id: string, text: string, actor: "you" | "agent" = "you"): Draft => ({
  type: "note.added",
  actor,
  payload: { id, text },
});
const discard: Draft = { type: "change.discarded", actor: "agent", payload: { id: "x" } };

test("an empty thread prints nothing", () => {
  expect(formatThread([])).toEqual([]);
});

test("a thread prints each note with its position and writer, and each marker", () => {
  const map = mapOf(
    proposed("Old"),
    note("x", "Say more"),
    discard,
    proposed("New"),
    note("x", "Done\nthanks", "agent"),
  );
  expect(formatThread(map.threads.get("x") ?? [])).toEqual([
    "Thread",
    "  [2] you: Say more",
    "  [4] --- proposed again: the notes above were about the earlier words ---",
    "  [5] agent: Done\n    thanks",
  ]);
});

test("the inbox prints only the person's notes, in log order, under the title the id has now", () => {
  const map = mapOf(
    { type: "node.added", actor: "you", payload: { id: "b", kind: "card", title: "B" } },
    proposed("Export is its own command"),
    note("x", "Say what the export writes."),
    note("b", "An agent reply", "agent"),
    note("b", "On B"),
    discard,
    proposed("Export writes every order as one file"),
    note("x", "Better."),
  );
  expect(formatInbox(map, { since: 0, count: 20 })).toBe(
    [
      `[3] #x  Export writes every order as one file  ${EARLIER_WORDS}`,
      "    Say what the export writes.",
      "[5] #b  B",
      "    On B",
      "[8] #x  Export writes every order as one file",
      "    Better.",
      "",
    ].join("\n"),
  );
});

test("the inbox starts after the given position and stops at the count", () => {
  const map = mapOf(proposed("X"), note("x", "one"), note("x", "two"), note("x", "three"), note("x", "four"));
  expect(formatInbox(map, { since: 2, count: 2 })).toBe("[3] #x  X\n    two\n[4] #x  X\n    three\n");
  expect(formatInbox(map, { since: 5, count: 20 })).toBe("");
});

test("a note on an id that is discarded and not proposed again prints with no title", () => {
  const map = mapOf(proposed("X"), note("x", "gone"), discard);
  expect(formatInbox(map, { since: 0, count: 20 })).toBe("[2] #x\n    gone\n");
});

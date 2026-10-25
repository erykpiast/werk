import { expect, test } from "bun:test";
import { emptyChat, reduce } from "./chat-log";
import { nextPhrase, offerOf } from "./next-offer";

test("a last line with say or reply gives its phrase, in straight or curly quotes, bold or not", () => {
  expect(nextPhrase('Done.\n\nNext: say "merge it"')).toBe("merge it");
  expect(nextPhrase("Next: reply “merge it”\n")).toBe("merge it");
  expect(nextPhrase('**Next:** say "merge it"')).toBe("merge it");
  expect(nextPhrase('**Next: say "merge it"**')).toBe("merge it");
});

test("text after the closing quote is ignored", () => {
  expect(nextPhrase('Next: say "go" and I do steps 1-4')).toBe("go");
});

test("another wording, or a Next line that is not last, gives no phrase", () => {
  expect(nextPhrase('Next: type "go"')).toBeNull();
  expect(nextPhrase('Next: say "go"\nMore text')).toBeNull();
  expect(nextPhrase('Next: say ""')).toBeNull();
  expect(nextPhrase("")).toBeNull();
});

const finished = (text: string, error = false) => {
  let state = reduce(emptyChat, { type: "sent", turn: "t1", text: "hi" });
  state = reduce(state, {
    type: "chat",
    turn: "t1",
    id: "b1",
    block: { kind: "text", text },
  });
  return reduce(state, {
    type: "turn-end",
    turn: "t1",
    durationMs: 1,
    costUsd: null,
    error,
  });
};

test("the offer comes from the newest finished turn, and the next message removes it", () => {
  const state = finished('Next: say "merge it"');
  expect(offerOf(state)).toBe("merge it");
  expect(offerOf(reduce(state, { type: "sent", turn: "t2", text: "x" }))).toBe(
    null,
  );
});

test("an open turn, a failed turn and a streaming block give no offer", () => {
  expect(offerOf(emptyChat)).toBeNull();
  expect(offerOf(finished('Next: say "go"', true))).toBeNull();
  const open = reduce(emptyChat, { type: "sent", turn: "t1", text: "hi" });
  expect(offerOf(open)).toBeNull();
  const streaming = reduce(
    reduce(open, {
      type: "delta",
      turn: "t1",
      id: "b1",
      kind: "text",
      text: 'Next: say "go"',
    }),
    {
      type: "turn-end",
      turn: "t1",
      durationMs: 1,
      costUsd: null,
      error: false,
    },
  );
  expect(offerOf(streaming)).toBeNull();
});

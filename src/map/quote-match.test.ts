import { expect, test } from "bun:test";
import {
  isConversationName,
  matchQuote,
  missingParts,
  type Spoken,
  spokenMessages,
} from "./quote-match.ts";

const line = (fields: Record<string, unknown>) => JSON.stringify(fields);
const spoken = (text: string, extra: Record<string, unknown> = {}) =>
  line({
    speaker: "agent",
    at: "10:02",
    session: "s1",
    kind: "spoken",
    text,
    ...extra,
  });

const msg = (position: number, text: string): Spoken => ({
  position,
  speaker: "agent",
  at: "t",
  session: "s",
  text,
});

test("a conversation name is a plain file name", () => {
  for (const ok of ["pricing", "a.b-c_d", "7"]) {
    expect(isConversationName(ok)).toBe(true);
  }
  for (const no of ["", ".x", "../x", "a/b", "a b"]) {
    expect(isConversationName(no)).toBe(false);
  }
});

test("only spoken lines come back, and every line counts for the position", () => {
  const log = [
    spoken("zero"),
    line({ kind: "tool_result", text: "seats" }),
    "not json",
    "",
    "[1]",
    "7",
    line({ kind: "other", text: "x" }),
    spoken("seven", { speaker: 3 }),
    line({ kind: "spoken", text: 42 }),
  ].join("\n");
  const found = spokenMessages(`${log}\n`);
  expect(found.map((m) => [m.position, m.text])).toEqual([
    [0, "zero"],
    [7, "seven"],
    [8, ""],
  ]);
  expect(found[1]?.speaker).toBe("");
  expect(found[0]).toEqual({
    position: 0,
    speaker: "agent",
    at: "10:02",
    session: "s1",
    text: "zero",
  });
});

test("a log without a final newline gives the same positions", () => {
  expect(spokenMessages(`${spoken("a")}\n${spoken("b")}`)).toHaveLength(2);
  expect(spokenMessages("")).toEqual([]);
});

test("the worked example of the card: one match, two messages, two matches, one match again", () => {
  const messages = [
    msg(3, "We pick a grid."),
    msg(7, "the grid wins, and the grid is faster."),
  ];
  expect(matchQuote(messages, "pick a grid")).toMatchObject({
    ok: true,
    start: 3,
    end: 14,
  });
  expect(matchQuote(messages, "grid")).toEqual({
    ok: false,
    reason: "a match in 2 messages; quote more of the sentence",
  });
  expect(matchQuote(messages, "the grid")).toEqual({
    ok: false,
    reason: "2 matches in one message; quote more of the sentence",
  });
  const last = matchQuote(messages, "the grid is faster");
  expect(last).toMatchObject({ ok: true, start: 19, end: 37 });
  expect(last.ok && last.message.position).toBe(7);
});

test("overlapping matches in one message count each start", () => {
  expect(matchQuote([msg(0, "aaa")], "aa")).toEqual({
    ok: false,
    reason: "2 matches in one message; quote more of the sentence",
  });
});

test("no match and an empty text fail with their own reason", () => {
  expect(matchQuote([msg(0, "abc")], "zzz")).toEqual({
    ok: false,
    reason: "no match in a spoken message",
  });
  expect(matchQuote([], "a")).toMatchObject({ ok: false });
  expect(matchQuote([msg(0, "abc")], "")).toEqual({
    ok: false,
    reason: "the text to quote is empty",
  });
});

test("missingParts names each empty part of the pointer", () => {
  expect(missingParts(msg(0, "x"))).toEqual([]);
  expect(
    missingParts({ position: 0, speaker: "", at: "", session: "", text: "x" }),
  ).toEqual(["session", "speaker", "time"]);
});

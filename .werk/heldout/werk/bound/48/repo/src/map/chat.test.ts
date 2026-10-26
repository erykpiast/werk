import { expect, test } from "bun:test";
import { type ChatLine, chatLogPath, describeMiss, matchQuote, readChat } from "./chat.ts";

const line = (kind: string, text: string, speaker = "person") =>
  JSON.stringify({ speaker, at: `t-${text.length}`, session: "s-1", kind, text });

test("a conversation's chat log sits in the chats folder beside the decision log", () => {
  expect(chatLogPath("/p/.werk/log.jsonl", "pricing")).toBe("/p/.werk/chats/pricing.jsonl");
  expect(chatLogPath("/p/.werk/log.jsonl", "a.b_c-1")).toBe("/p/.werk/chats/a.b_c-1.jsonl");
});

test("a name that could leave the chats folder has no chat log", () => {
  for (const name of ["../x", "a/b", ".hidden", "", ".."])
    expect(chatLogPath("/p/.werk/log.jsonl", name)).toBeUndefined();
});

test("every line counts for the message position, a bad or unknown line too", () => {
  const lines = readChat(`${line("spoken", "hi")}\nnot json\n${JSON.stringify({ kind: "thinking", text: 3 })}\n\n`);
  expect(lines).toEqual([
    { speaker: "person", at: "t-2", session: "s-1", kind: "spoken", text: "hi" },
    { speaker: "", at: "", session: "", kind: "unknown", text: "" },
    { speaker: "", at: "", session: "", kind: "unknown", text: "" },
    { speaker: "", at: "", session: "", kind: "unknown", text: "" },
  ]);
  expect(readChat("")).toEqual([]);
  expect(readChat("null")).toHaveLength(1);
});

// M3 "We pick a grid." and M7 "the grid wins, and the grid is faster." (#werk-excerpt-once)
const transcript = (): ChatLine[] =>
  readChat(
    [
      line("spoken", "hello"),
      line("tool_call", "grep grid"),
      line("tool_result", "pick a grid is faster"),
      line("spoken", "We pick a grid."),
      line("tooling", "the grid is faster"),
      line("spoken", "fine", "agent"),
      line("tool_result", "the grid wins"),
      line("spoken", "the grid wins, and the grid is faster.", "agent"),
    ].join("\n"),
  );

test("a quote that occurs once points at its message and its span", () => {
  const found = matchQuote(transcript(), "pick a grid");
  expect(found).toMatchObject({ ok: true, message: 3, start: 3, end: 14, line: { speaker: "person" } });
  expect(matchQuote(transcript(), "the grid is faster")).toMatchObject({ ok: true, message: 7, start: 19, end: 37 });
});

test("a quote in two messages names the messages", () => {
  expect(matchQuote(transcript(), "grid")).toEqual({ ok: false, reason: "messages", messages: [3, 7] });
});

test("a quote twice in one message names the number of matches", () => {
  expect(matchQuote(transcript(), "the grid")).toEqual({ ok: false, reason: "matches", message: 7, count: 2 });
  expect(matchQuote(readChat(line("spoken", "aaa")), "aa")).toMatchObject({ reason: "matches", count: 2 });
});

test("text only in a tool call, a tool result or tooling text is no match", () => {
  expect(matchQuote(transcript(), "grep grid")).toEqual({ ok: false, reason: "no match" });
  expect(matchQuote(transcript(), "pick a grid is faster")).toEqual({ ok: false, reason: "no match" });
  expect(matchQuote(transcript(), "")).toEqual({ ok: false, reason: "no match" });
});

test("a refusal says which case it found", () => {
  expect(describeMiss({ ok: false, reason: "no match" }, "pricing")).toBe(
    "no exact match of the text in a spoken message of conversation pricing",
  );
  expect(describeMiss({ ok: false, reason: "messages", messages: [3, 7] }, "c")).toBe(
    "the text occurs in 2 messages (3, 7); quote more of the sentence",
  );
  expect(describeMiss({ ok: false, reason: "matches", message: 7, count: 2 }, "c")).toBe(
    "the text occurs 2 times in message 7; quote more of the sentence",
  );
});

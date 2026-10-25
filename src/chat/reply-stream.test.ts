import { expect, test } from "bun:test";
import {
  feed,
  initialReply,
  type Part,
  type ReplyState,
} from "./reply-stream.ts";

function play(events: unknown[]): Part[] {
  let state: ReplyState = initialReply;
  const all: Part[] = [];
  for (const event of events) {
    const [next, parts] = feed(state, event);
    state = next;
    all.push(...parts);
  }
  return all;
}

const stream = (event: unknown) => ({ type: "stream_event", event });
const start = (index: number, block: Record<string, unknown>) =>
  stream({ type: "content_block_start", index, content_block: block });
const textDelta = (index: number, text: string) =>
  stream({
    type: "content_block_delta",
    index,
    delta: { type: "text_delta", text },
  });

test("a finished block takes the id of the block that streamed, not the array index", () => {
  const parts = play([
    stream({ type: "message_start", message: { id: "m1" } }),
    start(0, { type: "thinking" }),
    start(1, { type: "text" }),
    textDelta(1, "Hel"),
    textDelta(1, "lo"),
    {
      type: "assistant",
      message: { id: "m1", content: [{ type: "thinking", thinking: "hm" }] },
    },
    {
      type: "assistant",
      message: { id: "m1", content: [{ type: "text", text: "Hello" }] },
    },
  ]);
  const ids = parts
    .filter((p) => p.type === "delta" || p.type === "chat")
    .map((p) => (p as { id: string }).id);
  expect(ids).toEqual(["m1:0", "m1:1", "m1:1", "m1:1", "m1:0", "m1:1"]);
  const chats = parts.filter((p) => p.type === "chat");
  expect(chats[1]).toEqual({
    type: "chat",
    id: "m1:1",
    block: { kind: "text", text: "Hello" },
  });
});

test("a reply that did not stream numbers its blocks in order", () => {
  const parts = play([
    {
      type: "assistant",
      message: { id: "m9", content: [{ type: "text", text: "a" }] },
    },
    {
      type: "assistant",
      message: {
        id: "m9",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "Bash",
            input: { command: "ls" },
          },
        ],
      },
    },
    {
      type: "assistant",
      message: { id: "m9", content: [{ type: "text", text: "b" }] },
    },
  ]);
  expect(parts.map((p) => (p as { id: string }).id)).toEqual([
    "m9:0",
    "m9:1",
    "m9:2",
  ]);
});

test("a message with no id gets one of its own", () => {
  const parts = play([
    { type: "assistant", message: { content: [{ type: "text", text: "a" }] } },
  ]);
  expect(parts[0]).toMatchObject({ type: "chat", id: "m1:0" });
});

test("a tool call streams its name, then its input, and its result joins by the call id", () => {
  const parts = play([
    stream({ type: "message_start", message: { id: "m1" } }),
    start(0, { type: "tool_use", id: "t1", name: "Bash" }),
    stream({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"command"' },
    }),
    {
      type: "assistant",
      message: {
        id: "m1",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "Bash",
            input: { command: "ls" },
          },
        ],
      },
    },
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: [{ type: "text", text: "a.txt" }],
          },
          { type: "text", text: "x" },
        ],
      },
    },
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "t2",
            content: "boom",
            is_error: true,
          },
        ],
      },
    },
  ]);
  expect(parts[0]).toEqual({
    type: "delta",
    id: "m1:0",
    kind: "tool_use",
    text: "",
    name: "Bash",
    toolUseId: "t1",
  });
  expect(parts[1]).toEqual({
    type: "status",
    state: "running",
    tool: "Bash",
    tokens: 0,
  });
  expect(parts[2]).toMatchObject({
    type: "delta",
    kind: "tool_use",
    text: '{"command"',
  });
  const results = parts.filter(
    (p) => p.type === "chat" && p.block.kind === "tool_result",
  );
  expect(results.map((p) => (p as { block: unknown }).block)).toEqual([
    { kind: "tool_result", toolUseId: "t1", text: "a.txt", isError: false },
    { kind: "tool_result", toolUseId: "t2", text: "boom", isError: true },
  ]);
  expect(parts.at(-1)).toEqual({
    type: "status",
    state: "thinking",
    tool: null,
    tokens: 0,
  });
});

test("tokens add up across the messages of a reply, and the result ends it", () => {
  const parts = play([
    stream({ type: "message_start", message: { id: "m1" } }),
    stream({ type: "message_delta", usage: { output_tokens: 10 } }),
    stream({ type: "message_start", message: { id: "m2" } }),
    stream({ type: "message_delta", usage: { output_tokens: 5 } }),
    stream({ type: "message_delta", usage: {} }),
    {
      type: "result",
      is_error: false,
      duration_ms: 1500,
      total_cost_usd: 0.04,
    },
    { type: "result", is_error: true },
  ]);
  const statuses = parts
    .filter((p) => p.type === "status")
    .map((p) => (p as { tokens: number }).tokens);
  expect(statuses).toEqual([10, 15]);
  expect(parts.filter((p) => p.type === "end")).toEqual([
    { type: "end", durationMs: 1500, costUsd: 0.04, error: false },
    { type: "end", durationMs: null, costUsd: null, error: true },
  ]);
});

test("lines that carry no part are ignored", () => {
  expect(
    play([
      "text",
      null,
      { type: "system", subtype: "init" },
      stream({
        type: "content_block_start",
        index: 0,
        content_block: { type: "redacted_thinking" },
      }),
      stream({
        type: "content_block_delta",
        index: 4,
        delta: { type: "text_delta", text: "x" },
      }),
      stream({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "" },
      }),
      stream({ type: "ping" }),
      { type: "stream_event" },
      {
        type: "assistant",
        message: { id: "m", content: [{ type: "redacted_thinking" }, "x"] },
      },
      { type: "user", message: { content: [{ type: "text", text: "hi" }] } },
    ]),
  ).toEqual([]);
});

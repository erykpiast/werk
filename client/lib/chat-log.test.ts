import { expect, test } from "bun:test";
import {
  type Action,
  briefOf,
  type ChatState,
  emptyChat,
  endLine,
  formatTokens,
  headOf,
  type Item,
  reduce,
  rowsOf,
  toolSummary,
} from "./chat-log";

const run = (...actions: Action[]): ChatState =>
  actions.reduce(reduce, emptyChat);
const text = (turn: string, id: string, body: string): Action => ({
  type: "chat",
  turn,
  id,
  block: { kind: "text", text: body },
});
const call = (
  turn: string,
  id: string,
  name: string,
  input: unknown,
  toolUseId = `u${id}`,
): Action => ({
  type: "chat",
  turn,
  id,
  block: { kind: "tool_use", name, input, toolUseId },
});

test("a second message waits, and every part of the first reply stays above it", () => {
  const state = run(
    { type: "sent", turn: "a", text: "A" },
    { type: "turn-start", turn: "a", at: 0 },
    text("a", "m:0", "a1"),
    { type: "sent", turn: "b", text: "B" },
    text("a", "m:1", "a2"),
  );
  expect(state.turns.map((t) => t.name)).toEqual(["a", "b"]);
  expect(state.turns[0]?.items.map((i) => i.text)).toEqual(["a1", "a2"]);
  expect(state.turns[0]?.waiting).toBe(false);
  expect(state.turns[1]?.waiting).toBe(true);
  expect(state.turns[1]?.items).toEqual([]);
});

test("the end of a turn starts the next one and the waiting mark goes", () => {
  const state = run(
    { type: "sent", turn: "a", text: "A" },
    { type: "sent", turn: "b", text: "B" },
    {
      type: "turn-end",
      turn: "a",
      durationMs: 1000,
      costUsd: 0.04,
      error: false,
    },
    { type: "turn-start", turn: "b", at: 5 },
    text("b", "n:0", "b1"),
  );
  expect(state.turns[0]?.end).toMatchObject({ durationMs: 1000 });
  expect(state.turns[1]?.waiting).toBe(false);
  expect(state.turns[1]?.items).toHaveLength(1);
});

test("a message sent while nothing runs does not wait, and a repeated send changes nothing", () => {
  const once = run({ type: "sent", turn: "a", text: "A" });
  expect(once.turns[0]?.waiting).toBe(false);
  expect(reduce(once, { type: "sent", turn: "a", text: "A" })).toBe(once);
});

test("a part for a turn this page did not send starts a turn", () => {
  const state = run(text("other", "m:0", "hello"));
  expect(state.turns).toHaveLength(1);
  expect(state.turns[0]).toMatchObject({
    name: "other",
    text: null,
    waiting: false,
  });
});

test("a finished block replaces the block it streamed as, in place", () => {
  const state = run(
    { type: "delta", turn: "a", id: "m:0", kind: "thinking", text: "hm" },
    { type: "delta", turn: "a", id: "m:1", kind: "text", text: "Hel" },
    { type: "delta", turn: "a", id: "m:1", kind: "text", text: "lo" },
    {
      type: "chat",
      turn: "a",
      id: "m:0",
      block: { kind: "thinking", text: "hmm" },
    },
    text("a", "m:1", "Hello!"),
    { type: "delta", turn: "a", id: "m:1", kind: "text", text: "late" },
  );
  const items = state.turns[0]?.items as Item[];
  expect(items.map((i) => [i.id, i.text, i.streaming])).toEqual([
    ["m:0", "hmm", false],
    ["m:1", "Hello!", false],
  ]);
});

test("a tool call streams in, finishes, and takes its result", () => {
  const state = run(
    {
      type: "delta",
      turn: "a",
      id: "m:0",
      kind: "tool_use",
      name: "Bash",
      toolUseId: "u1",
      text: "",
    },
    { type: "delta", turn: "a", id: "m:0", kind: "tool_use", text: '{"co' },
    call("a", "m:0", "Bash", { command: "ls" }, "u1"),
    {
      type: "chat",
      turn: "a",
      id: "result:u1",
      block: {
        kind: "tool_result",
        toolUseId: "u1",
        text: "x",
        isError: false,
      },
    },
  );
  const item = state.turns[0]?.items[0];
  expect(item).toMatchObject({
    name: "Bash",
    input: { command: "ls" },
    streaming: false,
    result: { text: "x" },
  });
  const streaming = run(
    {
      type: "delta",
      turn: "a",
      id: "m:0",
      kind: "tool_use",
      name: "Bash",
      toolUseId: "u1",
      text: "",
    },
    { type: "delta", turn: "a", id: "m:0", kind: "tool_use", text: "{}" },
  ).turns[0]?.items[0];
  expect(streaming).toMatchObject({
    name: "Bash",
    input: "{}",
    streaming: true,
  });
});

test("three tool calls in a row are one row with the count 3, and text ends the run", () => {
  const state = run(
    call("a", "m:0", "Read", { file_path: "a.ts" }),
    call("a", "m:1", "Grep", { pattern: "x" }),
    call("a", "m:2", "Bash", { command: "ls   -la\n" }),
    text("a", "m:3", "done"),
    call("a", "m:4", "Edit", {}),
  );
  const rows = rowsOf(state.turns[0]?.items ?? []);
  expect(rows.map((r) => r.type)).toEqual(["tools", "item", "tools"]);
  const first = rows[0];
  if (first?.type !== "tools") throw new Error("expected a run");
  expect(toolSummary(first.calls)).toEqual({ latest: "Bash ls -la", count: 3 });
  expect(toolSummary([])).toEqual({ latest: "tool", count: 0 });
  const long = {
    id: "x",
    kind: "tool_use",
    text: "",
    streaming: false,
    input: { command: "x".repeat(80) },
  } as Item;
  expect(briefOf(long)).toHaveLength(60);
  expect(briefOf({ ...long, input: "partial" })).toBe("");
});

test("status shows while a turn runs and goes at its end", () => {
  const running = run(
    { type: "sent", turn: "a", text: "A" },
    { type: "turn-start", turn: "a", at: 1000 },
    { type: "status", turn: "a", state: "running", tool: "Bash", tokens: 1500 },
  );
  expect(headOf(running, 6000)).toEqual({
    busy: true,
    label: "running Bash",
    seconds: 5,
    tokens: 1500,
  });
  expect(
    headOf(
      run(
        { type: "sent", turn: "a", text: "A" },
        { type: "turn-start", turn: "a", at: 0 },
      ),
      2000,
    ),
  ).toMatchObject({ label: "thinking", tokens: null });
  expect(headOf(run({ type: "sent", turn: "a", text: "A" }), 0)).toMatchObject({
    seconds: null,
  });
  const ended = reduce(running, {
    type: "turn-end",
    turn: "a",
    durationMs: 1,
    costUsd: null,
    error: false,
  });
  expect(headOf(ended, 0)).toEqual({
    busy: false,
    label: "idle",
    seconds: null,
    tokens: null,
  });
  expect(
    reduce(ended, {
      type: "status",
      turn: "a",
      state: "thinking",
      tool: null,
      tokens: 1,
    }),
  ).toEqual(ended);
});

test("the end line shows duration and cost, or why the agent exited", () => {
  expect(endLine({ durationMs: 12400, costUsd: 0.036, error: false })).toBe(
    "12s · $0.04",
  );
  expect(endLine({ durationMs: null, costUsd: null, error: false })).toBe("");
  expect(
    endLine({ durationMs: null, costUsd: null, error: true, exited: "boom" }),
  ).toBe("the agent exited: boom");
  expect(formatTokens(950)).toBe("950 tokens");
  expect(formatTokens(1500)).toBe("1.5k tokens");
});

import { expect, test } from "bun:test";
import { fullTime, previewOf, summariseEvent } from "./session-log.ts";

const line = (at: string, event: unknown) => JSON.stringify({ at, event });

test("the full time keeps the date and the second and drops the zone", () => {
  expect(fullTime("2026-10-25T14:03:22.481Z")).toBe("2026-10-25 14:03:22");
  expect(fullTime("2026-10-25T14:03:22+02:00")).toBe("2026-10-25 14:03:22");
});

test("an assistant event is one line with its text and its tool calls", () => {
  expect(
    summariseEvent({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "I   run\nthe tests" },
          { type: "tool_use", name: "Bash", input: { command: "make test" } },
          { type: "thinking" },
          { type: "tool_use", name: "Odd", input: 3 },
          { type: "unknown" },
        ],
      },
    }),
  ).toBe("agent: I run the tests · tool Bash make test · thinking · tool Odd");
});

test("a tool result and a user text are lines, and a long text is cut", () => {
  expect(
    summariseEvent({
      type: "user",
      message: {
        content: [
          { type: "tool_result", content: "ok", is_error: false },
          {
            type: "tool_result",
            content: [{ text: "boom" }, 4],
            is_error: true,
          },
          { type: "tool_result" },
        ],
      },
    }),
  ).toBe("user: tool result: ok · tool error: boom · tool result");
  expect(summariseEvent({ type: "user", message: { content: "hello" } })).toBe(
    "user: hello",
  );
  const long = summariseEvent({
    type: "assistant",
    message: { content: [{ type: "text", text: "x".repeat(400) }] },
  });
  expect(long?.length).toBeLessThan(180);
  expect(long?.endsWith("…")).toBe(true);
});

test("system, result and overseer events say their kind, and an empty message says nothing", () => {
  expect(summariseEvent({ type: "system", subtype: "init" })).toBe(
    "system init",
  );
  expect(summariseEvent({ type: "system" })).toBe("system");
  expect(summariseEvent({ type: "result", subtype: "success" })).toBe(
    "result success",
  );
  expect(summariseEvent({ type: "result", is_error: true })).toBe(
    "result error",
  );
  expect(summariseEvent({ type: "result" })).toBe("result done");
  expect(summariseEvent({ type: "overseer", text: "silent 60s" })).toBe(
    "overseer: silent 60s",
  );
  expect(summariseEvent({ type: "overseer" })).toBe("overseer");
  expect(summariseEvent({ type: "assistant", message: { content: [] } })).toBe(
    null,
  );
  expect(summariseEvent({ type: "stream_event" })).toBe("stream_event");
  expect(summariseEvent({})).toBe(null);
  expect(summariseEvent("x")).toBe(null);
});

test("the preview skips a line of the wrong shape and keeps the last 200 events, oldest first", () => {
  const text = [
    "not json",
    "",
    "[1]",
    JSON.stringify({ event: { type: "system" } }),
    JSON.stringify({ at: "2026-10-25T10:00:00Z" }),
    line("2026-10-25T10:00:01Z", {
      type: "assistant",
      message: { content: [] },
    }),
    ...Array.from({ length: 205 }, (_, i) =>
      line(`2026-10-25T11:00:${String(i % 60).padStart(2, "0")}Z`, {
        type: "result",
        subtype: `s${i}`,
      }),
    ),
  ].join("\n");
  const lines = previewOf(text);
  expect(lines).toHaveLength(200);
  expect(lines[0]?.text).toBe("result s5");
  expect(lines[199]?.text).toBe("result s204");
  expect(lines[0]?.time).toBe("2026-10-25 11:00:05");
  expect(previewOf(text, 2).map((l) => l.text)).toEqual([
    "result s203",
    "result s204",
  ]);
});

test("a werk_overseer line says its act and its text", () => {
  expect(
    summariseEvent({
      type: "werk_overseer",
      act: "silent",
      text: "no event for 60 s",
    }),
  ).toBe("overseer silent: no event for 60 s");
  expect(summariseEvent({ type: "werk_overseer" })).toBe("overseer act");
});

import { expect, test } from "bun:test";
import {
  askEvent,
  hasInputChannel,
  insideProject,
  parseInput,
  parseScript,
  pickReply,
  resultEvent,
} from "./fake-script.ts";

const script = (roles: unknown) => JSON.stringify({ roles });

test("a script holds the replies and the exit code of each role", () => {
  const parsed = parseScript(
    script({
      builder: {
        replies: [
          [
            { event: { type: "assistant" } },
            { edit: { path: "a.txt", content: "A" } },
            { ask: { tool: "Bash", input: { command: "ls" } } },
            { ask: { id: "q", tool: "Edit" } },
            { pause: 10 },
            { crash: 2 },
          ],
        ],
        exit: 3,
      },
      chat: { replies: [] },
    }),
  );
  expect(parsed.roles.builder).toEqual({
    replies: [
      [
        { event: { type: "assistant" } },
        { edit: { path: "a.txt", content: "A" } },
        { ask: { id: undefined, tool: "Bash", input: { command: "ls" } } },
        { ask: { id: "q", tool: "Edit", input: {} } },
        { pause: 10 },
        { crash: 2 },
      ],
    ],
    exit: 3,
  });
  expect(parsed.roles.chat).toEqual({ replies: [], exit: 0 });
});

test("a script with a wrong shape throws and names the place", () => {
  expect(() => parseScript("[]")).toThrow("a script has a roles object");
  expect(() => parseScript(script({ builder: {} }))).toThrow("role builder: needs a list of replies");
  expect(() => parseScript(script({ b: { replies: [], exit: "x" } }))).toThrow("role b: the exit is an exit code");
  expect(() => parseScript(script({ b: { replies: [{}] } }))).toThrow("role b, reply 1: a reply is a list of steps");
  const step = (value: unknown) => () => parseScript(script({ b: { replies: [[value]] } }));
  expect(step({ event: 1, pause: 1 })).toThrow("role b, reply 1, step 1: a step has exactly one key");
  expect(step("x")).toThrow("a step has exactly one key");
  expect(step({ edit: { path: "a" } })).toThrow("an edit needs a path and a content");
  expect(step({ ask: {} })).toThrow("an ask needs a tool name");
  expect(step({ ask: { tool: "Bash", id: 1 } })).toThrow("an ask id is text");
  expect(step({ pause: -1 })).toThrow("a pause is a number of milliseconds");
  expect(step({ crash: 1.5 })).toThrow("a crash is an exit code");
  expect(step({ dance: 1 })).toThrow("unknown step dance");
});

test("a reply is picked by role and index, and a missing one is an error, never an invented reply", () => {
  const parsed = parseScript(script({ builder: { replies: [[{ pause: 1 }], [{ pause: 2 }]] } }));
  expect(pickReply(parsed, "builder", 1)).toEqual({ reply: [{ pause: 2 }] });
  expect(pickReply(parsed, "builder", 2)).toEqual({ error: "the script has 2 replies for the role builder" });
  expect(pickReply(parsed, "grader", 0)).toEqual({ error: "the script has no replies for the role grader" });
  expect(pickReply(parsed, "", 0)).toEqual({ error: "the script has no replies for the role (none)" });
});

test("a path is inside the project only when it names something below the project folder", () => {
  expect(insideProject("/p", "a.txt")).toBe(true);
  expect(insideProject("/p", "src/../a.txt")).toBe(true);
  expect(insideProject("/p", "/p/a.txt")).toBe(true);
  expect(insideProject("/p", "..a")).toBe(true);
  expect(insideProject("/p", "../a.txt")).toBe(false);
  expect(insideProject("/p", "..")).toBe(false);
  expect(insideProject("/p", ".")).toBe(false);
  expect(insideProject("/p", "/etc/passwd")).toBe(false);
  expect(insideProject("/p", "/pp/a.txt")).toBe(false);
});

test("a launch has an input channel only with the stream-json input format", () => {
  expect(hasInputChannel(["--input-format", "stream-json", "--verbose"])).toBe(true);
  expect(hasInputChannel(["--input-format", "text"])).toBe(false);
  expect(hasInputChannel(["-p", "do it"])).toBe(false);
});

test("an input line is a message, an answer to an ask, or nothing the fake reads", () => {
  const message = { type: "user", message: { content: "hi" } };
  expect(parseInput(JSON.stringify(message))).toEqual({ kind: "message", message });
  expect(parseInput(JSON.stringify({ type: "control_response", response: { request_id: "r1" } }))).toEqual({
    kind: "answer",
    requestId: "r1",
  });
  expect(parseInput(JSON.stringify({ type: "control_response", response: {} }))).toEqual({ kind: "other" });
  expect(parseInput("not json")).toEqual({ kind: "other" });
  expect(parseInput("[1]")).toEqual({ kind: "other" });
});

test("an ask prints a permission request, and a result names the asks that were denied", () => {
  expect(askEvent("r1", "Bash", { command: "ls" })).toEqual({
    type: "control_request",
    request_id: "r1",
    request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" }, tool_use_id: "tool-r1" },
  });
  expect(resultEvent(["r1"])).toEqual({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    denied_requests: ["r1"],
  });
});

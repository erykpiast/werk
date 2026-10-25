import { expect, test } from "bun:test";
import {
  allowFlags,
  answerText,
  callLabel,
  parseAnswer,
  parseAsk,
  picksFit,
  type Question,
  reply,
  suggestionLabels,
} from "./permission.ts";

const rule = {
  type: "addRules",
  behavior: "allow",
  destination: "session",
  rules: [{ toolName: "Bash", ruleContent: "mkdir:*" }, { toolName: "Read" }],
};
const dirs = { type: "addDirectories", directories: ["/tmp/a", "/tmp/b"] };
const request = (extra: Record<string, unknown> = {}) => ({
  type: "control_request",
  request_id: "r1",
  request: {
    subtype: "can_use_tool",
    tool_name: "Bash",
    input: { command: "ls" },
    ...extra,
  },
});
const questions: Question[] = [
  { question: "Which?", header: null, multiSelect: false, options: [] },
  { question: "Also?", header: "H", multiSelect: true, options: [] },
];

test("a can_use_tool request becomes an ask, and any other line does not", () => {
  expect(
    parseAsk(
      request({ decision_reason: "rule", permission_suggestions: [rule, 4] }),
    ),
  ).toEqual({
    id: "r1",
    tool: "Bash",
    input: { command: "ls" },
    reason: "rule",
    suggestions: [rule],
    questions: null,
  });
  expect(parseAsk({ type: "assistant" })).toBeNull();
  expect(parseAsk("x")).toBeNull();
  expect(parseAsk({ ...request(), request_id: 3 })).toBeNull();
  expect(
    parseAsk({
      type: "control_request",
      request_id: "r",
      request: { subtype: "other" },
    }),
  ).toBeNull();
});

test("the reason is kept as sent: text as it is, an object as JSON, nothing as null", () => {
  expect(parseAsk(request({ decision_reason: { type: "rule" } }))?.reason).toBe(
    '{"type":"rule"}',
  );
  expect(parseAsk(request({ decision_reason: "" }))?.reason).toBeNull();
  expect(parseAsk(request())?.reason).toBeNull();
});

test("a question tool call carries its questions, and a malformed one carries none", () => {
  const ok = parseAsk({
    ...request(),
    request: {
      subtype: "can_use_tool",
      tool_name: "AskUserQuestion",
      input: {
        questions: [
          {
            question: "Which?",
            header: "H",
            multiSelect: true,
            options: [{ label: "A", description: "a" }, { label: "" }, 3],
          },
        ],
      },
    },
  });
  expect(ok?.questions).toEqual([
    {
      question: "Which?",
      header: "H",
      multiSelect: true,
      options: [{ label: "A", description: "a" }],
    },
  ]);
  const bad = (input: unknown) =>
    parseAsk({
      ...request(),
      request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input },
    })?.questions;
  expect(bad({ questions: [] })).toBeNull();
  expect(bad({ questions: [{ question: "" }] })).toBeNull();
  expect(bad({})).toBeNull();
});

test("suggestions give labels, and only allowed rules and directories give launch flags", () => {
  expect(suggestionLabels([rule, dirs, { type: "setMode" }, {}])).toEqual([
    "Bash(mkdir:*)",
    "Read",
    "/tmp/a",
    "/tmp/b",
    "setMode",
    "update",
  ]);
  expect(
    allowFlags([
      rule,
      rule,
      dirs,
      { type: "addRules", behavior: "deny", rules: [{ toolName: "Bash" }] },
      { type: "addRules", rules: "x" },
      { type: "addDirectories" },
      { type: "setMode" },
    ]),
  ).toEqual({ tools: ["Bash(mkdir:*)", "Read"], dirs: ["/tmp/a", "/tmp/b"] });
});

test("the answer text is one line per question, and picks must cover every question", () => {
  expect(answerText(questions, [["A", "B"], ["free"]])).toBe(
    'For "Which?": A, B\nFor "Also?": free',
  );
  expect(picksFit(questions, [["A"], ["B"]])).toBe(true);
  expect(picksFit(questions, [["A"]])).toBe(false);
  expect(picksFit(questions, [["A"], []])).toBe(false);
  expect(picksFit(questions, [["A"], [" "]])).toBe(false);
  expect(picksFit(questions, "x")).toBe(false);
});

test("a call is named by its first usual argument, flattened and cut", () => {
  expect(callLabel("Bash", { command: "a\n  b" })).toBe("Bash a b");
  expect(callLabel("Read", { file_path: "/x" })).toBe("Read /x");
  expect(callLabel("Odd", { n: 1 })).toBe('Odd {"n":1}');
  expect(callLabel("Odd", null)).toBe("Odd");
  expect(callLabel("Bash", { command: "x".repeat(200) }).length).toBe(125);
});

const ask = (extra: Record<string, unknown> = {}) => {
  const parsed = parseAsk(request(extra));
  if (!parsed) throw new Error("no ask");
  return parsed;
};
const sent = (line: string) => JSON.parse(line).response;

test("Allow returns the call as it came, with no change", () => {
  const made = reply(ask(), { decision: "allow" });
  if (!made.ok) throw new Error("refused");
  expect(sent(made.line)).toEqual({
    subtype: "success",
    request_id: "r1",
    response: { behavior: "allow", updatedInput: { command: "ls" } },
  });
  expect(made.logged).toBe("allow");
  expect(made.line.endsWith("\n")).toBe(true);
});

test("Always allow sends the CLI's own suggestions back, and only when there are some", () => {
  const made = reply(ask({ permission_suggestions: [rule] }), {
    decision: "always",
  });
  if (!made.ok) throw new Error("refused");
  expect(sent(made.line).response.updatedPermissions).toEqual([rule]);
  expect(made).toMatchObject({
    logged: "always",
    widened: ["Bash(mkdir:*)", "Read"],
  });
  expect(reply(ask(), { decision: "always" }).ok).toBe(false);
});

test("Deny and Decline send a refusal message and log a deny", () => {
  for (const decision of ["deny", "decline"] as const) {
    const made = reply(ask(), { decision });
    if (!made.ok) throw new Error("refused");
    expect(sent(made.line).response.behavior).toBe("deny");
    expect(sent(made.line).response.message).not.toBe("");
    expect(made.logged).toBe("deny");
  }
});

test("a question answer is a refusal whose message is the answer, logged as an allow", () => {
  const q = ask();
  q.questions = questions;
  const made = reply(q, { decision: "answer", picks: [["A"], ["B"]] });
  if (!made.ok) throw new Error("refused");
  expect(sent(made.line).response).toEqual({
    behavior: "deny",
    message: 'For "Which?": A\nFor "Also?": B',
  });
  expect(made.logged).toBe("allow");
  expect(reply(q, { decision: "answer", picks: [["A"]] }).ok).toBe(false);
  expect(reply(ask(), { decision: "answer", picks: [["A"]] }).ok).toBe(false);
  expect(reply(q, { decision: "allow" }).ok).toBe(false);
});

test("a request body names one answer or none", () => {
  expect(parseAnswer({ decision: "allow" })).toEqual({ decision: "allow" });
  expect(parseAnswer({ decision: "decline", id: "x" })).toEqual({
    decision: "decline",
  });
  expect(parseAnswer({ decision: "answer", picks: [["A"]] })).toEqual({
    decision: "answer",
    picks: [["A"]],
  });
  expect(parseAnswer({ decision: "answer" })).toBeNull();
  expect(parseAnswer({ decision: "maybe" })).toBeNull();
  expect(parseAnswer([])).toBeNull();
});

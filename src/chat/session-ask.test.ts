import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readMap } from "../map/log-store.ts";
import { cleanEnv } from "../test-env/env.ts";
import { createProject, type Project } from "../test-env/project.ts";
import { type ChatEvent, createSession } from "./session.ts";

const projects: Project[] = [];
afterEach(async () => {
  await Promise.all(projects.splice(0).map((p) => p.dispose()));
});

function open() {
  const p = createProject();
  projects.push(p);
  const events: ChatEvent[] = [];
  const session = createSession({
    folder: p.dir,
    logPath: p.logPath,
    env: {
      ...cleanEnv(process.env),
      WERK_FAKE_SCRIPT: join(dirname(p.dir), "script.json"),
    },
    werk: "werk",
    projectIsWerk: false,
    readMap: () => readMap(p.logPath).map,
    emit: (event) => events.push(event),
  });
  return { p, session, events };
}

async function until(check: () => boolean, ms = 10000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(20);
  }
}

const mkdir = {
  id: "a1",
  tool: "Bash",
  input: { command: "mkdir -p /tmp/x" },
  reason: "rule",
  suggestions: [
    {
      type: "addRules",
      behavior: "allow",
      destination: "session",
      rules: [{ toolName: "Bash", ruleContent: "mkdir:*" }],
    },
  ],
};
const question = {
  id: "q1",
  tool: "AskUserQuestion",
  input: {
    questions: [
      {
        question: "Which db?",
        header: "DB",
        multiSelect: false,
        options: [
          { label: "Postgres", description: "SQL" },
          { label: "SQLite", description: "file" },
        ],
      },
    ],
  },
};

const asksOf = (events: ChatEvent[]) =>
  events.filter((e) => e.name === "ask").map((e) => e.data);
const resultOf = (events: ChatEvent[]) =>
  events.flatMap((e) =>
    e.name === "chat" && e.data.block.kind === "tool_result"
      ? [e.data.block.text]
      : [],
  );
const ended = (events: ChatEvent[]) =>
  events.some((e) => e.name === "turn-end");
const askLog = (logPath: string) =>
  readFileSync(join(dirname(logPath), "asks.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

test("an ask holds the turn until Allow, and the answer is logged", async () => {
  const { p, session, events } = open();
  p.install({ roles: { chat: { replies: [[{ ask: mkdir }]] } } });
  try {
    session.send({ turn: "t", text: "go", card: null });
    await until(() => asksOf(events).length === 1);
    await Bun.sleep(150);
    expect(ended(events)).toBe(false);
    expect(asksOf(events)[0]).toMatchObject({
      turn: "t",
      tool: "Bash",
      reason: "rule",
      suggestion: "Bash(mkdir:*)",
      questions: null,
    });
    expect(session.answer("a1", { decision: "allow" })).toEqual({ ok: true });
    await until(() => ended(events));
    expect(resultOf(events)).toEqual(["allowed"]);
    expect(events.some((e) => e.name === "ask-done")).toBe(true);
    const lines = askLog(p.logPath);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      tool: "Bash",
      label: "Bash mkdir -p /tmp/x",
      reason: "rule",
      decision: "allow",
      widened: [],
    });
  } finally {
    await session.stop();
  }
});

test("Deny returns a refusal message, and a second answer is refused", async () => {
  const { p, session, events } = open();
  p.install({ roles: { chat: { replies: [[{ ask: mkdir }]] } } });
  try {
    session.send({ turn: "t", text: "go", card: null });
    await until(() => asksOf(events).length === 1);
    expect(session.answer("a1", { decision: "deny" })).toEqual({ ok: true });
    expect(session.answer("a1", { decision: "deny" })).toMatchObject({
      ok: false,
    });
    await until(() => ended(events));
    expect(resultOf(events)).toEqual(["The person denied this tool call."]);
    expect(askLog(p.logPath).map((l) => l.decision)).toEqual(["deny"]);
  } finally {
    await session.stop();
  }
});

test("Always allow stores the suggestions, and the next child starts with them", async () => {
  const { p, session, events } = open();
  p.install({
    roles: { chat: { replies: [[{ ask: mkdir }], [{ crash: 1 }]] } },
  });
  try {
    session.send({ turn: "t", text: "go", card: null });
    await until(() => asksOf(events).length === 1);
    expect(session.answer("a1", { decision: "always" })).toEqual({ ok: true });
    await until(() => ended(events));
    expect(askLog(p.logPath)[0]).toMatchObject({
      decision: "always",
      widened: ["Bash(mkdir:*)"],
    });
    const stored = JSON.parse(
      readFileSync(join(dirname(p.logPath), "allow.json"), "utf8"),
    );
    expect(stored.updates).toEqual(mkdir.suggestions);
    await session.stop();
    session.send({ turn: "u", text: "again", card: null });
    await until(
      () => p.launches().filter((r) => r.kind === "launch").length === 2,
    );
    const second = p.launches().filter((r) => r.kind === "launch")[1] as {
      args: string[];
    };
    expect(second.args[second.args.indexOf("--allowedTools") + 1]).toContain(
      "Bash(mkdir:*)",
    );
  } finally {
    await session.stop();
  }
});

test("Always allow is refused for an ask with no suggestion", async () => {
  const { p, session, events } = open();
  const bare = { id: "a2", tool: "Bash", input: { command: "curl x" } };
  p.install({ roles: { chat: { replies: [[{ ask: bare }]] } } });
  try {
    session.send({ turn: "t", text: "go", card: null });
    await until(() => asksOf(events).length === 1);
    expect(asksOf(events)[0]?.suggestion).toBeNull();
    expect(session.answer("a2", { decision: "always" })).toMatchObject({
      ok: false,
    });
    expect(session.answer("a2", { decision: "allow" })).toEqual({ ok: true });
    await until(() => ended(events));
  } finally {
    await session.stop();
  }
});

test("a rule allowed in one project's conversation does not reach another project", async () => {
  const one = open();
  const other = open();
  one.p.install({
    roles: { chat: { replies: [[{ ask: mkdir }]] } },
  });
  other.p.install({ roles: { chat: { replies: [[]] } } });
  try {
    one.session.send({ turn: "t", text: "go", card: null });
    await until(() => asksOf(one.events).length === 1);
    one.session.answer("a1", { decision: "always" });
    await until(() => ended(one.events));
    other.session.send({ turn: "t", text: "go", card: null });
    await until(() => ended(other.events));
    const args = (other.p.launches()[0] as { args: string[] }).args;
    expect(args[args.indexOf("--allowedTools") + 1]).not.toContain("mkdir");
  } finally {
    await one.session.stop();
    await other.session.stop();
  }
});

test("a question form answers with one plain line per question, and the log shows no failure", async () => {
  const { p, session, events } = open();
  p.install({ roles: { chat: { replies: [[{ ask: question }]] } } });
  try {
    session.send({ turn: "t", text: "go", card: null });
    await until(() => asksOf(events).length === 1);
    expect(asksOf(events)[0]?.questions?.[0]?.options).toHaveLength(2);
    expect(
      session.answer("q1", { decision: "answer", picks: [] }),
    ).toMatchObject({ ok: false });
    expect(
      session.answer("q1", { decision: "answer", picks: [["SQLite"]] }),
    ).toEqual({ ok: true });
    await until(() => ended(events));
    expect(resultOf(events)).toEqual(['For "Which db?": SQLite']);
    expect(askLog(p.logPath)[0]).toMatchObject({
      tool: "AskUserQuestion",
      decision: "allow",
    });
  } finally {
    await session.stop();
  }
});

test("Decline refuses the question and the exit of the child closes an open ask", async () => {
  const { p, session, events } = open();
  p.install({
    roles: {
      chat: {
        replies: [[{ ask: question }], [{ ask: mkdir }, { crash: 2 }]],
      },
    },
  });
  try {
    session.send({ turn: "t", text: "go", card: null });
    await until(() => asksOf(events).length === 1);
    session.answer("q1", { decision: "decline" });
    await until(() => ended(events));
    expect(resultOf(events)).toEqual([
      "The person declined to answer the question.",
    ]);
    session.send({ turn: "u", text: "again", card: null });
    await until(() => asksOf(events).length === 2);
    await session.stop();
    await until(() => events.filter((e) => e.name === "ask-done").length === 2);
    expect(session.answer("a1", { decision: "allow" })).toMatchObject({
      ok: false,
    });
  } finally {
    await session.stop();
  }
});

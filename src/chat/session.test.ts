import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { OPUS } from "../agent/launch-options.ts";
import { readMap } from "../map/log-store.ts";
import { cleanEnv } from "../test-env/env.ts";
import { createProject, type Project } from "../test-env/project.ts";
import { type ChatEvent, type ChatSession, createSession } from "./session.ts";

let current: Project | undefined;
beforeEach(() => {
  current = createProject();
});
afterEach(async () => {
  await current?.dispose();
  current = undefined;
});
const project = () => current as Project;

const root = {
  type: "node.proposed",
  id: "root",
  kind: "card",
  title: "We build software",
  status: "open",
  why: "One pipeline.",
};
const accepted = { type: "node.accepted", id: "root", actor: "you" };

const streamed = (id: string, text: string) => [
  {
    event: {
      type: "stream_event",
      event: { type: "message_start", message: { id } },
    },
  },
  {
    event: {
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text" },
      },
    },
  },
  {
    event: {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      },
    },
  },
  {
    event: {
      type: "assistant",
      message: { id, content: [{ type: "text", text }] },
    },
  },
];
const result = {
  event: {
    type: "result",
    is_error: false,
    duration_ms: 1200,
    total_cost_usd: 0.04,
  },
};

function open(env: Record<string, string> = {}) {
  const events: ChatEvent[] = [];
  const p = project();
  const session = createSession({
    folder: p.dir,
    logPath: p.logPath,
    env: {
      ...cleanEnv(process.env),
      WERK_FAKE_SCRIPT: join(dirname(p.dir), "script.json"),
      ...env,
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

const names = (events: ChatEvent[]) =>
  events.map(
    (e) =>
      `${e.name}:${"turn" in e.data ? e.data.turn : "id" in e.data ? e.data.id : ""}`,
  );

async function withSession(
  session: ChatSession,
  body: () => Promise<void>,
): Promise<void> {
  try {
    await body();
  } finally {
    await session.stop();
  }
}

test("a message reaches the agent with the description of the open card, and the next one with the reminder", async () => {
  const { p, session, events } = open();
  p.install({ roles: { chat: { replies: [[result], [result]] } } });
  await Bun.write(
    p.logPath,
    `${JSON.stringify(root)}\n${JSON.stringify(accepted)}\n`,
  );
  await withSession(session, async () => {
    session.send({ turn: "t1", text: "What is open?", card: null });
    await until(() => events.some((e) => e.name === "turn-end"));
    session.send({ turn: "t2", text: "And now?", card: "root" });
    await until(() => events.filter((e) => e.name === "turn-end").length === 2);
  });
  const messages = p.launches().filter((r) => r.kind === "message");
  expect(messages.map((m) => (m as { text: string }).text)).toEqual([
    "[the map is now at #root — We build software]\nkind: card; status: open\nwhy: One pipeline.\n\nWhat is open?",
    "[still on #root — We build software]\n\nAnd now?",
  ]);
  const launches = p.launches().filter((r) => r.kind === "launch");
  expect(launches).toHaveLength(1);
  expect((launches[0] as { role: string }).role).toBe("chat");
  expect((launches[0] as { args: string[] }).args).toContain(
    "--include-partial-messages",
  );
});

test("the sent event carries the stored name of each image path, and none when a message has no images", async () => {
  const { p, session, events } = open();
  p.install({ roles: { chat: { replies: [[result], [result]] } } });
  await withSession(session, async () => {
    session.send({
      turn: "a",
      text: "A",
      card: null,
      images: ["/x/.werk/attachments/a.png"],
    });
    await until(() => events.some((e) => e.name === "turn-end"));
    session.send({ turn: "b", text: "B", card: null });
    await until(() => events.filter((e) => e.name === "turn-end").length === 2);
  });
  const sent = events.filter((e) => e.name === "sent");
  expect(sent.map((e) => (e.data as { images: string[] }).images)).toEqual([
    ["a.png"],
    [],
  ]);
});

test("each part of a reply carries its turn, and a second message waits until the first reply ends", async () => {
  const { p, session, events } = open();
  p.install({
    roles: {
      chat: {
        replies: [
          [
            ...streamed("m1", "one"),
            { pause: 150 },
            ...streamed("m2", "two"),
            result,
          ],
          [...streamed("m3", "three"), result],
        ],
      },
    },
  });
  await withSession(session, async () => {
    expect(session.send({ turn: "a", text: "A", card: null })).toBe("accepted");
    expect(session.send({ turn: "b", text: "B", card: null })).toBe("accepted");
    expect(session.send({ turn: "b", text: "B again", card: null })).toBe(
      "duplicate",
    );
    expect(session.running()).toEqual(["a", "b"]);
    await until(() => events.filter((e) => e.name === "turn-end").length === 2);
  });
  expect(names(events)).toEqual([
    "sent:a",
    "turn-start:a",
    "sent:b",
    "delta:a",
    "status:a",
    "delta:a",
    "chat:a",
    "delta:a",
    "status:a",
    "delta:a",
    "chat:a",
    "turn-end:a",
    "turn-start:b",
    "delta:b",
    "status:b",
    "delta:b",
    "chat:b",
    "turn-end:b",
  ]);
  const end = events.find((e) => e.name === "turn-end");
  expect(end?.data).toMatchObject({
    durationMs: 1200,
    costUsd: 0.04,
    error: false,
  });
  expect(session.history().map((e) => e.name)).not.toContain("delta");
  expect(session.running()).toEqual([]);
});

test("a scripted add shows in the map while the reply is still streaming", async () => {
  const { p, session, events } = open();
  const added = `${JSON.stringify(root)}\n${JSON.stringify(accepted)}\n${JSON.stringify({ type: "node.proposed", id: "seats", kind: "card", title: "We charge per seat", status: "open", parent: "root" })}\n`;
  p.install({
    roles: {
      chat: {
        replies: [
          [
            ...streamed("m1", "adding"),
            { edit: ".werk/log.jsonl", content: added },
            { pause: 300 },
            result,
          ],
        ],
      },
    },
  });
  await Bun.write(
    p.logPath,
    `${JSON.stringify(root)}\n${JSON.stringify(accepted)}\n`,
  );
  await withSession(session, async () => {
    session.send({ turn: "a", text: "Add seats", card: null });
    await until(() => events.some((e) => e.name === "chat"));
    await until(() => readMap(p.logPath).map.nodes.has("seats"));
    expect(events.some((e) => e.name === "turn-end")).toBe(false);
    await until(() => events.some((e) => e.name === "turn-end"));
  });
});

test("an exit ends every open turn, and the next send starts a new agent with the full description", async () => {
  const { p, session, events } = open();
  p.install({
    roles: {
      chat: {
        replies: [
          [
            { stderr: "Remove the credential and run: claude auth login" },
            { crash: 3 },
          ],
          [result],
        ],
      },
    },
  });
  await Bun.write(
    p.logPath,
    `${JSON.stringify(root)}\n${JSON.stringify(accepted)}\n`,
  );
  await withSession(session, async () => {
    session.send({ turn: "a", text: "A", card: null });
    session.send({ turn: "b", text: "B", card: null });
    await until(() => events.filter((e) => e.name === "turn-end").length === 2);
    expect(
      events.filter((e) => e.name === "turn-end").map((e) => e.data),
    ).toMatchObject([
      { turn: "a", error: true },
      { turn: "b", error: true },
    ]);
    expect(session.running()).toEqual([]);
    session.send({ turn: "c", text: "C", card: null });
    await until(() => events.filter((e) => e.name === "turn-end").length === 3);
  });
  const texts = p
    .launches()
    .filter((r) => r.kind === "message")
    .map((m) => (m as { text: string }).text);
  expect(texts.at(-1)).toStartWith("[the map is now at #root");
  expect(p.launches().filter((r) => r.kind === "launch")).toHaveLength(2);
});

test("an agent that cannot start ends the turn with the reason", async () => {
  const { session, events } = open({ PATH: "/nonexistent" });
  await withSession(session, async () => {
    session.send({ turn: "a", text: "A", card: null });
    await until(() => events.some((e) => e.name === "turn-end"));
  });
  const end = events.find((e) => e.name === "turn-end");
  expect(end?.data).toMatchObject({ turn: "a", error: true });
  expect(JSON.stringify(end?.data)).toContain("could not run");
});

const launchesOf = (p: Project) =>
  p.launches().flatMap((r) => (r.kind === "launch" ? [r.args] : []));
const flagOf = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
const sessionFile = (p: Project) => join(dirname(p.logPath), "session");
const ended = (events: ChatEvent[]) =>
  events.flatMap((e) => (e.name === "turn-end" ? [e.data] : []));

test("switching to Opus while idle restarts the agent on the same session with the Opus id", async () => {
  const { p, session, events } = open();
  p.install({ roles: { chat: { replies: [[result]] } } });
  await withSession(session, async () => {
    session.send({ turn: "a", text: "A", card: null });
    await until(() => events.some((e) => e.name === "turn-end"));
    expect(await session.setModel({ model: "opus", advisor: null })).toEqual({
      ok: true,
    });
    await until(() => launchesOf(p).length === 2);
  });
  const [first, second] = launchesOf(p) as [string[], string[]];
  expect(flagOf(first, "--model")).not.toBe(OPUS);
  expect(flagOf(second, "--model")).toBe(OPUS);
  expect(second).not.toContain("--advisor");
  expect(flagOf(second, "--resume")).toBe("fake-session-1");
  expect(session.settings()).toMatchObject({ model: "opus", advisor: null });
  expect(ended(events)).toHaveLength(1);
});

test("a switch and a clear are refused while a turn runs", async () => {
  const { p, session } = open();
  p.install({ roles: { chat: { replies: [[{ pause: 300 }, result]] } } });
  await withSession(session, async () => {
    session.send({ turn: "a", text: "A", card: null });
    const switched = await session.setModel({ model: "opus", advisor: null });
    expect(switched.ok).toBe(false);
    expect((await session.clear()).ok).toBe(false);
    expect(session.settings().model).toBe("sonnet");
  });
});

test("a rebuilt session reads the saved model and fill before any message", async () => {
  const first = open();
  first.p.install({
    roles: {
      chat: {
        replies: [
          [
            {
              event: {
                type: "assistant",
                message: {
                  id: "m1",
                  content: [{ type: "text", text: "hi" }],
                  usage: {
                    input_tokens: 10,
                    output_tokens: 20,
                    cache_read_input_tokens: 100_000,
                    cache_creation_input_tokens: 49_970,
                  },
                },
              },
            },
            {
              event: {
                type: "result",
                is_error: false,
                modelUsage: {
                  "claude-opus-5-5": { contextWindow: 200_000 },
                },
              },
            },
          ],
        ],
      },
    },
  });
  await withSession(first.session, async () => {
    await first.session.setModel({ model: "opus", advisor: null });
    first.session.send({ turn: "a", text: "A", card: null });
    await until(() => first.events.some((e) => e.name === "turn-end"));
  });
  const second = createSession({
    folder: first.p.dir,
    logPath: first.p.logPath,
    env: {},
    werk: "werk",
    projectIsWerk: false,
    readMap: () => readMap(first.p.logPath).map,
    emit: () => {},
  });
  expect(second.settings()).toEqual({
    model: "opus",
    advisor: null,
    used: 150_000,
    window: 200_000,
  });
  expect(first.session.settings().used).toBe(150_000);
});

test("a stored session that no longer resolves is cleared and the message reaches a new session", async () => {
  const { p, events } = open();
  await Bun.write(sessionFile(p), "dead-id\n");
  p.install({
    roles: {
      chat: {
        replies: [
          [
            {
              event: {
                type: "result",
                is_error: true,
                errors: ["No conversation found with session ID: dead-id"],
              },
            },
            { crash: 1 },
          ],
          [...streamed("m1", "hello"), result],
        ],
      },
    },
  });
  const reopened = createSession({
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
  await withSession(reopened, async () => {
    reopened.send({ turn: "a", text: "Where were we?", card: null });
    await until(() => events.some((e) => e.name === "turn-end"));
  });
  expect(ended(events)).toMatchObject([{ turn: "a", error: false }]);
  const [first, second] = launchesOf(p) as [string[], string[]];
  expect(flagOf(first, "--resume")).toBe("dead-id");
  expect(second).not.toContain("--resume");
  const texts = p
    .launches()
    .flatMap((r) => (r.kind === "message" ? [r.text] : []));
  expect(texts).toHaveLength(2);
  expect(texts[1]).toEndWith("Where were we?");
  expect(readFileSync(sessionFile(p), "utf8").trim()).toBe("fake-session-2");
});

test("a login error shows the whole error and is not retried", async () => {
  const { p, session, events } = open();
  const text =
    "Invalid credential.\nRemove the credential and run: claude auth login";
  p.install({
    roles: { chat: { replies: [[{ stderr: text }, { crash: 1 }], [result]] } },
  });
  await Bun.write(sessionFile(p), "keep-me\n");
  await withSession(session, async () => {
    session.send({ turn: "a", text: "A", card: null });
    await until(() => events.some((e) => e.name === "turn-end"));
  });
  expect(launchesOf(p)).toHaveLength(1);
  const end = ended(events)[0] as { exited?: string };
  expect(end.exited).toContain(text);
  expect(end.exited).toContain(
    "Your message was not delivered. Send it again.",
  );
  expect(readFileSync(sessionFile(p), "utf8").trim()).toBe("keep-me");
});

test("another crash retries once, and a second crash says the message was not delivered", async () => {
  const retried = open();
  retried.p.install({
    roles: {
      chat: { replies: [[{ stderr: "boom" }, { crash: 1 }], [result]] },
    },
  });
  await withSession(retried.session, async () => {
    retried.session.send({ turn: "a", text: "A", card: null });
    await until(() => retried.events.some((e) => e.name === "turn-end"));
  });
  expect(launchesOf(retried.p)).toHaveLength(2);
  expect(ended(retried.events)).toMatchObject([{ error: false }]);
});

test("two crashes in a row end the turn with the full error and the delivery notice", async () => {
  const { p, session, events } = open();
  p.install({
    roles: {
      chat: {
        replies: [
          [{ stderr: "boom" }, { crash: 1 }],
          [{ stderr: "boom again" }, { crash: 1 }],
        ],
      },
    },
  });
  await withSession(session, async () => {
    session.send({ turn: "a", text: "A", card: null });
    await until(() => events.some((e) => e.name === "turn-end"));
  });
  expect(launchesOf(p)).toHaveLength(2);
  const end = ended(events)[0] as { exited?: string };
  expect(end.exited).toBe(
    "boom again\n\nYour message was not delivered. Send it again.",
  );
});

test("clear context drops the session and the transcript and leaves the map's log unchanged", async () => {
  const { p, session, events } = open();
  p.install({ roles: { chat: { replies: [[result]] } } });
  await Bun.write(
    p.logPath,
    `${JSON.stringify(root)}\n${JSON.stringify(accepted)}\n`,
  );
  const before = readFileSync(p.logPath, "utf8");
  await withSession(session, async () => {
    session.send({ turn: "a", text: "A", card: null });
    await until(() => events.some((e) => e.name === "turn-end"));
    expect(existsSync(sessionFile(p))).toBe(true);
    expect(await session.clear()).toEqual({ ok: true });
    await until(() => launchesOf(p).length === 2);
  });
  expect(existsSync(sessionFile(p))).toBe(false);
  expect(session.history()).toEqual([]);
  expect(events.some((e) => e.name === "cleared")).toBe(true);
  expect(session.settings().used).toBe(0);
  expect(launchesOf(p)[1]).not.toContain("--resume");
  expect(readFileSync(p.logPath, "utf8")).toBe(before);
});

test("the session keeps the command names that the agent's start line gave", async () => {
  const { p, session, events } = open();
  const start = {
    event: {
      type: "system",
      subtype: "init",
      slash_commands: ["review", "recall"],
    },
  };
  p.install({ roles: { chat: { replies: [[start, result]] } } });
  await withSession(session, async () => {
    expect(session.commands()).toEqual([]);
    session.send({ turn: "t1", text: "hi", card: null });
    await until(() => events.some((e) => e.name === "turn-end"));
    expect(session.commands()).toEqual(["review", "recall"]);
  });
});

const taskList = (ids: string[]) => ({
  event: {
    type: "system",
    subtype: "background_tasks",
    tasks: ids.map((id) => ({ id })),
  },
});
const counts = (events: ChatEvent[]) =>
  events.flatMap((e) => (e.name === "background" ? [e.data.count] : []));

test("the background count is the length of the last full task list, and zero when the child exits", async () => {
  const { p, session, events } = open();
  p.install({
    roles: {
      chat: {
        replies: [
          [taskList(["a"]), taskList(["a", "b"]), result, { pause: 400 }],
        ],
      },
    },
  });
  await withSession(session, async () => {
    session.send({ turn: "a", text: "A", card: null });
    await until(() => events.some((e) => e.name === "turn-end"));
    expect(session.background()).toBe(2);
    expect(session.history()).toContainEqual({
      name: "background",
      data: { count: 2 },
    });
  });
  expect(counts(events)).toEqual([1, 2, 0]);
  expect(session.background()).toBe(0);
});

test("a child that crashes for good marks the session dead, and the next start clears the mark", async () => {
  const { p, session, events } = open();
  const text =
    "Invalid credential.\nRemove the credential and run: claude auth login";
  p.install({
    roles: {
      chat: {
        replies: [[taskList(["a"]), { stderr: text }, { crash: 1 }], [result]],
      },
    },
  });
  await withSession(session, async () => {
    session.send({ turn: "a", text: "A", card: null });
    await until(() => events.some((e) => e.name === "turn-end"));
    expect(session.dead()).toContain(text);
    expect(session.background()).toBe(0);
    expect(session.history()).toContainEqual({
      name: "dead",
      data: { error: session.dead() },
    });
    session.send({ turn: "b", text: "B", card: null });
    await until(() => ended(events).length === 2);
    expect(session.dead()).toBeNull();
  });
});

test("a model switch and a stop never mark the session dead", async () => {
  const { p, session, events } = open();
  p.install({ roles: { chat: { replies: [[result]] } } });
  await withSession(session, async () => {
    session.send({ turn: "a", text: "A", card: null });
    await until(() => events.some((e) => e.name === "turn-end"));
    await session.setModel({ model: "opus", advisor: null });
    await until(() => launchesOf(p).length === 2);
  });
  expect(session.dead()).toBeNull();
  expect(events.some((e) => e.name === "dead")).toBe(false);
});

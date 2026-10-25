import { afterEach, beforeEach, expect, test } from "bun:test";
import { dirname, join } from "node:path";
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
  events.map((e) => `${e.name}:${"turn" in e.data ? e.data.turn : e.data.id}`);

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
  p.install({ roles: { chat: { replies: [[{ crash: 3 }], [result]] } } });
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

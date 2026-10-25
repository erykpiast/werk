import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createProject, type Project } from "../test-env/project.ts";

const CLI = join(import.meta.dir, "..", "cli.ts");

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(async () => {
  await project.dispose();
});

async function until<T>(
  read: () => T | undefined | Promise<T | undefined>,
  ms = 10000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await (async () => read())().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(50);
  }
}

async function serving() {
  project.install({
    roles: {
      chat: {
        replies: [
          [
            {
              event: {
                type: "assistant",
                message: { id: "m1", content: [{ type: "text", text: "hi" }] },
              },
            },
            { event: { type: "result", duration_ms: 5, total_cost_usd: 0.01 } },
          ],
        ],
      },
    },
  });
  project.start(["bun", CLI, "serve", "--port", "0"]);
  const { port } = await until(() => {
    const lock = JSON.parse(
      readFileSync(join(project.dir, ".werk", "serve.lock"), "utf8"),
    );
    return lock.port > 0 ? (lock as { port: number }) : undefined;
  });
  const origin = `http://127.0.0.1:${port}`;
  const html = await (await fetch(`${origin}/`)).text();
  const token = /name="werk-token" content="([^"]+)"/.exec(html)?.[1] ?? "";
  const send = (
    body: unknown,
    headers: Record<string, string> = { "x-werk-token": token },
  ) =>
    fetch(`${origin}/api/projects/project/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const post = (
    path: string,
    body: unknown,
    headers = { "x-werk-token": token },
  ) =>
    fetch(`${origin}/api/projects/project/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  return { origin, send, post };
}

test("a send without the token, or from a foreign Host, is refused and starts no agent", async () => {
  const { send } = await serving();
  const body = { text: "hello", card: null, turn: "t1" };
  expect((await send(body, {})).status).toBe(403);
  expect((await send(body, { "x-werk-token": "wrong" })).status).toBe(403);
  expect((await send(body, { host: "evil.com" })).status).toBe(403);
  await Bun.sleep(300);
  expect(project.launches()).toEqual([]);
});

test("a send that is not a message is refused with a reason", async () => {
  const { send } = await serving();
  for (const body of [
    "not json",
    {},
    { text: "  ", turn: "t1" },
    { text: "hi", turn: "bad name" },
    { text: "hi", turn: "t1", card: 5 },
  ]) {
    const res = await send(body);
    expect(res.status).toBe(400);
  }
  expect(project.launches()).toEqual([]);
});

test("a send streams its reply on the live channel, and a page that joins late reads the history", async () => {
  const { origin, send } = await serving();
  const live = await fetch(`${origin}/api/projects/project/live`);
  const reader = (live.body as ReadableStream<Uint8Array>).getReader();
  expect((await send({ text: "hello", card: null, turn: "t1" })).status).toBe(
    202,
  );
  expect((await send({ text: "hello", card: null, turn: "t1" })).status).toBe(
    409,
  );
  const decoder = new TextDecoder();
  let seen = "";
  while (!seen.includes("event: turn-end")) {
    const chunk = await reader.read();
    if (chunk.done) break;
    seen += decoder.decode(chunk.value);
  }
  await reader.cancel();
  expect(seen).toContain('event: sent\ndata: {"turn":"t1","text":"hello"}');
  expect(seen).toContain("event: chat\ndata:");
  expect(seen).toContain('"durationMs":5');
  const history = (await (
    await fetch(`${origin}/api/projects/project/chat`)
  ).json()) as {
    events: { name: string }[];
  };
  expect(history.events.map((e) => e.name)).toEqual([
    "sent",
    "turn-start",
    "chat",
    "turn-end",
  ]);
});

test("a restarted server shows the saved model and fill before any message", async () => {
  writeFileSync(
    join(dirname(project.logPath), "chat-model.json"),
    JSON.stringify({
      model: "opus",
      advisor: null,
      used: 150_000,
      window: 200_000,
    }),
  );
  const { origin } = await serving();
  const read = (await (
    await fetch(`${origin}/api/projects/project/chat`)
  ).json()) as { settings: unknown };
  expect(read.settings).toEqual({
    model: "opus",
    advisor: null,
    used: 150_000,
    window: 200_000,
  });
  expect(project.launches()).toEqual([]);
});

test("a model switch needs the token and one of the three choices", async () => {
  const { origin, post } = await serving();
  expect(
    (await post("model", { model: "opus", advisor: null }, {} as never)).status,
  ).toBe(403);
  expect((await post("model", { model: "haiku", advisor: null })).status).toBe(
    400,
  );
  expect((await post("model", { model: "opus", advisor: null })).status).toBe(
    200,
  );
  const read = (await (
    await fetch(`${origin}/api/projects/project/chat`)
  ).json()) as { settings: { model: string } };
  expect(read.settings.model).toBe("opus");
  expect((await post("clear", {})).status).toBe(200);
});

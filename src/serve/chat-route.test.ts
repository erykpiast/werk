import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatSession } from "../chat/session.ts";
import type { Context } from "../projects/context.ts";
import { createProject, type Project } from "../test-env/project.ts";
import { clearRoute, modelRoute } from "./chat-route.ts";

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
  return { origin, send };
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

test("the history read returns the saved settings next to the events", async () => {
  const { origin } = await serving();
  const body = (await (
    await fetch(`${origin}/api/projects/project/chat`)
  ).json()) as { events: unknown[]; settings: Record<string, unknown> };
  expect(body.events).toEqual([]);
  expect(body.settings).toBeDefined();
});

function stubbed(done: { ok: true } | { ok: false; reason: string }): Context {
  const session = { setModel: async () => done, clear: async () => done };
  return {
    chats: new Map([["main", session as unknown as ChatSession]]),
  } as unknown as Context;
}

const post = (body: unknown) =>
  new Request("http://x/", { method: "POST", body: JSON.stringify(body) });

test("a model switch with a pick the header does not offer is refused with 400", async () => {
  const context = stubbed({ ok: true });
  for (const body of [{}, { model: "opus", advisor: "opus" }, "x"]) {
    expect((await modelRoute(context, {}, post(body))).status).toBe(400);
  }
  const bad = new Request("http://x/", { method: "POST", body: "not json" });
  expect((await modelRoute(context, {}, bad)).status).toBe(400);
});

test("a model switch or a clear while a turn runs answers 409 busy", async () => {
  const context = stubbed({ ok: false, reason: "a turn is running" });
  const pick = { model: "opus", advisor: null };
  const model = await modelRoute(context, {}, post(pick));
  expect(model.status).toBe(409);
  expect(((await model.json()) as { error: string }).error).toBe("busy");
  expect((await clearRoute(context, {}, post({}))).status).toBe(409);
});

test("a valid model switch and a clear answer 200", async () => {
  const context = stubbed({ ok: true });
  const pick = { model: "opus", advisor: null };
  const model = await modelRoute(context, {}, post(pick));
  expect(model.status).toBe(200);
  expect(await model.json()).toEqual(pick);
  expect((await clearRoute(context, {}, post({}))).status).toBe(200);
});

test("a GET to the clear route or the model route is refused with 405", async () => {
  const context = {} as Context;
  const get = new Request("http://x/");
  expect((await clearRoute(context, {}, get)).status).toBe(405);
  expect((await modelRoute(context, {}, get)).status).toBe(405);
});

test("a crashed agent of one tab marks only that tab, and its next message starts a new agent", async () => {
  project.install({
    roles: {
      chat: {
        replies: [
          [{ stderr: "boom: agent failed" }, { crash: 1 }],
          [{ stderr: "boom: agent failed" }, { crash: 1 }],
          [
            {
              event: {
                type: "assistant",
                message: {
                  id: "m1",
                  content: [{ type: "text", text: "back" }],
                },
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
  const base = `http://127.0.0.1:${port}/api/projects/project`;
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  const token = /name="werk-token" content="([^"]+)"/.exec(html)?.[1] ?? "";
  const deadOf = async (tab: string) =>
    (
      (await (await fetch(`${base}/chat?tab=${tab}`)).json()) as {
        events: { name: string; data: { error: string | null } }[];
      }
    ).events.find((e) => e.name === "dead")?.data.error;
  await fetch(`${base}/chat`);
  const send = (tab: string, turn: string) =>
    fetch(`${base}/chat?tab=${tab}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-werk-token": token },
      body: JSON.stringify({ text: "hi", card: null, turn }),
    });
  expect((await send("A", "t1")).status).toBe(202);
  const error = await until(() => deadOf("A"));
  expect(error).toContain("boom: agent failed");
  expect(await deadOf("main")).toBeUndefined();
  const tabs = (await (await fetch(`${base}/tabs`)).json()) as {
    tabs: string[];
  };
  expect(tabs.tabs).toEqual(["main", "A"]);

  expect((await send("A", "t2")).status).toBe(202);
  await until(async () =>
    (await deadOf("A")) === undefined ? true : undefined,
  );
  expect(
    (
      (await (await fetch(`${base}/chat?tab=A`)).json()) as {
        events: { name: string }[];
      }
    ).events.some((e) => e.name === "turn-end"),
  ).toBe(true);
  expect((await fetch(`${base}/chat?tab=..%2Fx`)).status).toBe(400);
});

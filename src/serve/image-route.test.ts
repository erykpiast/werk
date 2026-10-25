import { afterEach, beforeEach, expect, test } from "bun:test";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../test-env/project.ts";

const CLI = join(import.meta.dir, "..", "cli.ts");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(async () => {
  await project.dispose();
});

async function until<T>(read: () => T | undefined): Promise<T> {
  const end = Date.now() + 10000;
  for (;;) {
    const value = (() => {
      try {
        return read();
      } catch {
        return undefined;
      }
    })();
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
  const api = `${origin}/api/projects/project`;
  const upload = (bytes: Uint8Array, headers: Record<string, string> = {}) =>
    fetch(`${api}/image`, {
      method: "POST",
      headers: { "x-werk-token": token, ...headers },
      body: bytes as unknown as BodyInit,
    });
  const send = (body: unknown) =>
    fetch(`${api}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-werk-token": token },
      body: JSON.stringify(body),
    });
  return { api, upload, send };
}

test("an upload is stored and answers with its name, and the name serves the image back", async () => {
  const { api, upload } = await serving();
  const res = await upload(PNG);
  expect(res.status).toBe(200);
  const { name } = (await res.json()) as { name: string };
  expect(readdirSync(join(project.dir, ".werk", "attachments"))).toContain(
    name,
  );
  const back = await fetch(`${api}/image?name=${name}`);
  expect(back.status).toBe(200);
  expect(back.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await back.arrayBuffer())).toEqual(PNG);
});

test("an upload that is no image, or over the cap, is refused with a reason and nothing is stored", async () => {
  const { upload } = await serving();
  const text = await upload(new TextEncoder().encode("hello"));
  expect(text.status).toBe(415);
  expect(((await text.json()) as { message: string }).message).toContain("PNG");
  const big = new Uint8Array(25 * 1024 * 1024);
  big.set(PNG);
  const over = await upload(big);
  expect(over.status).toBe(413);
  expect(((await over.json()) as { message: string }).message).toContain(
    "20 MB",
  );
  expect(() =>
    readdirSync(join(project.dir, ".werk", "attachments")),
  ).toThrow();
});

test("an empty or traversing name answers 404 and the server stays up", async () => {
  const { api, upload } = await serving();
  for (const query of [
    "name=",
    "",
    "name=.",
    "name=..",
    "name=..%2Flog.jsonl",
    "name=%2Fetc%2Fpasswd",
  ]) {
    expect((await fetch(`${api}/image?${query}`)).status).toBe(404);
  }
  expect((await upload(PNG)).status).toBe(200);
});

test("a send names its images, and the agent's turn carries their paths and not their bytes", async () => {
  const { send, upload } = await serving();
  const { name } = (await (await upload(PNG)).json()) as { name: string };
  const res = await send({
    text: "Why is [Image #1] red?",
    card: null,
    turn: "t1",
    images: [name],
  });
  expect(res.status).toBe(202);
  const path = join(realpathSync(project.dir), ".werk", "attachments", name);
  const text = await until(() => {
    const m = project.launches().find((r) => r.kind === "message");
    return m && "text" in m ? m.text : undefined;
  });
  expect(text).toContain(`[Image #1] = ${path}`);
  expect(text).toContain("Open each image above with Read before you answer.");
  expect(text).toMatch(/Why is \[Image #1\] red\?$/);
});

test("a send that names a file outside the attachments folder is refused whole", async () => {
  const { send } = await serving();
  for (const images of [["../log.jsonl"], ["nope.png"], [5], "x"]) {
    expect(
      (await send({ text: "hi", card: null, turn: "t9", images })).status,
    ).toBe(400);
  }
  expect(project.launches()).toEqual([]);
});

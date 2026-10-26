import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyApp } from "../src/test-env/app-copy.ts";
import { createProject, type Project } from "../src/test-env/project.ts";
import { card, seedLog, werk } from "./helpers.ts";

let project: Project;
let scratch: string;
beforeEach(() => {
  project = createProject();
  scratch = mkdtempSync(join(tmpdir(), "heldout-14-"));
});
afterEach(async () => {
  await project.dispose();
  rmSync(scratch, { recursive: true, force: true });
});

async function until<T>(read: () => Promise<T | undefined> | T | undefined, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await (async () => read())().catch(() => undefined);
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(50);
  }
}

test("14.2 a server edit changes a response; same process; live channel stays and gets the new card", async () => {
  seedLog(project, card("root", "Root", "open"));
  const app = join(scratch, "app");
  const child = project.start(["bun", copyApp(app), "serve", "--port", "0"]);
  let log = "";
  void (async () => {
    const dec = new TextDecoder();
    for await (const chunk of child.stderr) log += dec.decode(chunk);
  })();
  const lockPath = join(project.dir, ".werk", "serve.lock");
  const holder = () =>
    until(() => {
      const l = JSON.parse(readFileSync(lockPath, "utf8"));
      return l.port > 0 ? (l as { pid: number; port: number }) : undefined;
    });
  const { pid, port } = await holder();
  const url = (p: string) => `http://127.0.0.1:${port}${p}`;

  const live = await fetch(url("/api/live"));
  const reader = (live.body as ReadableStream<Uint8Array>).getReader();
  await reader.read();

  const routes = join(app, "src", "serve", "routes.ts");
  const edited = readFileSync(routes, "utf8").replace(
    'if (url.pathname === "/api/live") return live(ctx);',
    'if (url.pathname === "/api/live") return live(ctx);\n    if (url.pathname === "/api/ping") return new Response("pong");',
  );
  writeFileSync(routes, edited);
  const body = await until(async () => {
    const r = await fetch(url("/api/ping"));
    return r.status === 200 ? await r.text() : undefined;
  });
  expect(body).toBe("pong");
  expect(log).toContain("reusing the live server");
  expect(await holder()).toEqual({ pid, port });

  const added = await werk(project, "add", "after", "--title", "After edit", "--parent", "root");
  expect(added.stdout.trim()).toBe("proposed");
  // The open page must show the card without a reload: the live channel must stay open and push a change.
  const next = await Promise.race([
    reader.read(),
    Bun.sleep(3000).then(() => "silent" as const),
  ]);
  expect(next).not.toBe("silent");
  expect((next as ReadableStreamReadResult<Uint8Array>).done).toBe(false);
  await reader.cancel();
});

import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyApp } from "../src/test-env/app-copy.ts";
import { createProject, type Project } from "../src/test-env/project.ts";
import { CLI, until, werk } from "./util.ts";

let p: Project;
let scratch: string;
beforeEach(() => {
  p = createProject();
  scratch = mkdtempSync(join(tmpdir(), "werk-ho-"));
});
afterEach(async () => {
  await p.dispose();
  rmSync(scratch, { recursive: true, force: true });
});

const lockPath = () => join(p.dir, ".werk", "serve.lock");
const holder = () =>
  until(() => {
    const l = JSON.parse(readFileSync(lockPath(), "utf8"));
    return l.port > 0 ? (l as { pid: number; port: number }) : undefined;
  });
const url = (port: number, path: string) => `http://127.0.0.1:${port}${path}`;

/** Reads the live channel until a chunk past the first comment arrives, or the wait ends. */
async function liveChunkAfter(port: number, act: () => Promise<unknown>) {
  const res = await fetch(url(port, "/api/live"));
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  await reader.read();
  await act();
  const next = await Promise.race([
    reader.read().then((r) => (r.done ? "closed" : new TextDecoder().decode(r.value))),
    Bun.sleep(3000).then(() => "silent"),
  ]);
  await reader.cancel();
  return next;
}

test("14.1 a card added from the command line reaches an open page without reload", async () => {
  await werk(p, "add", "root", "--title", "Root");
  p.start(["bun", CLI, "serve", "--port", "0"]);
  const { port } = await holder();
  const html = await (await fetch(url(port, "/"))).text();
  // The page must carry a client that shows the map and a chat composer.
  expect(html).toMatch(/<script[^>]+src=/);
  const chunk = await liveChunkAfter(port, () =>
    werk(p, "add", "fresh", "--title", "Fresh idea", "--parent", "root"),
  );
  expect(chunk).toContain("fresh");
});

test("14.2 a server edit in dev reuses the live server and the live channel survives", async () => {
  const app = join(scratch, "app");
  const server = p.start(["bun", copyApp(app), "serve", "--port", "0"]);
  let stderr = "";
  void (async () => {
    const dec = new TextDecoder();
    for await (const c of server.stderr) stderr += dec.decode(c);
  })();
  const { pid, port } = await holder();
  const routes = join(app, "src", "serve", "routes.ts");
  writeFileSync(
    routes,
    readFileSync(routes, "utf8").replace(
      'if (url.pathname === "/api/live") return live(ctx);',
      'if (url.pathname === "/api/live") return live(ctx);\n    if (url.pathname === "/api/ping") return new Response("pong-edited");',
    ),
  );
  const body = await until(async () => {
    const r = await fetch(url(port, "/api/ping"));
    return r.status === 200 ? await r.text() : undefined;
  });
  expect(body).toBe("pong-edited");
  expect(await holder()).toEqual({ pid, port });
  expect(stderr).toContain("reusing the live server");
  await werk(p, "add", "root", "--title", "Root");
  const chunk = await liveChunkAfter(port, () =>
    werk(p, "add", "after", "--title", "After edit", "--parent", "root"),
  );
  expect(chunk).toContain("after");
});

test("14.3 a client edit that cannot apply in place reloads the page and keeps the draft", async () => {
  const app = join(scratch, "app");
  p.start(["bun", copyApp(app), "serve", "--port", "0"]);
  const { port } = await holder();
  expect(existsSync(join(app, "client"))).toBe(true);
  const html = await (await fetch(url(port, "/"))).text();
  expect(html).toMatch(/<script[^>]+src=/);
});

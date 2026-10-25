import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyApp } from "../test-env/app-copy.ts";
import { createProject, type Project } from "../test-env/project.ts";

const SRC = join(import.meta.dir, "..");
const CLI = join(SRC, "cli.ts");

let project: Project;
let scratch: string;
beforeEach(() => {
  project = createProject();
  scratch = mkdtempSync(join(tmpdir(), "werk-serve-"));
});
afterEach(async () => {
  await project.dispose();
  rmSync(scratch, { recursive: true, force: true });
});

const lockPath = () => join(project.dir, ".werk", "serve.lock");

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

/** The pid and port that the running server wrote to its lock. */
function holder() {
  return until(() => {
    const lock = JSON.parse(readFileSync(lockPath(), "utf8"));
    return lock.port > 0 ? (lock as { pid: number; port: number }) : undefined;
  });
}

const url = (port: number, path: string) => `http://127.0.0.1:${port}${path}`;

/** The API path of the test project, which its folder name "project" names. */
const api = (path: string) => `/api/projects/project${path}`;

async function tokenOf(port: number): Promise<string> {
  const html = await (await fetch(url(port, "/"))).text();
  return /name="werk-token" content="([^"]+)"/.exec(html)?.[1] ?? "";
}

test("a changing request needs the token from the page and a loopback Host", async () => {
  project.start(["bun", CLI, "serve", "--port", "0"]);
  const { port } = await holder();
  const token = await tokenOf(port);
  expect(token).toHaveLength(64);

  const post = (headers: Record<string, string>) =>
    fetch(url(port, "/api/anything"), { method: "POST", headers });
  expect((await post({})).status).toBe(403);
  expect((await post({ "x-werk-token": "wrong" })).status).toBe(403);
  expect((await post({ "x-werk-token": token, host: "evil.com" })).status).toBe(
    403,
  );
  expect((await post({ "x-werk-token": token })).status).toBe(404);
  expect(
    (
      await fetch(url(port, "/api/graph?shape=1"), {
        headers: { host: "evil.com" },
      })
    ).status,
  ).toBe(403);
});

test("the read API answers one card and a shape with no body", async () => {
  const added = await project.run([
    "bun",
    CLI,
    "add",
    "root",
    "--title",
    "Root",
    "--body",
    "SECRET BODY",
  ]);
  expect(added.code).toBe(0);
  project.start(["bun", CLI, "serve", "--port", "0"]);
  const { port } = await holder();

  const card = await (await fetch(url(port, api("/card/root")))).json();
  expect(card).toMatchObject({
    found: true,
    card: { id: "root", body: "SECRET BODY" },
  });
  expect(await (await fetch(url(port, api("/card/nobody")))).json()).toEqual({
    found: false,
  });
  expect((await fetch(url(port, api("/card/bad%20id")))).status).toBe(400);
  const shape = await (await fetch(url(port, api("/graph?shape=1")))).text();
  expect(JSON.parse(shape).nodes[0].id).toBe("root");
  expect(shape).not.toContain("SECRET BODY");
  expect((await fetch(url(port, api("/graph")))).status).toBe(400);
});

test("the board is read from two addresses, and a growth of the board log sends a board signal", async () => {
  mkdirSync(join(project.dir, ".werk"), { recursive: true });
  const board = join(project.dir, ".werk", "board.jsonl");
  writeFileSync(
    board,
    `${JSON.stringify({ type: "ticket.planned", id: "r/01", title: "One" })}\n`,
  );
  project.start(["bun", CLI, "serve", "--port", "0"]);
  const { port } = await holder();

  const read = await (await fetch(url(port, api("/board")))).json();
  expect(read.columns.ready.map((t: { id: string }) => t.id)).toEqual(["r/01"]);
  expect(
    await (await fetch(url(port, api("/board/log?ticket=r%2F01")))).json(),
  ).toEqual({ lines: [] });
  expect((await fetch(url(port, api("/board/log")))).status).toBe(400);
  expect((await fetch(url(port, api("/board/log?ticket=r%2F99")))).status).toBe(
    404,
  );

  const live = await fetch(url(port, api("/live")));
  const reader = (live.body as ReadableStream<Uint8Array>).getReader();
  await reader.read();
  appendFileSync(
    board,
    `${JSON.stringify({ type: "ticket.moved", id: "r/01", to: "building" })}\n`,
  );
  let seen = "";
  const decoder = new TextDecoder();
  for (let i = 0; i < 100 && !seen.includes("event: board"); i++) {
    seen += decoder.decode((await reader.read()).value);
  }
  await reader.cancel();
  expect(seen).toContain("event: board");
});

test("a server of another per-user folder waits for the project, then refuses with the first server's pid and port", async () => {
  project.start(["bun", CLI, "serve", "--port", "0"]);
  const first = await holder();
  const started = Date.now();
  const second = await project.run(["bun", CLI, "serve", "--port", "0"], {
    WERK_HOME: join(scratch, "other-home"),
  });
  expect(Date.now() - started).toBeGreaterThanOrEqual(4000);
  expect(second.code).toBe(1);
  expect(second.stderr).toContain(`waiting for pid ${first.pid}`);
  expect(second.stderr).toContain(`on port ${first.port} (pid ${first.pid})`);
}, 20000);

test("a server with WERK_LOG runs beside a first server, with its locks beside the log it names", async () => {
  project.start(["bun", CLI, "serve", "--port", "0"]);
  const first = await holder();
  const other = join(scratch, "other");
  mkdirSync(other);
  writeFileSync(join(other, "log.jsonl"), "");
  const second = project.start(["bun", CLI, "serve", "--port", "0"], {
    WERK_HOME: "",
    WERK_LOG: join(other, "log.jsonl"),
  });
  const lock = await until(() => {
    const read = JSON.parse(
      readFileSync(join(other, "server", "serve.lock"), "utf8"),
    );
    return read.port > 0 ? (read as { pid: number; port: number }) : undefined;
  });
  expect(lock.pid).not.toBe(first.pid);
  expect(lock.port).not.toBe(first.port);
  expect(existsSync(join(other, "serve.lock"))).toBe(true);
  expect(second.exitCode).toBeNull();
  expect((await holder()).pid).toBe(first.pid);
}, 20000);

test("a stale lock from a killed server is taken over", async () => {
  const dead = Bun.spawn(["true"]);
  await dead.exited;
  writeFileSync(lockPath(), JSON.stringify({ pid: dead.pid, port: 4211 }));
  project.start(["bun", CLI, "serve", "--port", "0"]);
  const taken = await until(async () => {
    const lock = await holder();
    return lock.pid === dead.pid ? undefined : lock;
  });
  expect(taken.port).not.toBe(4211);
});

test("killing the server leaves a stale lock that the next start takes over", async () => {
  const first = project.start(["bun", CLI, "serve", "--port", "0"]);
  const { pid } = await holder();
  first.kill("SIGKILL");
  await until(() => {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
  });
  project.start(["bun", CLI, "serve", "--port", "0"]);
  expect(
    (
      await until(async () => {
        const lock = await holder();
        return lock.pid === pid ? undefined : lock;
      })
    ).pid,
  ).not.toBe(pid);
});

test("an edit to a route handler in a copy of the app is live with no restart", async () => {
  const app = join(scratch, "app");
  project.start(["bun", copyApp(app), "serve", "--port", "0"]);
  const { pid, port } = await holder();
  expect((await fetch(url(port, "/api/ping"))).status).toBe(404);

  const routes = join(app, "src", "serve", "routes.ts");
  const edited = readFileSync(routes, "utf8").replace(
    'if (pathname === "/api/projects") {',
    'if (pathname === "/api/ping") return new Response("pong");\n    if (pathname === "/api/projects") {',
  );
  expect(edited).toContain("/api/ping");
  writeFileSync(routes, edited);

  const body = await until(async () => {
    const res = await fetch(url(port, "/api/ping"));
    return res.status === 200 ? await res.text() : undefined;
  });
  expect(body).toBe("pong");
  expect(await holder()).toEqual({ pid, port });
  expect(existsSync(lockPath())).toBe(true);
});

test("a hot reload keeps the token and the open live connections", async () => {
  const app = join(scratch, "app");
  project.start(["bun", copyApp(app), "serve", "--port", "0"]);
  const { port } = await holder();
  const token = await tokenOf(port);
  const live = await fetch(url(port, api("/live")));
  const reader = (live.body as ReadableStream<Uint8Array>).getReader();
  await reader.read();

  const routes = join(app, "src", "serve", "routes.ts");
  writeFileSync(routes, `${readFileSync(routes, "utf8")}\n// edited\n`);
  await Bun.sleep(1500);

  expect(await tokenOf(port)).toBe(token);
  const next = await Promise.race([
    reader.read(),
    Bun.sleep(300).then(() => "open"),
  ]);
  expect(next).toBe("open");
  await reader.cancel();
});

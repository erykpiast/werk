/**
 * A real werk server for the held-out browser specs. It follows e2e/support/server.ts, and adds
 * a map log chosen by the spec, the server's output, and the board log. The fake agent is first
 * in the program search list.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { logPathFor, readRecords } from "../../src/fake-agent/launch-log.ts";
import type { Script } from "../../src/fake-agent/script.ts";
import { copyApp } from "../../src/test-env/app-copy.ts";
import { cleanEnv, fakeIsFirst } from "../../src/test-env/env.ts";

const CHECKOUT = resolve(import.meta.dirname, "..", "..");

export type Options = {
  /** The events of the map log. */
  events?: unknown[];
  /** The events of the board log. */
  board?: unknown[];
  appCopy?: boolean;
  script?: Script;
  env?: Record<string, string>;
};

const lines = (events: unknown[]) =>
  events.map((e) => `${JSON.stringify(e)}\n`).join("");

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });
}

async function until(check: () => Promise<boolean>, what: string, ms = 30000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function startServer(options: Options = {}) {
  const base = {
    ...cleanEnv(process.env),
    WERK_OPEN: "true",
    ...options.env,
  };
  if (!fakeIsFirst(base.PATH)) throw new Error("fake agent is not first");
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-e2e-"));
  const scriptPath = join(root, "script.json");
  if (options.script) writeFileSync(scriptPath, JSON.stringify(options.script));
  const env = options.script ? { ...base, WERK_FAKE_SCRIPT: scriptPath } : base;
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  if (options.events)
    writeFileSync(join(dir, ".werk", "log.jsonl"), lines(options.events));
  if (options.board)
    writeFileSync(join(dir, ".werk", "board.jsonl"), lines(options.board));
  const init = spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  const home = join(root, "home");
  const appDir = options.appCopy ? join(root, "app") : CHECKOUT;
  const cli = options.appCopy ? copyApp(appDir) : join(CHECKOUT, "src", "cli.ts");
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const url = `${origin}/p/${basename(dir)}`;
  let child: ChildProcess | undefined;
  let output = "";
  const stop = async () => {
    const running = child;
    child = undefined;
    if (!running || running.exitCode !== null) return;
    const exited = new Promise((done) => running.once("exit", done));
    running.kill("SIGTERM");
    await exited;
  };
  return {
    url,
    origin,
    port,
    home,
    dir,
    appDir,
    cli,
    env,
    output: () => output,
    pid: () => child?.pid,
    alive: () => child !== undefined && child.exitCode === null,
    async start() {
      const running = spawn("bun", [cli, "serve", "--port", String(port)], {
        cwd: dir,
        env: { ...env, WERK_DEV: "1", WERK_HOME: home },
      });
      child = running;
      for (const stream of [running.stdout, running.stderr]) {
        stream?.on("data", (chunk) => {
          output += String(chunk);
        });
      }
      await until(async () => {
        if (running.exitCode !== null)
          throw new Error(`the server exited early:\n${output}`);
        const res = await fetch(`${origin}/api/projects`).catch(() => null);
        return res?.ok === true;
      }, "the server to answer");
    },
    stop,
    launches: () => readRecords(logPathFor(scriptPath)),
    werk(...args: string[]) {
      const r = spawnSync("bun", [cli, ...args], {
        cwd: dir,
        env: { ...env, WERK_HOME: home },
        encoding: "utf8",
      });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    },
    async dispose() {
      await stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
export type Server = Awaited<ReturnType<typeof startServer>>;

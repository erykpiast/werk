/**
 * A real werk server on a copy of a fixture project, for the browser tests (#werk-test-visual).
 * The fake agent is first in the program search list, and the harness refuses to start a server
 * when it is not, so no spec reaches a real agent (#werk-test-env).
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { copyApp } from "../../src/test-env/app-copy.ts";
import { cleanEnv, fakeIsFirst } from "../../src/test-env/env.ts";

const CHECKOUT = resolve(import.meta.dirname, "..", "..");
const FIXTURE = join(import.meta.dirname, "..", "fixtures", "project");

export type ServerOptions = {
  /** Added to the cleaned environment. A PATH here must still put the fake agent first. */
  env?: Record<string, string>;
  /** Run the server from a copy of the app, so a spec can edit the client source. */
  appCopy?: boolean;
};

export type BrowserServer = {
  url: string;
  /** The project directory: a copy of the fixture. */
  dir: string;
  /** The root of the app that runs: the checkout, or its copy. */
  appDir: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Runs one werk command on the project and returns its output. */
  werk(...args: string[]): { code: number; stdout: string; stderr: string };
  dispose(): Promise<void>;
};

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolvePort(port));
    });
  });
}

async function until(check: () => Promise<boolean>, what: string, ms = 30000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end)
      throw new Error(`werk: timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function startBrowserServer(
  options: ServerOptions = {},
): Promise<BrowserServer> {
  const env = { ...cleanEnv(process.env), ...options.env };
  if (!fakeIsFirst(env.PATH)) {
    throw new Error(
      "werk: the fake agent is not first in the program search list; the browser server does not start",
    );
  }
  const root = mkdtempSync(join(tmpdir(), "werk-e2e-"));
  const dir = join(root, "project");
  cpSync(FIXTURE, dir, { recursive: true });
  const appDir = options.appCopy ? join(root, "app") : CHECKOUT;
  const cli = options.appCopy
    ? copyApp(appDir)
    : join(CHECKOUT, "src", "cli.ts");
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
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
    dir,
    appDir,
    async start() {
      const running = spawn("bun", [cli, "serve", "--port", String(port)], {
        cwd: dir,
        env: { ...env, WERK_DEV: "1" },
      });
      child = running;
      for (const stream of [running.stdout, running.stderr]) {
        stream?.on("data", (chunk) => {
          output += String(chunk);
        });
      }
      await until(async () => {
        if (running.exitCode !== null) {
          throw new Error(`werk: the server exited early:\n${output}`);
        }
        const res = await fetch(`${url}/api/graph?shape=1`).catch(() => null);
        return res?.ok === true;
      }, "the server to answer");
    },
    stop,
    werk(...args) {
      const result = spawnSync("bun", [cli, ...args], {
        cwd: dir,
        env,
        encoding: "utf8",
      });
      return {
        code: result.status ?? 1,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
    async dispose() {
      await stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

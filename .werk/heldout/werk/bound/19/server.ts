/** A werk server for the held-out browser tests: the checkout, a copy of the app, or a release executable. */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { logPathFor, readRecords } from "../src/fake-agent/launch-log.ts";
import type { Script } from "../src/fake-agent/script.ts";
import { copyApp } from "../src/test-env/app-copy.ts";
import { cleanEnv } from "../src/test-env/env.ts";

const CHECKOUT = resolve(import.meta.dirname, "..");
const FIXTURE = join(CHECKOUT, "e2e", "fixtures", "project");

export type Options = {
  appCopy?: boolean;
  script?: Script;
  env?: Record<string, string>;
  /** An executable that replaces `bun src/cli.ts`. */
  exe?: string;
  /** Where to run the server, for an executable in an empty folder. Default: the project copy. */
  cwd?: string;
  /** Skip the fixture and start from an empty git repository. */
  empty?: boolean;
};

export type Server = Awaited<ReturnType<typeof startServer>>;

const freePort = () =>
  new Promise<number>((res, rej) => {
    const probe = createServer();
    probe.once("error", rej);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => res(port));
    });
  });

export async function startServer(options: Options = {}) {
  const base = { ...cleanEnv(process.env), WERK_OPEN: "true", ...options.env };
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-srv-")));
  const scriptPath = join(root, "script.json");
  if (options.script) writeFileSync(scriptPath, JSON.stringify(options.script));
  const env: Record<string, string> = options.script ? { ...base, WERK_FAKE_SCRIPT: scriptPath } : base;
  const dir = join(root, "project");
  if (options.empty) {
    mkdirSync(dir);
    mkdirSync(join(dir, ".werk"));
  } else cpSync(FIXTURE, dir, { recursive: true });
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  const home = join(root, "home");
  const appDir = options.appCopy ? join(root, "app") : CHECKOUT;
  const cmd: string[] = options.exe
    ? [options.exe]
    : ["bun", options.appCopy ? copyApp(appDir) : join(CHECKOUT, "src", "cli.ts")];
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const url = `${origin}/p/${basename(dir)}`;
  let child: ChildProcess | undefined;
  let output = "";
  const runDir = options.cwd ?? dir;

  const stop = async () => {
    const running = child;
    child = undefined;
    if (!running || running.exitCode !== null) return;
    const exited = new Promise((done) => running.once("exit", done));
    running.kill("SIGTERM");
    await exited;
  };
  const api = {
    url,
    origin,
    dir,
    root,
    home,
    appDir,
    port,
    output: () => output,
    launches: () => readRecords(logPathFor(scriptPath)),
    messages: () => api.launches().flatMap((r) => (r.kind === "message" ? [r.text] : [])),
    werk(...args: string[]) {
      const [exe, ...rest] = cmd;
      const r = spawnSync(exe as string, [...rest, ...args], { cwd: dir, env, encoding: "utf8" });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    },
    /** Appends raw events to the project's map log. */
    append(...events: unknown[]) {
      appendFileSync(join(dir, ".werk", "log.jsonl"), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
    },
    async start() {
      const [exe, ...rest] = cmd;
      const running = spawn(exe as string, [...rest, "serve", "--port", String(port)], {
        cwd: runDir,
        env: { ...env, ...(options.exe ? {} : { WERK_DEV: "1" }), WERK_HOME: home },
      });
      child = running;
      for (const s of [running.stdout, running.stderr]) s?.on("data", (c) => { output += String(c); });
      const end = Date.now() + 40000;
      for (;;) {
        if (running.exitCode !== null) throw new Error(`the server exited early:\n${output}`);
        const ok = await fetch(`${origin}/api/projects`).then((r) => r.ok).catch(() => false);
        if (ok) return;
        if (Date.now() > end) throw new Error(`timed out waiting for the server:\n${output}`);
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    stop,
    async restart() {
      await stop();
      await api.start();
    },
    async dispose() {
      await stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
  return api;
}

export async function served(options: Options = {}) {
  const s = await startServer(options);
  await s.start();
  return s;
}

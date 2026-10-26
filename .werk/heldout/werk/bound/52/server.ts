/** A werk server on a copy of the fixture project, for the held-out browser tests. It keeps the server's output. */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { logPathFor, readRecords } from "../src/fake-agent/launch-log.ts";
import type { Script } from "../src/fake-agent/script.ts";
import { copyApp } from "../src/test-env/app-copy.ts";
import { cleanEnv, fakeIsFirst } from "../src/test-env/env.ts";

const CHECKOUT = resolve(import.meta.dirname, "..");
const FIXTURE = join(CHECKOUT, "e2e", "fixtures", "project");

export type Opts = { env?: Record<string, string>; appCopy?: boolean; script?: Script };

function freePort(): Promise<number> {
  return new Promise((ok, bad) => {
    const probe = createServer();
    probe.once("error", bad);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => ok(port));
    });
  });
}

export type Srv = Awaited<ReturnType<typeof startServer>>;

export async function startServer(opts: Opts = {}) {
  const base = { ...cleanEnv(process.env), WERK_OPEN: "true", ...opts.env };
  if (!fakeIsFirst(base.PATH)) throw new Error("fake agent not first");
  const root = mkdtempSync(join(tmpdir(), "werk-held-"));
  const scriptPath = join(root, "script.json");
  if (opts.script) writeFileSync(scriptPath, JSON.stringify(opts.script));
  const env = opts.script ? { ...base, WERK_FAKE_SCRIPT: scriptPath } : base;
  const dir = join(root, "project");
  cpSync(FIXTURE, dir, { recursive: true });
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  const home = join(root, "home");
  const appDir = opts.appCopy ? join(root, "app") : CHECKOUT;
  const cli = opts.appCopy ? copyApp(appDir) : join(CHECKOUT, "src", "cli.ts");
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
    url, origin, home, dir, appDir, port, root,
    output: () => output,
    logPath: join(dir, ".werk", "log.jsonl"),
    boardPath: join(dir, ".werk", "board.jsonl"),
    appendLog(...events: unknown[]) {
      appendFileSync(join(dir, ".werk", "log.jsonl"), events.flat(Infinity).map((e) => `${JSON.stringify(e)}\n`).join(""));
    },
    appendBoard(...events: unknown[]) {
      appendFileSync(join(dir, ".werk", "board.jsonl"), events.flat(Infinity).map((e) => `${JSON.stringify(e)}\n`).join(""));
    },
    async start() {
      const running = spawn("bun", [cli, "serve", "--port", String(port)], {
        cwd: dir, env: { ...env, WERK_DEV: "1", WERK_HOME: home },
      });
      child = running;
      for (const s of [running.stdout, running.stderr]) s?.on("data", (c) => { output += String(c); });
      const end = Date.now() + 30000;
      for (;;) {
        if (running.exitCode !== null) throw new Error(`server exited early:\n${output}`);
        const res = await fetch(`${origin}/api/projects`).catch(() => null);
        if (res?.ok) return;
        if (Date.now() > end) throw new Error("timed out waiting for the server");
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    stop,
    launches: () => readRecords(logPathFor(scriptPath)),
    werk(...args: string[]) {
      const r = spawnSync("bun", [cli, ...args], { cwd: dir, env, encoding: "utf8" });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    },
    async dispose() {
      await stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

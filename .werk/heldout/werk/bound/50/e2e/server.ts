/** A real werk server on a copy of the fixture project, with its output and process id exposed. */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { logPathFor, readRecords } from "../../src/fake-agent/launch-log.ts";
import type { Script } from "../../src/fake-agent/script.ts";
import { copyApp } from "../../src/test-env/app-copy.ts";
import { cleanEnv } from "../../src/test-env/env.ts";

const CHECKOUT = resolve(import.meta.dirname, "..", "..");
const FIXTURE = join(CHECKOUT, "e2e", "fixtures", "project");

export type Server = Awaited<ReturnType<typeof startServer>>;

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => ok(port));
    });
  });
}

export async function startServer(
  options: { appCopy?: boolean; script?: Script; env?: Record<string, string> } = {},
) {
  const base = { ...cleanEnv(process.env), WERK_OPEN: "true", ...options.env };
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-"));
  const scriptPath = join(root, "script.json");
  if (options.script) writeFileSync(scriptPath, JSON.stringify(options.script));
  const env = options.script ? { ...base, WERK_FAKE_SCRIPT: scriptPath } : base;
  const dir = join(root, "project");
  cpSync(FIXTURE, dir, { recursive: true });
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  const home = join(root, "home");
  const appDir = options.appCopy ? join(root, "app") : CHECKOUT;
  const cli = options.appCopy ? copyApp(appDir) : join(CHECKOUT, "src", "cli.ts");
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const url = `${origin}/p/${basename(dir)}`;
  let child: ChildProcess | undefined;
  let output = "";

  const server = {
    url,
    origin,
    port,
    dir,
    appDir,
    output: () => output,
    pid: () => child?.pid,
    launches: () => readRecords(logPathFor(scriptPath)),
    werk(...args: string[]) {
      const r = spawnSync("bun", [cli, ...args], { cwd: dir, env, encoding: "utf8" });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    },
    async start() {
      const running = spawn("bun", [cli, "serve", "--port", String(port)], {
        cwd: dir,
        env: { ...env, WERK_DEV: "1", WERK_HOME: home },
      });
      child = running;
      for (const s of [running.stdout, running.stderr])
        s?.on("data", (c) => {
          output += String(c);
        });
      const end = Date.now() + 40000;
      for (;;) {
        if (running.exitCode !== null) throw new Error(`server exited:\n${output}`);
        const res = await fetch(`${origin}/api/projects`).catch(() => null);
        if (res?.ok) return;
        if (Date.now() > end) throw new Error(`server did not answer:\n${output}`);
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    async stop() {
      const running = child;
      child = undefined;
      if (!running || running.exitCode !== null) return;
      const exited = new Promise((done) => running.once("exit", done));
      running.kill("SIGTERM");
      await exited;
    },
    async dispose() {
      await server.stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
  return server;
}

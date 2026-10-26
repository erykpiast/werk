/** A werk server on a copy of the fixture project that also keeps its own output. */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { Script } from "../src/fake-agent/script.ts";
import { logPathFor, readRecords } from "../src/fake-agent/launch-log.ts";
import { copyApp } from "../src/test-env/app-copy.ts";
import { cleanEnv } from "../src/test-env/env.ts";
import { writeFileSync } from "node:fs";

const CHECKOUT = resolve(import.meta.dirname, "..");
const FIXTURE = join(CHECKOUT, "e2e", "fixtures", "project");

const freePort = () =>
  new Promise<number>((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => res(port));
    });
  });

export type App = Awaited<ReturnType<typeof startApp>>;

export async function startApp(
  options: { appCopy?: boolean; script?: Script; env?: Record<string, string> } = {},
) {
  const env0: Record<string, string> = {
    ...cleanEnv(process.env),
    WERK_OPEN: "true",
    ...options.env,
  };
  const root = mkdtempSync(join(tmpdir(), "werk-ho-"));
  const scriptPath = join(root, "script.json");
  if (options.script) {
    writeFileSync(scriptPath, JSON.stringify(options.script));
    env0.WERK_FAKE_SCRIPT = scriptPath;
  }
  const dir = join(root, "project");
  cpSync(FIXTURE, dir, { recursive: true });
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env: env0 });
  const home = join(root, "home");
  const appDir = options.appCopy ? join(root, "app") : CHECKOUT;
  const cli = options.appCopy ? copyApp(appDir) : join(CHECKOUT, "src", "cli.ts");
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const name = basename(dir);
  let child: ChildProcess | undefined;
  let output = "";
  const stop = async () => {
    const c = child;
    child = undefined;
    if (!c || c.exitCode !== null) return;
    const done = new Promise((r) => c.once("exit", r));
    c.kill("SIGTERM");
    await done;
  };
  const self = {
    origin,
    url: `${origin}/p/${name}`,
    name,
    dir,
    appDir,
    port,
    get pid() {
      return child?.pid;
    },
    output: () => output,
    exited: () => child?.exitCode !== null,
    async start() {
      const c = spawn("bun", [cli, "serve", "--port", String(port)], {
        cwd: dir,
        env: { ...env0, WERK_DEV: "1", WERK_HOME: home },
      });
      child = c;
      for (const s of [c.stdout, c.stderr]) s?.on("data", (d) => (output += String(d)));
      const end = Date.now() + 40000;
      for (;;) {
        if (c.exitCode !== null) throw new Error(`server exited early:\n${output}`);
        const r = await fetch(`${origin}/api/projects`).catch(() => null);
        if (r?.ok) break;
        if (Date.now() > end) throw new Error("server did not answer");
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    stop,
    werk(...args: string[]) {
      const r = spawnSync("bun", [cli, ...args], { cwd: dir, env: env0, encoding: "utf8" });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    },
    /** Appends raw events to the map log of the project. */
    log(...events: unknown[]) {
      appendFileSync(
        join(dir, ".werk", "log.jsonl"),
        events.map((e) => `${JSON.stringify(e)}\n`).join(""),
      );
    },
    launches: () => readRecords(logPathFor(scriptPath)),
    async dispose() {
      await stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
  return self;
}

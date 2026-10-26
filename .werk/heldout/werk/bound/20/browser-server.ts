// A real werk server on a copy of the fixture project. Like e2e/support/server.ts, and it keeps the server's output.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { copyApp } from "../src/test-env/app-copy.ts";
import { cleanEnv, fakeIsFirst } from "../src/test-env/env.ts";

const CHECKOUT = resolve(import.meta.dirname, "..");
const FIXTURE = join(CHECKOUT, "e2e", "fixtures", "project");

export type Served = {
  url: string;
  origin: string;
  port: number;
  dir: string;
  appDir: string;
  output: () => string;
  werk(...args: string[]): { code: number; stdout: string; stderr: string };
  pids(): string[];
  dispose(): Promise<void>;
};

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

export async function startServed(options: { appCopy?: boolean } = {}): Promise<Served> {
  const env = { ...cleanEnv(process.env), WERK_OPEN: "true" };
  if (!fakeIsFirst(env.PATH)) throw new Error("binder: the fake agent is not first");
  const root = mkdtempSync(join(tmpdir(), "werk-ho-e2e-"));
  const dir = join(root, "project");
  cpSync(FIXTURE, dir, { recursive: true });
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  const home = join(root, "home");
  const appDir = options.appCopy ? join(root, "app") : CHECKOUT;
  const cli = options.appCopy ? copyApp(appDir) : join(CHECKOUT, "src", "cli.ts");
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let output = "";
  const child: ChildProcess = spawn("bun", [cli, "serve", "--port", String(port)], {
    cwd: dir,
    env: { ...env, WERK_DEV: "1", WERK_HOME: home },
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk) => {
      output += String(chunk);
    });
  }
  const end = Date.now() + 40000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the server exited early:\n${output}`);
    const res = await fetch(`${origin}/api/projects`).catch(() => null);
    if (res?.ok) break;
    if (Date.now() > end) throw new Error(`the server did not answer:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url: `${origin}/p/${basename(dir)}`,
    origin,
    port,
    dir,
    appDir,
    output: () => output,
    werk(...args) {
      const r = spawnSync("bun", [cli, ...args], { cwd: dir, env, encoding: "utf8" });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    },
    pids() {
      const r = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
      return r.stdout.split("\n").filter(Boolean);
    },
    async dispose() {
      if (child.exitCode === null) {
        const exited = new Promise((done) => child.once("exit", done));
        child.kill("SIGTERM");
        await exited;
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

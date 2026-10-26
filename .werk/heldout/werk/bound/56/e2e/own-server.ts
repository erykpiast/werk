/** A server on a copy of the app that keeps its output and process, so a spec can read the hot reload line. */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { copyApp } from "../../src/test-env/app-copy.ts";
import { cleanEnv } from "../../src/test-env/env.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "e2e", "fixtures", "project");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

export async function startCopyServer() {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-"));
  const dir = join(root, "project");
  cpSync(FIXTURE, dir, { recursive: true });
  const env = { ...cleanEnv(process.env), WERK_OPEN: "true", WERK_DEV: "1", WERK_HOME: join(root, "home") };
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  const appDir = join(root, "app");
  const cli = copyApp(appDir);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let output = "";
  const child: ChildProcess = spawn("bun", [cli, "serve", "--port", String(port)], { cwd: dir, env });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { output += String(c); });
  const end = Date.now() + 40000;
  for (;;) {
    const res = await fetch(`${origin}/api/projects`).catch(() => null);
    if (res?.ok) break;
    if (Date.now() > end) throw new Error(`server did not start:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    origin,
    url: `${origin}/p/${basename(dir)}`,
    dir,
    appDir,
    child,
    output: () => output,
    werk: (...args: string[]) => spawnSync("bun", [cli, ...args], { cwd: dir, env, encoding: "utf8" }),
    async dispose() {
      if (child.exitCode === null) {
        const done = new Promise((r) => child.once("exit", r));
        child.kill("SIGTERM");
        await done;
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

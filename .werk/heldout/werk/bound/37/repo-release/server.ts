/** A dev server on a copy of the app, with its output captured (held-out, repo-release). */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { copyApp } from "../../src/test-env/app-copy.ts";
import { cleanEnv } from "../../src/test-env/env.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "e2e", "fixtures", "project");

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

export type Dev = Awaited<ReturnType<typeof startDev>>;

export async function startDev() {
  const env = { ...cleanEnv(process.env), WERK_OPEN: "true" };
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-14-"));
  const dir = join(root, "project");
  cpSync(FIXTURE, dir, { recursive: true });
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  const appDir = join(root, "app");
  const cli = copyApp(appDir);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const state = { output: "" };
  const child: ChildProcess = spawn("bun", [cli, "serve", "--port", String(port)], {
    cwd: dir,
    env: { ...env, WERK_DEV: "1", WERK_HOME: join(root, "home") },
  });
  for (const s of [child.stdout, child.stderr])
    s?.on("data", (c) => {
      state.output += String(c);
    });
  const end = Date.now() + 30000;
  for (;;) {
    const res = await fetch(`${origin}/api/projects`).catch(() => null);
    if (res?.ok) break;
    if (Date.now() > end) throw new Error(`server did not start:\n${state.output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    origin,
    port,
    dir,
    appDir,
    url: `${origin}/p/${basename(dir)}`,
    state,
    pidOnPort(): string {
      return spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
        encoding: "utf8",
      }).stdout.trim();
    },
    werk: (...args: string[]) =>
      spawnSync("bun", [cli, ...args], { cwd: dir, env, encoding: "utf8" }),
    async dispose() {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 500));
      rmSync(root, { recursive: true, force: true });
    },
  };
}

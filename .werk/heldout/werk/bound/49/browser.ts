/** A dev-mode werk server on a copy of the fixture project, with its log and process exposed. */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { copyApp } from "../src/test-env/app-copy.ts";
import { cleanEnv } from "../src/test-env/env.ts";

const CHECKOUT = resolve(import.meta.dirname, "..");
const FIXTURE = join(CHECKOUT, "e2e", "fixtures", "project");

export const freePort = (): Promise<number> =>
  new Promise((res, rej) => {
    const probe = createServer();
    probe.once("error", rej);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => res(port));
    });
  });

export async function until(check: () => Promise<boolean> | boolean, what: string, ms = 30000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function devServer(opts: { appCopy?: boolean } = {}) {
  const env = { ...cleanEnv(process.env), WERK_OPEN: "true" } as Record<string, string>;
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-b-"));
  const dir = join(root, "project");
  cpSync(FIXTURE, dir, { recursive: true });
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  const home = join(root, "home");
  const appDir = opts.appCopy ? join(root, "app") : CHECKOUT;
  const cli = opts.appCopy ? copyApp(appDir) : join(CHECKOUT, "src", "cli.ts");
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let output = "";
  const child: ChildProcess = spawn("bun", [cli, "serve", "--port", String(port)], {
    cwd: dir,
    env: { ...env, WERK_DEV: "1", WERK_HOME: home },
  });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => { output += String(c); });
  await until(async () => (await fetch(`${origin}/api/projects`).catch(() => null))?.ok === true, "server");
  return {
    url: `${origin}/p/${basename(dir)}`,
    origin,
    port,
    dir,
    appDir,
    output: () => output,
    werk: (...args: string[]) => {
      const r = spawnSync("bun", [cli, ...args], { cwd: dir, env: { ...env, WERK_HOME: home }, encoding: "utf8" });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    },
    listeningPid: () => {
      const r = spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
      return r.stdout.trim();
    },
    async dispose() {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 500));
      rmSync(root, { recursive: true, force: true });
    },
  };
}

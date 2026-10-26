/** A werk server for the held-out browser tests: a project with its own log, and the server output kept. */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { copyApp } from "../src/test-env/app-copy.ts";
import { cleanEnv, fakeIsFirst } from "../src/test-env/env.ts";

const CHECKOUT = resolve(import.meta.dirname, "..");

export type Held = {
  url: string;
  port: number;
  dir: string;
  appDir: string;
  output: () => string;
  werk(...args: string[]): { code: number; stdout: string; stderr: string };
  listenerPid(): string;
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

export async function startHeld(opts: {
  events: Record<string, unknown>[];
  appCopy?: boolean;
}): Promise<Held> {
  const env = cleanEnv(process.env);
  if (!fakeIsFirst(env.PATH)) throw new Error("fake agent is not first");
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-e2e-"));
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  writeFileSync(
    join(dir, ".werk", "log.jsonl"),
    opts.events.map((e) => `${JSON.stringify(e)}\n`).join(""),
  );
  const appDir = opts.appCopy ? join(root, "app") : CHECKOUT;
  const cli = opts.appCopy ? copyApp(appDir) : join(CHECKOUT, "src", "cli.ts");
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  let output = "";
  const child: ChildProcess = spawn("bun", [cli, "serve", "--port", String(port)], {
    cwd: dir,
    env: { ...env, WERK_DEV: "1" },
  });
  for (const s of [child.stdout, child.stderr]) {
    s?.on("data", (c) => {
      output += String(c);
    });
  }
  const end = Date.now() + 60000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited:\n${output}`);
    const res = await fetch(`${url}/api/graph?shape=1`).catch(() => null);
    if (res?.ok) break;
    if (Date.now() > end) throw new Error(`server did not answer:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url,
    port,
    dir,
    appDir,
    output: () => output,
    werk: (...args) => {
      const r = spawnSync("bun", [cli, ...args], { cwd: dir, env, encoding: "utf8" });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    },
    listenerPid: () =>
      spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
        encoding: "utf8",
      }).stdout.trim(),
    async dispose() {
      if (child.exitCode === null) {
        const exited = new Promise((r) => child.once("exit", r));
        child.kill("SIGTERM");
        await exited;
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** A werk server for the held-out browser specs. It keeps the server output so a spec can read the log. */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { copyApp } from "../../src/test-env/app-copy.ts";
import { cleanEnv, fakeIsFirst } from "../../src/test-env/env.ts";

const CHECKOUT = resolve(import.meta.dirname, "..", "..");

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const probe = createServer();
    probe.once("error", rej);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => res(port));
    });
  });
}

export type Held = {
  url: string;
  port: number;
  dir: string;
  appDir: string;
  output: () => string;
  werk(...args: string[]): { code: number; stdout: string; stderr: string };
  dispose(): Promise<void>;
};

export async function startHeld(opts: { appCopy: boolean }): Promise<Held> {
  const env = { ...cleanEnv(process.env) };
  if (!fakeIsFirst(env.PATH)) throw new Error("fake agent is not first");
  const root = mkdtempSync(join(tmpdir(), "werk-held-"));
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  writeFileSync(
    join(dir, ".werk", "log.jsonl"),
    [
      {
        type: "node.proposed",
        id: "root",
        kind: "card",
        title: "Root",
        status: "open",
        why: "The top of the map.",
      },
      { type: "node.accepted", id: "root", actor: "you" },
    ]
      .map((e) => `${JSON.stringify(e)}\n`)
      .join(""),
  );
  const appDir = opts.appCopy ? join(root, "app") : CHECKOUT;
  const cli = opts.appCopy ? copyApp(appDir) : join(CHECKOUT, "src", "cli.ts");
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  let output = "";
  const child: ChildProcess = spawn(
    "bun",
    [cli, "serve", "--port", String(port)],
    { cwd: dir, env: { ...env, WERK_DEV: "1" } },
  );
  for (const s of [child.stdout, child.stderr]) {
    s?.on("data", (c) => {
      output += String(c);
    });
  }
  const end = Date.now() + 40000;
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
    werk(...args) {
      const r = spawnSync("bun", [cli, ...args], {
        cwd: dir,
        env,
        encoding: "utf8",
      });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    },
    async dispose() {
      if (child.exitCode === null) {
        const exited = new Promise((d) => child.once("exit", d));
        child.kill("SIGTERM");
        await exited;
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

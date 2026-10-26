/** A real werk server on a project with one root card, with its output kept, for the browser steps. */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { copyApp } from "../src/test-env/app-copy.ts";
import { cleanEnv, fakeIsFirst } from "../src/test-env/env.ts";

const CHECKOUT = resolve(import.meta.dirname, "..");

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

export type Served = {
  url: string;
  port: number;
  dir: string;
  appDir: string;
  /** Everything the server wrote to its output and error stream. */
  output: () => string;
  /** The holder named in the lock file of the project. */
  holder: () => { pid: number; port: number };
  werk: (...args: string[]) => { code: number; stdout: string; stderr: string };
  dispose: () => Promise<void>;
};

export async function serveProject(
  opts: { appCopy?: boolean; rootTitle: string },
): Promise<Served> {
  const env = { ...cleanEnv(process.env) };
  if (!fakeIsFirst(env.PATH)) throw new Error("the fake agent is not first");
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-e2e-"));
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const log = [
    { type: "node.proposed", id: "root", kind: "card", title: opts.rootTitle, status: "open", why: "The root." },
    { type: "node.accepted", id: "root", actor: "you" },
  ];
  writeFileSync(join(dir, ".werk", "log.jsonl"), `${log.map((e) => JSON.stringify(e)).join("\n")}\n`);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  const appDir = opts.appCopy ? join(root, "app") : CHECKOUT;
  const cli = opts.appCopy ? copyApp(appDir) : join(CHECKOUT, "src", "cli.ts");
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  let output = "";
  const child: ChildProcess = spawn("bun", [cli, "serve", "--port", String(port)], {
    cwd: dir,
    env: { ...env, WERK_DEV: "1" },
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk) => {
      output += String(chunk);
    });
  }
  const end = Date.now() + 60000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the server exited early:\n${output}`);
    const res = await fetch(`${url}/api/graph?shape=1`).catch(() => null);
    if (res?.ok) break;
    if (Date.now() > end) throw new Error(`the server did not answer:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url,
    port,
    dir,
    appDir,
    output: () => output,
    holder: () => JSON.parse(readFileSync(join(dir, ".werk", "serve.lock"), "utf8")),
    werk: (...args) => {
      const r = spawnSync("bun", [cli, ...args], { cwd: dir, env, encoding: "utf8" });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
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

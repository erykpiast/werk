/** A werk server on a project, with its output and the process on its port. */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { copyApp } from "../src/test-env/app-copy.ts";
import { cleanEnv, fakeIsFirst } from "../src/test-env/env.ts";

const CHECKOUT = resolve(import.meta.dirname, "..");

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => res(port));
    });
  });
}

export type Served = Awaited<ReturnType<typeof serveProject>>;

/** `events` becomes the map log before the server starts. */
export async function serveProject(events: unknown[], appCopy = false) {
  const env = cleanEnv(process.env);
  if (!fakeIsFirst(env.PATH)) throw new Error("fake agent is not first");
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-e2e-"));
  const dir = join(root, "project");
  cpSync(join(CHECKOUT, "e2e", "fixtures", "project"), dir, { recursive: true });
  const logPath = join(dir, ".werk", "log.jsonl");
  writeFileSync(logPath, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
  const appDir = appCopy ? join(root, "app") : CHECKOUT;
  const cli = appCopy ? copyApp(appDir) : join(CHECKOUT, "src", "cli.ts");
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  let output = "";
  const child: ChildProcess = spawn("bun", [cli, "serve", "--port", String(port)], {
    cwd: dir,
    env: { ...env, WERK_DEV: "1" },
  });
  for (const s of [child.stdout, child.stderr]) s?.on("data", (c) => (output += String(c)));
  const end = Date.now() + 40000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${output}`);
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
    logPath,
    output: () => output,
    /** The process that listens on the port. */
    listener: () =>
      spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.trim(),
    werk: (...args: string[]) => {
      const r = spawnSync("bun", [cli, ...args], { cwd: dir, env, encoding: "utf8" });
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

export const ROOT_EVENTS = [
  { type: "node.proposed", id: "root", kind: "card", title: "Root", status: "open", why: "The top card." },
  { type: "node.accepted", id: "root", actor: "you" },
];

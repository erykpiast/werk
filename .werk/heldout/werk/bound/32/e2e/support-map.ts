/**
 * Held-out helpers for the map and board specs (group g-map). A real werk server on a project folder
 * that holds a log the spec wrote itself. It copies the pattern of e2e/support/server.ts and adds the
 * server output, the process id, and files written before the start.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { copyApp } from "../../src/test-env/app-copy.ts";
import { cleanEnv, fakeIsFirst } from "../../src/test-env/env.ts";

const CHECKOUT = resolve(import.meta.dirname, "..", "..");

export const jsonl = (...events: unknown[]) =>
  `${events
    .flat()
    .map((e) => JSON.stringify(e))
    .join("\n")}\n`;

// Map event builders. They follow src/map/mark-fixtures.ts.
const AT = "2026-10-10T09:00:00.000Z";
export const ghost = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.proposed",
  id,
  kind: "card",
  title: `Title ${id}`,
  status: "open",
  ...extra,
});
export const open = (id: string, extra: Record<string, unknown> = {}) => [
  ghost(id, extra),
  { type: "node.accepted", id, actor: "you" },
];
export const decided = (id: string, extra: Record<string, unknown> = {}) => [
  ...open(id, extra),
  { type: "node.edited", id, who: "me", noBasis: "test" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];
export const link = (from: string, to: string, type = "depends_on") => ({
  type: "edge.added",
  from,
  to,
  link: type,
  why: `${from} takes ${to}`,
});
export const reopen = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.reopened",
  id,
  at: AT,
  ...extra,
});
export const ROOT = open("root", { title: "Root", why: "The root." });
/** A decided root, for specs that need decided cards below it (a decided card waits on its parent). */
export const ROOT_DECIDED = decided("root", { title: "Root", why: "The root." });

export type MapServerOptions = {
  /** The events of .werk/log.jsonl. */
  log: unknown[];
  /** The events of .werk/board.jsonl, when the spec needs a board. */
  board?: unknown[];
  /** Other files below the project folder, by relative path. */
  files?: Record<string, string>;
  /** Run from a copy of the app, so a spec can edit its source. */
  appCopy?: boolean;
};

export type MapServer = {
  url: string;
  origin: string;
  dir: string;
  appDir: string;
  port: number;
  /** The output of the server process, both streams. */
  output(): string;
  /** The process id of the server process, read from its start line. */
  pid(): number | undefined;
  start(): Promise<void>;
  stop(): Promise<void>;
  werk(...args: string[]): { code: number; stdout: string; stderr: string };
  dispose(): Promise<void>;
};

function freePort(): Promise<number> {
  return new Promise((done, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });
}

async function until(check: () => Promise<boolean>, what: string, ms = 30000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function startMapServer(
  options: MapServerOptions,
): Promise<MapServer> {
  const env = { ...cleanEnv(process.env), WERK_OPEN: "true" };
  if (!fakeIsFirst(env.PATH)) throw new Error("the fake agent is not first");
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-map-"));
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  writeFileSync(join(dir, ".werk", "log.jsonl"), jsonl(...options.log));
  if (options.board)
    writeFileSync(join(dir, ".werk", "board.jsonl"), jsonl(...options.board));
  for (const [path, text] of Object.entries(options.files ?? {})) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const init = spawnSync("git", ["init", "-q", "-b", "main"], {
    cwd: dir,
    env,
  });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  const home = join(root, "home");
  const appDir = options.appCopy ? join(root, "app") : CHECKOUT;
  const cli = options.appCopy
    ? copyApp(appDir)
    : join(CHECKOUT, "src", "cli.ts");
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  let output = "";

  const stop = async () => {
    const running = child;
    child = undefined;
    if (!running || running.exitCode !== null) return;
    const exited = new Promise((done) => running.once("exit", done));
    running.kill("SIGTERM");
    await exited;
  };
  return {
    url: `${origin}/p/project`,
    origin,
    dir,
    appDir,
    port,
    output: () => output,
    pid: () => {
      const found = /\(pid (\d+)\)/.exec(output);
      return found ? Number(found[1]) : undefined;
    },
    async start() {
      const running = spawn("bun", [cli, "serve", "--port", String(port)], {
        cwd: dir,
        env: { ...env, WERK_DEV: "1", WERK_HOME: home },
      });
      child = running;
      for (const stream of [running.stdout, running.stderr])
        stream?.on("data", (chunk) => {
          output += String(chunk);
        });
      await until(async () => {
        if (running.exitCode !== null)
          throw new Error(`the server exited early:\n${output}`);
        const res = await fetch(`${origin}/api/projects`).catch(() => null);
        return res?.ok === true;
      }, "the server to answer");
    },
    stop,
    werk(...args) {
      const r = spawnSync("bun", [cli, ...args], {
        cwd: dir,
        env,
        encoding: "utf8",
      });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    },
    async dispose() {
      await stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

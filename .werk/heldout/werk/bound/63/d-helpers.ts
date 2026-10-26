// Binder helpers for steps 13.x and 14.x: a temporary project with a seeded log, and werk serve
// processes that the test starts, kills and restarts itself.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv } from "../src/test/clean-env.ts";

export const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));

export type Proj = {
  dir: string;
  log: string;
  env: Record<string, string>;
  seed(type: string, payload: object): void;
  werk(...args: string[]): { code: number; out: string; err: string };
};

const roots: string[] = [];
const procs = new Set<ChildProcess>();

export function makeProject(): Proj {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-d-")));
  roots.push(root);
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: dir });
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const env = { ...cleanEnv(process.env, FAKE_BIN) } as Record<string, string>;
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  return {
    dir,
    log,
    env,
    seed: (type, payload) =>
      appendFileSync(log, `${JSON.stringify({ seq: lines() + 1, at: "t", actor: "you", type, payload })}\n`),
    werk: (...args) => {
      const run = spawnSync("bun", [CLI, ...args], { cwd: dir, env, encoding: "utf8" });
      return { code: run.status ?? -1, out: run.stdout, err: run.stderr };
    },
  };
}

export type Serve = {
  proc: ChildProcess;
  out(): string;
  err(): string;
  /** Resolves with the URL once the server prints it, or rejects with the exit code and stderr. */
  ready: Promise<string>;
  exited: Promise<number | null>;
};

export function serve(p: Proj, port = 0, env: Record<string, string> = {}): Serve {
  const proc = spawn("bun", [CLI, "serve", "--port", String(port)], {
    cwd: p.dir,
    env: { ...p.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  procs.add(proc);
  let out = "";
  let err = "";
  proc.stderr?.on("data", (c: Buffer) => {
    err += c.toString();
  });
  const exited = new Promise<number | null>((resolve) =>
    proc.once("exit", (code) => {
      procs.delete(proc);
      resolve(code);
    }),
  );
  const ready = new Promise<string>((resolve, reject) => {
    proc.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
      const found = /http:\/\/\S+/.exec(out);
      if (found !== null) resolve(found[0].replace(/\/map$/, ""));
    });
    void exited.then((code) => reject(new Error(`exited ${code}: ${err}`)));
  });
  ready.catch(() => undefined);
  return { proc, out: () => out, err: () => err, ready, exited };
}

export async function stopAll(): Promise<void> {
  await Promise.all(
    [...procs].map((proc) => {
      const done = new Promise((r) => proc.once("exit", r));
      proc.kill("SIGKILL");
      return done;
    }),
  );
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

// The harness of the held-out browser tests: a fresh project folder with a seeded log, real werk
// commands, and real werk servers on it.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

export function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.WERK_LOG;
  return env;
}

export type Server = { proc: ChildProcess; url: string; out(): string; err(): string; exited: Promise<number | null> };

export type Proj = {
  dir: string;
  log: string;
  werk(...args: string[]): string;
  tryWerk(...args: string[]): { code: number | null; out: string; err: string };
  seed(type: string, payload: object): void;
  lines(): string[];
  spawnServe(): Server;
  serve(): Promise<Server>;
};

const roots: string[] = [];
const procs: ChildProcess[] = [];

export function cleanup(): void {
  for (const proc of procs.splice(0)) if (proc.exitCode === null) proc.kill("SIGKILL");
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

export function waitUrl(server: Server): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const check = () => {
      const found = /http:\/\/\S+/.exec(server.out());
      if (found !== null) resolve(found[0].replace(/\/map$/, ""));
    };
    server.proc.stdout?.on("data", check);
    check();
    server.exited.then((code) => reject(new Error(`werk serve exited ${code}: ${server.err()}`)));
  });
}

export function project(): Proj {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-e2e-")));
  roots.push(root);
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: dir });
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  const seed = (type: string, payload: object) =>
    appendFileSync(log, `${JSON.stringify({ seq: lines().length + 1, at: "2026-01-01T00:00:00.000Z", actor: "you", type, payload })}\n`);
  const tryWerk = (...args: string[]) => {
    const run = spawnSync("bun", [CLI, ...args], { cwd: dir, env: cleanEnv(), encoding: "utf8" });
    return { code: run.status, out: run.stdout, err: run.stderr };
  };
  const werk = (...args: string[]) => {
    const run = tryWerk(...args);
    if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
    return run.out;
  };
  const spawnServe = (): Server => {
    const proc = spawn("bun", [CLI, "serve", "--port", "0"], { cwd: dir, env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] });
    procs.push(proc);
    let out = "";
    let err = "";
    proc.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
    });
    proc.stderr?.on("data", (c: Buffer) => {
      err += c.toString();
    });
    const exited = new Promise<number | null>((resolve) => proc.on("exit", (code) => resolve(code)));
    const server: Server = { proc, url: "", out: () => out, err: () => err, exited };
    return server;
  };
  const serve = async () => {
    const server = spawnServe();
    server.url = await waitUrl(server);
    return server;
  };
  return { dir, log, werk, tryWerk, seed, lines, spawnServe, serve };
}

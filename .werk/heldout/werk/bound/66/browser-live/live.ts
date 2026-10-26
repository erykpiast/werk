// Held-out helper: a fresh project seeded by log lines, and a werk server on it that can stop and
// start again on the same port. Every process runs with the cleaned environment of the product's
// own harness (fake agent first on PATH).

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv } from "../../src/test/clean-env.ts";
import { FAKE_DIR_VAR, SCRIPT_FILE } from "../../src/test/fake-script.ts";

export const CLI = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../../src/test/fake-bin", import.meta.url));

export type Run = { code: number; out: string; err: string };

export type Live = {
  dir: string;
  log: string;
  env: Record<string, string>;
  url: string;
  port: number;
  pid(): number | undefined;
  /** Runs werk; throws on a non-zero exit. */
  werk(...args: string[]): string;
  /** Runs werk and returns the exit code and both outputs. */
  run(...args: string[]): Run;
  seed(type: string, payload: object): void;
  lines(): string[];
  stop(): Promise<void>;
  restart(): Promise<void>;
  close(): Promise<void>;
};

export type Down = Pick<Live, "dir" | "log" | "werk" | "run" | "seed" | "lines" | "env">;

export function prepare(rootTitle = "Root"): Down & { root: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-")));
  const dir = join(root, "project");
  const fake = join(root, "fake");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  mkdirSync(fake);
  writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify({ roles: {} }));
  const env = { ...cleanEnv(process.env, FAKE_BIN), [FAKE_DIR_VAR]: fake };
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  const seed = (type: string, payload: object) =>
    appendFileSync(log, `${JSON.stringify({ seq: lines().length + 1, at: "t", actor: "you", type, payload })}\n`);
  const run = (...args: string[]): Run => {
    const r = spawnSync("bun", [CLI, ...args], { cwd: dir, env, encoding: "utf8" });
    return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
  };
  const werk = (...args: string[]) => {
    const r = run(...args);
    if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}`);
    return r.out;
  };
  seed("node.added", { id: "root", kind: "card", title: rootTitle });
  return { root, dir, log, env, werk, run, seed, lines };
}

export function startServe(
  dir: string,
  env: Record<string, string>,
  port = 0,
): { proc: ChildProcess; url: Promise<string>; err: () => string; exit: Promise<number | null> } {
  const proc = spawn("bun", [CLI, "serve", "--port", String(port)], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  proc.stderr?.on("data", (c: Buffer) => {
    err += c.toString();
  });
  const exit = new Promise<number | null>((resolve) => proc.once("exit", (code) => resolve(code)));
  const url = new Promise<string>((resolve, reject) => {
    let out = "";
    proc.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
      const found = /http:\/\/\S+/.exec(out);
      if (found !== null) resolve(found[0].replace(/\/map$/, ""));
    });
    void exit.then((code) => reject(new Error(`werk serve exited ${code}: ${err}`)));
  });
  url.catch(() => undefined);
  return { proc, url, err: () => err, exit };
}

const opened: Live[] = [];

export async function live(rootTitle = "Root", before: (d: Down) => void = () => undefined): Promise<Live> {
  const d = prepare(rootTitle);
  before(d);
  let current = startServe(d.dir, d.env, 0);
  const url = await current.url;
  const port = Number(new URL(url).port);
  const stop = async () => {
    if (current.proc.exitCode !== null || current.proc.signalCode !== null) return;
    current.proc.kill("SIGTERM");
    await current.exit;
  };
  const self: Live = {
    ...d,
    url,
    port,
    pid: () => current.proc.pid,
    stop,
    restart: async () => {
      await stop();
      current = startServe(d.dir, d.env, port);
      await current.url;
    },
    close: async () => {
      await stop();
      rmSync(d.root, { recursive: true, force: true });
    },
  };
  opened.push(self);
  return self;
}

export async function closeAll(): Promise<void> {
  for (const l of opened.splice(0)) await l.close();
}

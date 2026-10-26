// Helpers of group G: a project folder of our own and `werk serve` processes we start and kill.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv } from "../../src/test/clean-env.ts";

export const CHECKOUT = fileURLToPath(new URL("../..", import.meta.url));
export const CLI = join(CHECKOUT, "src", "cli.ts");
const FAKE_BIN = join(CHECKOUT, "src", "test", "fake-bin");
export const ENV = cleanEnv(process.env, FAKE_BIN);

const roots: string[] = [];
const procs = new Set<ChildProcess>();

export type Serve = {
  proc: ChildProcess;
  out(): string;
  err(): string;
  url: Promise<string>;
  exited: Promise<number | null>;
  startedAt: number;
};

/** A project folder with the given cards (id, title, parent) in its log. */
export function makeProject(cards: { id: string; title: string; parent?: string; body?: string }[] = []): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-g-")));
  roots.push(root);
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const lines = cards.map((c, i) =>
    JSON.stringify({ seq: i + 1, at: "t", actor: "you", type: "node.added", payload: { kind: "card", ...c } }),
  );
  writeFileSync(join(dir, ".werk", "log.jsonl"), lines.map((l) => `${l}\n`).join(""));
  return dir;
}

/** A copy of the e2e fixture project: three cards. */
export function fixtureProject(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-g-")));
  roots.push(root);
  const dir = join(root, "project");
  cpSync(join(CHECKOUT, "e2e", "fixtures", "project"), dir, { recursive: true });
  return dir;
}

export function serve(dir: string): Serve {
  const proc = spawn("bun", [CLI, "serve", "--port", "0"], { cwd: dir, env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  procs.add(proc);
  let out = "";
  let err = "";
  proc.stderr?.on("data", (c: Buffer) => {
    err += c.toString();
  });
  const exited = new Promise<number | null>((resolve) => proc.once("exit", (code) => resolve(code)));
  const url = new Promise<string>((resolve, reject) => {
    proc.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
      const found = /http:\/\/\S+/.exec(out);
      if (found !== null) resolve(found[0].replace(/\/map$/, ""));
    });
    void exited.then((code) => reject(new Error(`werk serve exited ${code}: ${err}`)));
  });
  url.catch(() => undefined);
  return { proc, out: () => out, err: () => err, url, exited, startedAt: Date.now() };
}

export function werk(dir: string, ...args: string[]): { status: number | null; out: string; err: string } {
  const run = spawnSync("bun", [CLI, ...args], { cwd: dir, env: ENV, encoding: "utf8" });
  return { status: run.status, out: run.stdout, err: run.stderr };
}

export async function cleanup(): Promise<void> {
  await Promise.all(
    [...procs].map((p) => {
      if (p.exitCode !== null || p.signalCode !== null) return undefined;
      const exited = new Promise((r) => p.once("exit", r));
      p.kill("SIGKILL");
      return exited;
    }),
  );
  procs.clear();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv } from "../src/test/clean-env.ts";

export const CHECKOUT = fileURLToPath(new URL("..", import.meta.url));
export const CLI = join(CHECKOUT, "src", "cli.ts");
export const FAKE_BIN = join(CHECKOUT, "src", "test", "fake-bin");
export const ENV = cleanEnv(process.env, FAKE_BIN);
const roots: string[] = [];

export function fixtureCopy(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-g5-")));
  roots.push(root);
  const dir = join(root, "project");
  cpSync(join(CHECKOUT, "e2e", "fixtures", "project"), dir, { recursive: true });
  return dir;
}
export function werk(dir: string, ...args: string[]): string {
  const run = spawnSync("bun", [CLI, ...args], { cwd: dir, env: ENV, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.status}: ${run.stderr}`);
  return run.stdout;
}
export type Proc = { proc: ChildProcess; out(): string; err(): string; exit: Promise<number | null>; url(): Promise<string> };
const procs: ChildProcess[] = [];
export function serve(dir: string, extraEnv: Record<string, string> = {}): Proc {
  const proc = spawn("bun", [CLI, "serve", "--port", "0"], { cwd: dir, env: { ...ENV, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  procs.push(proc);
  let out = "";
  let err = "";
  proc.stdout?.on("data", (c: Buffer) => (out += c.toString()));
  proc.stderr?.on("data", (c: Buffer) => (err += c.toString()));
  const exit = new Promise<number | null>((r) => proc.once("exit", (code) => r(code)));
  const url = async () => {
    for (let i = 0; i < 300; i++) {
      const m = /http:\/\/\S+/.exec(out);
      if (m) return m[0].replace(/\/map$/, "");
      if (proc.exitCode !== null) throw new Error(`exited ${proc.exitCode}: ${err}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("no url");
  };
  return { proc, out: () => out, err: () => err, exit, url };
}
export function lockOf(dir: string): { pid: number; port?: number } {
  return JSON.parse(readFileSync(join(dir, ".werk", "serve.lock"), "utf8"));
}
export async function cleanup(): Promise<void> {
  for (const p of procs.splice(0)) if (p.exitCode === null) { const e = new Promise((r) => p.once("exit", r)); p.kill("SIGKILL"); await e; }
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
}

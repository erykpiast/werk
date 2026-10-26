// Helpers for F5: start a werk serve in a given project folder with the cleaned environment.
import { type ChildProcess, spawn } from "node:child_process";
import { cpSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanEnv } from "../src/test/clean-env.ts";

export const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
export const FAKE_BIN = join(import.meta.dirname, "..", "src", "test", "fake-bin");
export const FIXTURE = join(import.meta.dirname, "..", "e2e", "fixtures", "project");

export function fixtureCopy(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-f5-")));
  const dir = join(root, "project");
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

export type Srv = { proc: ChildProcess; out(): string; err(): string; exited: Promise<number | null>; url(): Promise<string> };

export function serve(dir: string, extra: string[] = [], env: Record<string, string> = {}): Srv {
  const proc = spawn("bun", [CLI, "serve", "--port", "0", ...extra], {
    cwd: dir,
    env: { ...cleanEnv(process.env, FAKE_BIN), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  proc.stdout?.on("data", (c: Buffer) => (out += c.toString()));
  proc.stderr?.on("data", (c: Buffer) => (err += c.toString()));
  const exited = new Promise<number | null>((r) => proc.once("exit", (c) => r(c)));
  const url = () =>
    new Promise<string>((resolve, reject) => {
      const t = setInterval(() => {
        const f = /http:\/\/\S+/.exec(out);
        if (f) {
          clearInterval(t);
          resolve(f[0].replace(/\/map$/, ""));
        }
      }, 50);
      void exited.then(() => {
        clearInterval(t);
        reject(new Error(`exited: ${err}`));
      });
    });
  return { proc, out: () => out, err: () => err, exited, url };
}

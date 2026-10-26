// Helpers of the `repo` binder: a fresh clone of the checkout in a temp folder, and runs in it.
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHECKOUT = realpathSync(join(import.meta.dir, ".."));
export const FAKE_BIN_CHECKOUT = join(CHECKOUT, "src", "test", "fake-bin");

export type Run = { code: number; out: string };

/** The environment of a person's shell: the real PATH without the checkout's fake agent. */
export function personEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.PATH = (env.PATH ?? "")
    .split(":")
    .filter((d) => d !== "" && d !== FAKE_BIN_CHECKOUT)
    .join(":");
  delete env.GIT_CONFIG_GLOBAL;
  delete env.GIT_CONFIG_NOSYSTEM;
  delete env.CI;
  return { ...env, ...extra };
}

/** A PATH with no folder that holds a `claude` program. */
export function pathWithoutClaude(path: string): string {
  return path
    .split(":")
    .filter((d) => d !== "" && !existsSync(join(d, "claude")))
    .join(":");
}

export function run(cmd: string[], cwd: string, env: Record<string, string> = personEnv()): Run {
  const p = Bun.spawnSync(cmd, { cwd, env, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() };
}

export function sh(script: string, cwd: string, env: Record<string, string> = personEnv()): Run {
  return run(["/bin/sh", "-c", `${script} 2>&1`], cwd, env);
}

/** A fresh clone of the checkout with its dependencies installed. */
export function freshClone(tag: string, env: Record<string, string> = personEnv()): string {
  const base = mkdtempSync(join(tmpdir(), `werk-repo-${tag}-`));
  const dir = join(base, "werk");
  const c = run(["git", "clone", "--quiet", CHECKOUT, dir], base, env);
  if (c.code !== 0) throw new Error(`clone failed: ${c.out}`);
  const i = run(["bun", "install", "--frozen-lockfile"], dir, env);
  if (i.code !== 0) throw new Error(`install failed: ${i.out}`);
  return dir;
}

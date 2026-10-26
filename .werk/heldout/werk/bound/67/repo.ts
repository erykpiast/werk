// Shared helper for the held-out repository tests: a clone of this checkout in the OS temporary
// folder, removed when the test ends, and a runner of commands inside it.
import { afterEach } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHECKOUT = join(import.meta.dir, "..");

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

export type Out = { code: number; out: string; err: string; all: string };

export function sh(cwd: string, cmd: string[], env: Record<string, string | undefined> = process.env): Out {
  const run = Bun.spawnSync(cmd, { cwd, env, stdout: "pipe", stderr: "pipe" });
  const out = run.stdout.toString();
  const err = run.stderr.toString();
  return { code: run.exitCode ?? -1, out, err, all: out + err };
}

/** A fresh clone of this checkout. */
export function clone(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-repo-")));
  roots.push(root);
  const dir = join(root, "werk");
  const run = sh(root, ["git", "clone", "--quiet", CHECKOUT, dir]);
  if (run.code !== 0) throw new Error(`clone failed: ${run.err}`);
  return dir;
}

export const make = (dir: string, target: string, env?: Record<string, string | undefined>) =>
  sh(dir, ["make", target], env);

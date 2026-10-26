import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");

export type Out = { code: number; out: string; err: string };

export function sh(cwd: string, cmd: string[], env: Record<string, string | undefined> = {}): Out {
  const run = Bun.spawnSync(cmd, { timeout: 500000, cwd, env: { ...process.env, ...env } as Record<string, string>, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode ?? -1, out: run.stdout.toString(), err: run.stderr.toString() };
}

/** A clone of this checkout at its HEAD commit, with dependencies installed, outside the checkout. */
export function cloneApp(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-a-")));
  const head = sh(ROOT, ["git", "rev-parse", "HEAD"]).out.trim();
  const c = join(dir, "c");
  const clone = sh(dir, ["git", "clone", "-q", ROOT, c]);
  if (clone.code !== 0) throw new Error(clone.err);
  sh(c, ["git", "checkout", "-q", head]);
  const inst = sh(c, ["bun", "install", "--frozen-lockfile"]);
  if (inst.code !== 0) throw new Error(inst.err);
  return c;
}

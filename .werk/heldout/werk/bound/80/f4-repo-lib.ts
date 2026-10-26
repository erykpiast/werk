import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHECKOUT = join(import.meta.dir, "..");
export const sh = (cwd: string, cmd: string[], env?: Record<string, string>) => {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};

/** A fresh clone of the checkout's HEAD as branch main, in a temp dir, dependencies installed. */
export function cloneMain(install = true): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "heldout-f4-")));
  const dir = join(root, "werk");
  Bun.spawnSync(["mkdir", dir]);
  const steps = [
    ["git", "init", "-q", "--initial-branch=main"],
    ["git", "fetch", "-q", CHECKOUT, "HEAD"],
    ["git", "checkout", "-q", "-B", "main", "FETCH_HEAD"],
  ];
  for (const s of steps) {
    const r = sh(dir, s);
    if (r.code !== 0) throw new Error(`${s.join(" ")}: ${r.err}`);
  }
  // fetch from a worktree only brings history reachable from HEAD
  if (install) {
    const r = sh(dir, ["bun", "install", "--frozen-lockfile"]);
    if (r.code !== 0) throw new Error(r.err);
  }
  return dir;
}

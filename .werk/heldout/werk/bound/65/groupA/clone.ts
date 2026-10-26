// Held-out helper: a clone of this checkout in a temp folder, and a command runner with a plain
// environment (no fake agent, no real claude on PATH).
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHECKOUT = join(import.meta.dir, "..", "..");
const HOME = process.env.HOME ?? "/tmp";
export const PLAIN_PATH = `${HOME}/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin`;

export type Out = { code: number; out: string };

export function sh(cwd: string, cmd: string[], extraEnv: Record<string, string> = {}): Out {
  const r = Bun.spawnSync(cmd, {
    cwd,
    env: { HOME, PATH: PLAIN_PATH, TMPDIR: tmpdir(), ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode ?? -1, out: r.stdout.toString() + r.stderr.toString() };
}

export function cloneCheckout(): { dir: string; done: () => void } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldoutA-")));
  const dir = join(root, "werk");
  const head = sh(CHECKOUT, ["git", "rev-parse", "HEAD"]).out.trim();
  const c = sh(root, ["git", "clone", "--quiet", CHECKOUT, dir]);
  if (c.code !== 0) throw new Error(c.out);
  sh(dir, ["git", "checkout", "--quiet", head]);
  sh(dir, ["git", "config", "user.email", "t@t.invalid"]);
  sh(dir, ["git", "config", "user.name", "t"]);
  return { dir, done: () => rmSync(root, { recursive: true, force: true }) };
}

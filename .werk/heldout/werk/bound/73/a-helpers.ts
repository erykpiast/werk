// Shared helpers of the binder's group A: a fresh copy of the checkout, and make runs in it.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const CHECKOUT = join(import.meta.dir, "..");
const BUN_DIR = dirname(process.execPath);
/** A PATH with Bun and the system tools, and no `claude` program on it. */
export const PLAIN_PATH = [BUN_DIR, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");

export type Run = { code: number; out: string };

export function env(): Record<string, string> {
  return {
    PATH: PLAIN_PATH,
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

export function sh(cwd: string, cmd: string[]): Run {
  const run = Bun.spawnSync(cmd, { cwd, env: env(), stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode ?? -1, out: run.stdout.toString() + run.stderr.toString() };
}

const copies: string[] = [];

/** A clone of the checkout at its HEAD, as a person gets it. */
export function cloneCheckout(): string {
  const head = sh(CHECKOUT, ["git", "rev-parse", "HEAD"]).out.trim();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-binder-a-")));
  copies.push(root);
  const dir = join(root, "werk");
  const clone = sh(root, ["git", "clone", "--quiet", "--no-checkout", CHECKOUT, dir]);
  if (clone.code !== 0) throw new Error(clone.out);
  const co = sh(dir, ["git", "checkout", "--quiet", head]);
  if (co.code !== 0) throw new Error(co.out);
  return dir;
}

export function removeCopies(): void {
  for (const root of copies.splice(0)) rmSync(root, { recursive: true, force: true });
}

export const make = (dir: string, target: string) => sh(dir, ["make", target]);

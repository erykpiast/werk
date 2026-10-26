// Held-out helper: a clone of this checkout's HEAD in a temporary folder, and a runner for make.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHECKOUT = join(import.meta.dir, "..");

export type Run = { code: number; out: string };

export function sh(cwd: string, cmd: string[], timeout = 900_000): Run {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", timeout });
  return { code: r.exitCode ?? -1, out: r.stdout.toString() + r.stderr.toString() };
}

export function cloneCheckout(): { dir: string; done(): void } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-a-")));
  const dir = join(root, "werk");
  const r = sh(root, ["git", "clone", "--quiet", CHECKOUT, dir]);
  if (r.code !== 0) throw new Error(`clone failed: ${r.out}`);
  sh(dir, ["git", "config", "user.name", "binder"]);
  sh(dir, ["git", "config", "user.email", "binder@werk.invalid"]);
  return { dir, done: () => rmSync(root, { recursive: true, force: true }) };
}

export const make = (dir: string, target: string) => sh(dir, ["make", target]);

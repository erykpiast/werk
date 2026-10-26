// A fresh clone of this checkout in a temporary folder, with its locked packages installed, so a
// held-out step can delete, edit or add files and run the make targets without touching the checkout.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const CHECKOUT = dirname(import.meta.dir);

export type Sh = { code: number; out: string };

export type Copy = { dir: string; sh(cmd: string[], env?: Record<string, string>): Sh; remove(): void };

export function cloneCheckout(): Copy {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-a-")));
  const dir = join(root, "werk");
  const sh = (cmd: string[], env?: Record<string, string>): Sh => {
    const run = Bun.spawnSync(cmd, { cwd: dir, env: env ?? process.env, stdout: "pipe", stderr: "pipe" });
    return { code: run.exitCode ?? -1, out: run.stdout.toString() + run.stderr.toString() };
  };
  const clone = Bun.spawnSync(["git", "clone", "-q", CHECKOUT, dir], { stdout: "pipe", stderr: "pipe" });
  if (clone.exitCode !== 0) throw new Error(clone.stderr.toString());
  const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: CHECKOUT }).stdout.toString().trim();
  if (sh(["git", "checkout", "-q", head]).code !== 0) throw new Error(`cannot check out ${head}`);
  const install = sh(["bun", "install", "--frozen-lockfile"]);
  if (install.code !== 0) throw new Error(install.out);
  return { dir, sh, remove: () => rmSync(root, { recursive: true, force: true }) };
}

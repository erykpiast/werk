// A fresh clone of this checkout at its HEAD, so a step can edit files without touching the checkout.
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHECKOUT = join(import.meta.dir, "..");

export function cloneCheckout(tag: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `werk-heldout-${tag}-`)));
  const dir = join(root, "werk");
  const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: CHECKOUT }).stdout.toString().trim();
  for (const cmd of [
    ["git", "clone", "--quiet", "--no-hardlinks", CHECKOUT, dir],
    ["git", "-C", dir, "checkout", "--quiet", head],
  ]) {
    const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${r.stderr}`);
  }
  return dir;
}

export function sh(cwd: string, cmd: string[]): { code: number; out: string } {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, CI: "true" } });
  return { code: r.exitCode ?? -1, out: `${r.stdout}${r.stderr}` };
}

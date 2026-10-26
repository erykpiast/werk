// A copy of the checkout at HEAD, in a temporary folder, with its locked packages installed.
// The held-out tests edit and run make only in such a copy, never in the checkout.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHECKOUT = join(import.meta.dir, "..", "..");

export type Out = { code: number; out: string };

export function sh(cwd: string, cmd: string, env: Record<string, string | undefined> = process.env): Out {
  const run = Bun.spawnSync(["/bin/sh", "-c", `${cmd} 2>&1`], { cwd, env, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode ?? -1, out: run.stdout.toString() };
}

export function copyCheckout(): { dir: string; remove(): void } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-copy-")));
  const dir = join(root, "werk");
  const head = sh(CHECKOUT, "git rev-parse HEAD").out.trim();
  for (const cmd of [`git clone --quiet --no-checkout '${CHECKOUT}' '${dir}'`]) {
    const r = sh(root, cmd);
    if (r.code !== 0) throw new Error(r.out);
  }
  for (const cmd of [`git checkout --quiet ${head}`, "bun install --frozen-lockfile"]) {
    const r = sh(dir, cmd);
    if (r.code !== 0) throw new Error(`${cmd}: ${r.out}`);
  }
  return { dir, remove: () => rmSync(root, { recursive: true, force: true }) };
}

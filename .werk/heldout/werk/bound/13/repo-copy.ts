// A copy of the committed werk checkout in a temporary folder, so a test can delete or replace
// files without a change to the real checkout.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");

export function repoCopy(): { dir: string; remove(): void } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-repo-")));
  const dir = join(base, "werk");
  const sh = (command: string) => {
    const run = Bun.spawnSync(["sh", "-c", command], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    if (run.exitCode !== 0) throw new Error(`${command}: ${run.stderr.toString()}`);
  };
  sh(`mkdir -p '${dir}' && git archive HEAD | tar -x -C '${dir}'`);
  sh(`cp -cR node_modules '${dir}/node_modules' 2>/dev/null || cp -R node_modules '${dir}/node_modules'`);
  sh(`touch '${dir}/node_modules/.werk-installed'`);
  return { dir, remove: () => rmSync(base, { recursive: true, force: true }) };
}

export function make(dir: string, ...targets: string[]): { code: number; out: string } {
  const run = Bun.spawnSync(["sh", "-c", `make ${targets.join(" ")} 2>&1`], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: run.exitCode, out: run.stdout.toString() };
}

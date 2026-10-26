// A copy of this checkout in a temporary folder, so a test can change files and run make there.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "bun:test";

const ROOT = join(import.meta.dir, "..");
const copies: string[] = [];

afterEach(() => {
  for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function repoCopy(): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-repo-")));
  copies.push(base);
  const dir = join(base, "werk");
  const r = Bun.spawnSync(
    ["rsync", "-a", "--exclude", ".werk-heldout", "--exclude", "node_modules/.vite-temp", "--exclude", "test-results", "--exclude", ".git", `${ROOT}/`, `${dir}/`],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return dir;
}

export function make(dir: string, target: string): { code: number; out: string } {
  const r = Bun.spawnSync(["make", target], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode ?? -1, out: `${r.stdout.toString()}${r.stderr.toString()}` };
}

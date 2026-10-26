import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..");

export function sh(cwd: string, cmd: string[], env: Record<string, string | undefined> = {}) {
  const r = Bun.spawnSync(cmd, { cwd, env: { ...process.env, CI: "true", ...env } as Record<string, string>, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

/** A clone of the checked-out commit in a new folder. With `link`, node_modules points at the checkout's. */
export function cloneHead(link: boolean) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "werk-heldout-clone-"));
  const repo = join(dir, "werk");
  const head = sh(ROOT, ["git", "rev-parse", "HEAD"]).out.trim();
  let r = sh(dir, ["git", "clone", "-q", ROOT, repo]);
  if (r.code !== 0) throw new Error(r.out);
  r = sh(repo, ["git", "checkout", "-q", "-B", "main", head]);
  if (r.code !== 0) throw new Error(r.out);
  if (link) {
    mkdirSync(join(repo, "node_modules"));
    for (const n of readdirSync(join(ROOT, "node_modules"))) {
      if (n === ".vite") continue;
      symlinkSync(join(ROOT, "node_modules", n), join(repo, "node_modules", n));
    }
  }
  return { dir, repo, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

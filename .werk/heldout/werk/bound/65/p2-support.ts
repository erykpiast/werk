import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { copyApp } from "../src/test-env/app-copy.ts";

export const CHECKOUT = resolve(import.meta.dirname, "..");

/** A temp dir, outside the checkout. */
export const tempDir = (name: string) =>
  realpathSync(mkdtempSync(join(tmpdir(), `werk-p2-${name}-`)));

/**
 * A copy of the repository setup in a new temp dir: the app (copyApp), the .claude folder with its
 * links kept as links, the workflow, the Makefile and the pin files. It is a git repository.
 */
export function repoCopy(name: string): string {
  const dest = tempDir(name);
  copyApp(dest);
  for (const path of [
    ".claude",
    ".github",
    "Makefile",
    ".bun-version",
    ".gitignore",
    "bun.lock",
  ]) {
    cpSync(join(CHECKOUT, path), join(dest, path), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dest });
  return dest;
}

export function sh(cmd: string[], cwd: string, env?: Record<string, string>) {
  const r = spawnSync(cmd[0] as string, cmd.slice(1), {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    code: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

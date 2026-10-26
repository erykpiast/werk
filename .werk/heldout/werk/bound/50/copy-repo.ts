/** A copy of the checkout for a test that changes files. Plain Node code, so Playwright and Bun both load it. */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/**
 * Copies the tracked files into `dest`, makes it a git repository, and links the installed
 * packages with the install stamp, so `make` does not install again.
 */
export function copyRepo(dest: string): void {
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
    .stdout.split("\0")
    .filter(Boolean);
  for (const file of listed) {
    const from = join(ROOT, file);
    if (!existsSync(from)) continue;
    mkdirSync(dirname(join(dest, file)), { recursive: true });
    cpSync(from, join(dest, file), { verbatimSymlinks: true });
  }
  const modules = join(dest, "node_modules");
  mkdirSync(modules, { recursive: true });
  for (const name of readdirSync(join(ROOT, "node_modules"))) {
    symlinkSync(join(ROOT, "node_modules", name), join(modules, name));
  }
  writeFileSync(join(modules, ".install-stamp"), "");
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["config", "user.name", "heldout"],
    ["config", "user.email", "heldout@werk.invalid"],
    ["add", "-A"],
    ["commit", "-q", "-m", "copy"],
  ]) {
    spawnSync("git", args, { cwd: dest });
  }
}

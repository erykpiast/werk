import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { cleanEnv } from "../src/test-env/env.ts";

export const CHECKOUT = resolve(import.meta.dirname, "..");

/** A copy of the checkout's tracked files in a fresh temp folder, with the locked packages installed and a git commit. */
export function repoCopy(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-copy-")));
  const list = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: CHECKOUT });
  for (const rel of list.stdout.toString().split("\0").filter(Boolean)) {
    const from = join(CHECKOUT, rel);
    const to = join(root, rel);
    mkdirSync(dirname(to), { recursive: true });
    const stat = lstatSync(from);
    if (stat.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
    else copyFileSync(from, to);
  }
  const env = cleanEnv(process.env);
  const sh = (cmd: string[]) => {
    const r = Bun.spawnSync(cmd, { cwd: root, env });
    if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${r.stderr.toString()}`);
  };
  sh(["bun", "install", "--frozen-lockfile"]);
  sh(["git", "init", "-q", "-b", "main"]);
  sh(["git", "add", "-A"]);
  sh(["git", "-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-q", "-m", "copy"]);
  return root;
}

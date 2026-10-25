/** The git calls of the builder loop: a worktree off the main line's tip, the pass commits, the clean-up. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Env = Record<string, string | undefined>;

function git(cwd: string, env: Env, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: env as Record<string, string>,
  });
  return {
    ok: result.exitCode === 0,
    out: result.stdout.toString().trim(),
    err: result.stderr.toString().trim(),
  };
}

function must(cwd: string, env: Env, ...args: string[]): string {
  const result = git(cwd, env, ...args);
  if (!result.ok) throw new Error(`git ${args.join(" ")}: ${result.err}`);
  return result.out;
}

export type Worktree = {
  dir: string;
  branch: string;
  /** The tip of the main line when the worktree was made. */
  base: string;
};

/**
 * Makes a worktree on the ticket's branch. A branch that already sits on top of the main line's tip
 * keeps its commits; any other branch of that name starts again from the tip (#st-build-run-mechanics).
 */
export function addWorktree(
  repo: string,
  env: Env,
  branch: string,
  mainLine: string,
): Worktree {
  const base = must(repo, env, "rev-parse", "--verify", `${mainLine}^{commit}`);
  const dir = mkdtempSync(join(tmpdir(), "werk-build-wt-"));
  const exists = git(
    repo,
    env,
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ).ok;
  const onTop =
    exists &&
    git(repo, env, "merge-base", "--is-ancestor", base, `refs/heads/${branch}`)
      .ok;
  const args = onTop
    ? ["worktree", "add", dir, branch]
    : ["worktree", "add", "-B", branch, dir, base];
  must(repo, env, ...args);
  return { dir, branch, base };
}

/** Commits everything the worktree holds as "pass n", even when nothing changed. */
export function commitPass(dir: string, env: Env, n: number): void {
  must(dir, env, "add", "-A");
  must(
    dir,
    env,
    "commit",
    "-q",
    "--allow-empty",
    "--no-verify",
    "-m",
    `pass ${n}`,
  );
}

/** Removes the worktree folder. The branch stays. */
export function removeWorktree(repo: string, env: Env, tree: Worktree): void {
  git(repo, env, "worktree", "remove", "--force", tree.dir);
  rmSync(tree.dir, { recursive: true, force: true });
  git(repo, env, "worktree", "prune");
}

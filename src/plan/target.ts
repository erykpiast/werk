/** The check of a target repository, and the one that every build command makes before it starts (#st-build-target). */
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

export type TargetCheck =
  | { ok: true; path: string }
  | { ok: false; error: string };

/** A git call in a folder. The variables that point git at another repository stay out of its environment. */
function git(cwd: string, ...args: string[]) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_")) env[key] = value;
  }
  return Bun.spawnSync(["git", ...args], { cwd, env });
}

const real = (path: string): string => {
  let existing = path;
  while (!existsSync(existing)) existing = dirname(existing);
  return resolve(realpathSync(existing), path.slice(existing.length + 1));
};

const inside = (outer: string, inner: string): boolean =>
  inner === outer || inner.startsWith(outer + sep);

/**
 * Checks a path as the target of a project whose store is a folder. The path comes back absolute
 * and unresolved by links, as the person gave it.
 */
export function checkTarget(
  cwd: string,
  given: string,
  store: string,
): TargetCheck {
  const path = resolve(cwd, given);
  if (!existsSync(path) || !statSync(path).isDirectory())
    return { ok: false, error: `"${given}" is not a directory` };
  const here = real(path);
  const there = real(store);
  if (inside(there, here))
    return { ok: false, error: `"${given}" lies inside werk's store` };
  if (inside(here, there))
    return { ok: false, error: `"${given}" holds werk's store` };
  const top = git(path, "rev-parse", "--show-toplevel");
  if (top.exitCode !== 0)
    return { ok: false, error: `"${given}" is not in a git repository` };
  if (real(top.stdout.toString().trim()) !== real(path))
    return {
      ok: false,
      error: `"${given}" is a folder inside a repository, not its top folder`,
    };
  // A branch counts when it exists or when HEAD names it, so a repository with no commit yet has its main line.
  const head = git(path, "symbolic-ref", "--short", "HEAD")
    .stdout.toString()
    .trim();
  const branches = ["main", "master"].filter(
    (name) =>
      name === head ||
      git(path, "rev-parse", "--verify", "--quiet", `refs/heads/${name}`)
        .exitCode === 0,
  );
  if (branches.length === 0)
    return {
      ok: false,
      error: `"${given}" has no main line: no branch named main or master`,
    };
  return { ok: true, path };
}

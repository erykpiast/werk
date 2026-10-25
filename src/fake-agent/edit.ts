import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** The real path of the deepest part of `path` that exists, with the rest appended. */
function realWithTail(path: string): string {
  let existing = path;
  while (!existsSync(existing)) existing = dirname(existing);
  return resolve(realpathSync(existing), relative(existing, path));
}

/**
 * Resolves an edit path against the folder the agent started in. Returns the
 * absolute path, or null when the path leads outside the folder, also through a link.
 */
export function resolveEdit(cwd: string, path: string): string | null {
  const root = resolve(cwd);
  const target = resolve(root, path);
  if (!inside(root, target)) return null;
  return inside(realWithTail(root), realWithTail(target)) ? target : null;
}

export function writeEdit(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

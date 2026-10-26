// Helper for the c-* tests: a throwaway copy of the checkout, so no test writes into the checkout.
import { cpSync, existsSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const CHECKOUT = resolve(import.meta.dirname, "..");
const SKIP = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  "test-results",
  "playwright-report",
  ".werk-heldout",
]);

/** Copies the checkout (not its packages, build output or git data) and links the packages. */
export function copyRepo(): { root: string; repo: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-c-")));
  const repo = join(root, "repo");
  cpSync(CHECKOUT, repo, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (src) => {
      const rel = src.slice(CHECKOUT.length + 1);
      return !SKIP.has(rel.split("/")[0] ?? "");
    },
  });
  if (existsSync(join(CHECKOUT, "node_modules"))) {
    symlinkSync(join(CHECKOUT, "node_modules"), join(repo, "node_modules"));
  }
  return { root, repo };
}

/**
 * Runs when the bundler reads the code, not while werk runs: a checkout and a release build both
 * get the verb module names as data in the code (#werk-dist-own-list).
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** The verb modules of a folder: every .ts file except the tests, in name order. */
export function verbNamesOf(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort();
}

export function verbNames(): string[] {
  return verbNamesOf(join(import.meta.dir, "..", "verbs"));
}

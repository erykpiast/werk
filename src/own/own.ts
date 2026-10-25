/**
 * werk's own files, as the running werk knows them (#werk-dist, #werk-dist-own-list).
 * A release executable registers its embedded files here before the command line starts. A checkout
 * registers nothing, and the defaults read the checkout's code. The code never lists a folder to find a part of itself.
 */
import { join } from "node:path";
import { VERB_MODULE_NAMES } from "./verb-names.ts";

export type VerbModule = { name: string; load: () => Promise<unknown> };

export type OwnFiles = {
  /** Every verb module. */
  verbs: VerbModule[];
  /** The built client files by their address in the page, each as a path that Bun reads. */
  client: Record<string, string>;
};

const SRC = join(import.meta.dir, "..");
const CLI = join(SRC, "cli.ts");

const checkout: OwnFiles = {
  verbs: VERB_MODULE_NAMES.map((name) => ({
    name,
    load: () => import(join(SRC, "verbs", name)),
  })),
  client: {},
};

let registered: OwnFiles | null = null;

/** Called by the entry of a release executable, once, before anything else runs. Null undoes it, for a test. */
export function registerOwnFiles(files: OwnFiles | null): void {
  registered = files;
}

export function ownFiles(): OwnFiles {
  return registered ?? checkout;
}

/** True when werk runs as a release executable. */
export const isExecutable = (): boolean => registered !== null;

/**
 * The argument list that starts this werk again: the executable alone, or the runtime and the
 * cli of the checkout. A child process, an agent prompt and a printed command all use it.
 */
export function selfCommand(): string[] {
  return isExecutable() ? [process.execPath] : [process.execPath, CLI];
}

/** The same command as one line a shell reads. */
export function selfCommandLine(): string {
  return selfCommand()
    .map((part) => `"${part}"`)
    .join(" ");
}

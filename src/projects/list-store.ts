/** The project list on disk: one file in a per-user folder, outside every project (#werk-projects-list). */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseFolders, serializeFolders } from "./list.ts";

type Env = Record<string, string | undefined>;

/** The per-user folder. WERK_HOME or WERK_LOG names another one, to run a second server on purpose. Tests run that way. */
export function userHome(env: Env): string {
  if (env.WERK_HOME) return env.WERK_HOME;
  // A second instance on purpose: its list and its lock sit beside the log it names (#werk-onelock).
  if (env.WERK_LOG) return dirname(env.WERK_LOG);
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "werk");
}

export const listPath = (home: string) => join(home, "projects.json");

/** The lock of the one server of this per-user folder. */
export const serverLockPath = (home: string) => join(home, "serve.lock");

/** The stored folders. A missing file is an empty list. A file that is not a list throws, so no write replaces it. */
export function readStored(home: string): string[] {
  const path = listPath(home);
  const parsed = parseFolders(
    existsSync(path) ? readFileSync(path, "utf8") : "",
  );
  if (!parsed.ok) {
    throw new Error(
      `the project list ${path} cannot be read: ${parsed.reason}. Fix or remove the file.`,
    );
  }
  return parsed.folders;
}

/** Writes the whole list in one rename, so a reader sees the old list or the new one. */
export function writeStored(home: string, folders: readonly string[]): void {
  const path = listPath(home);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, serializeFolders(folders));
  renameSync(temp, path);
}

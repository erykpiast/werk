/** The name of each project on the list: its folder name, and a clash adds the parent folder (#werk-projects-names). */
import { basename, dirname } from "node:path";

/** The name of a folder: its last part. A folder with no last part, the file system root, is named by its path. */
function folderName(folder: string): string {
  return basename(folder) || folder;
}

/**
 * One name for each folder, in the order of the list. A folder whose name is taken by an earlier one
 * adds its parent folder name in brackets, for example "api (work)". When that is taken too, the brackets
 * hold the whole parent path, which no other folder shares.
 */
export function projectNames(folders: readonly string[]): string[] {
  const taken = new Set<string>();
  return folders.map((folder) => {
    const name = folderName(folder);
    const parent = dirname(folder);
    const candidates = [
      name,
      `${name} (${folderName(parent)})`,
      `${name} (${parent})`,
    ];
    const chosen = candidates.find((c) => !taken.has(c)) ?? folder;
    taken.add(chosen);
    return chosen;
  });
}

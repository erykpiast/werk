/** The stored project list and the list the person sees (#werk-projects-list, #werk-projects-dev-self). */
import { projectNames } from "./names.ts";

export type Listed = {
  name: string;
  folder: string;
  /** The entry for werk's own checkout in dev mode. It is never stored and never removed. */
  dev: boolean;
};

export type ParsedList =
  | { ok: true; folders: string[] }
  | { ok: false; reason: string };

/** Reads the stored list. An empty text is an empty list. Any other text that is not a list of folders is refused. */
export function parseFolders(text: string): ParsedList {
  if (text.trim() === "") return { ok: true, folders: [] };
  try {
    const value = JSON.parse(text) as { folders?: unknown } | null;
    const folders = value?.folders;
    if (
      Array.isArray(folders) &&
      folders.every((f) => typeof f === "string" && f !== "")
    ) {
      return { ok: true, folders: [...new Set(folders as string[])] };
    }
    return { ok: false, reason: 'it has no "folders" list of paths' };
  } catch (error) {
    return { ok: false, reason: `it is not JSON (${String(error)})` };
  }
}

export function serializeFolders(folders: readonly string[]): string {
  return `${JSON.stringify({ folders }, null, 2)}\n`;
}

export function withFolder(
  stored: readonly string[],
  folder: string,
): string[] {
  return stored.includes(folder) ? [...stored] : [...stored, folder];
}

export function withoutFolder(
  stored: readonly string[],
  folder: string,
): string[] {
  return stored.filter((f) => f !== folder);
}

/** The list the person sees: the dev entry first when there is one, then the stored folders in order. */
export function listProjects(
  stored: readonly string[],
  devSelf?: string,
): Listed[] {
  const rest = stored.filter((f) => f !== devSelf);
  const folders = devSelf === undefined ? rest : [devSelf, ...rest];
  const names = projectNames(folders);
  return folders.map((folder, i) => ({
    name: names[i] as string,
    folder,
    dev: folder === devSelf,
  }));
}

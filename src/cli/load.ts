/** Loads every verb module that werk's own file list names. Importing a module registers its verb (#werk-dist-own-list). */
import { ownFiles, type VerbModule } from "../own/own.ts";

export async function loadVerbs(
  modules: readonly VerbModule[] = ownFiles().verbs,
): Promise<string[]> {
  const loaded: string[] = [];
  for (const { name, load } of modules) {
    await load();
    loaded.push(name);
  }
  return loaded;
}

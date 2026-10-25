/** Loads every verb module in a folder. Importing a module registers its verb. */
import { join } from "node:path";

export const VERBS_DIR = join(import.meta.dir, "..", "verbs");

/** The files of a verb folder that are verb modules: every .ts file except the tests. */
export async function loadVerbs(dir: string = VERBS_DIR): Promise<string[]> {
  const loaded: string[] = [];
  const files = [...new Bun.Glob("*.ts").scanSync(dir)]
    .filter((name) => !name.endsWith(".test.ts"))
    .sort();
  for (const name of files) {
    await import(join(dir, name));
    loaded.push(name);
  }
  return loaded;
}

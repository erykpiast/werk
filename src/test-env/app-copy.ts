import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const CONFIG = [
  "package.json",
  "tsconfig.json",
  "bunfig.toml",
  "biome.json",
  "vite.config.ts",
];

/**
 * A copy of the werk app in `dest`, for a test that edits the source
 * (#werk-test-app-copy). It holds the server source, the client source and the
 * build and type configuration. The installed packages are linked to the checkout's, except
 * each copy keeps its own Vite dependency cache. Returns the copy's cli path.
 */
export function copyApp(dest: string): string {
  mkdirSync(dest, { recursive: true });
  cpSync(join(ROOT, "src"), join(dest, "src"), { recursive: true });
  cpSync(join(ROOT, "client"), join(dest, "client"), { recursive: true });
  for (const name of CONFIG) {
    if (existsSync(join(ROOT, name)))
      cpSync(join(ROOT, name), join(dest, name));
  }
  const modules = join(dest, "node_modules");
  mkdirSync(modules, { recursive: true });
  for (const name of readdirSync(join(ROOT, "node_modules"))) {
    if (name === ".vite") continue;
    symlinkSync(join(ROOT, "node_modules", name), join(modules, name));
  }
  return join(dest, "src", "cli.ts");
}

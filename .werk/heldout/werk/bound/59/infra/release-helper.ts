/** Builds the release in a throwaway copy of the app, so the checkout's dist folder is not touched. */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const CHECKOUT = resolve(import.meta.dirname, "..", "..");
export const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
export const HERE = `${process.platform}-${process.arch}`;

export function buildRelease() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-rel-")));
  const app = join(root, "app");
  const out = join(root, "out");
  mkdirSync(app);
  for (const d of ["src", "client"]) cpSync(join(CHECKOUT, d), join(app, d), { recursive: true });
  for (const f of ["vite.config.ts", "package.json", "tsconfig.json", "bunfig.toml", ".bun-version"]) {
    cpSync(join(CHECKOUT, f), join(app, f));
  }
  mkdirSync(join(app, "node_modules"));
  for (const name of readdirSync(join(CHECKOUT, "node_modules"))) {
    if (name === ".vite") continue;
    symlinkSync(join(CHECKOUT, "node_modules", name), join(app, "node_modules", name));
  }
  const built = spawnSync("bun", ["src/release/build.ts", out], {
    cwd: app,
    encoding: "utf8",
  });
  return { root, app, out, built };
}

/** A new empty project folder (a git repository, as werk needs) that holds only a copy of the executable. */
export function emptyFolderWith(root: string, exe: string) {
  const dir = mkdtempSync(join(root, "empty-"));
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  const copy = join(dir, "werk");
  cpSync(exe, copy);
  return { dir, copy };
}

/** A search list with no Bun in it. */
export const NO_BUN_PATH = "/usr/bin:/bin";

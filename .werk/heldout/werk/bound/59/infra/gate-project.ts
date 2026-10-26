/** A throwaway copy of the files that `make test-coverage` and `make test` need, with its own list of pure files. */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const CHECKOUT = resolve(import.meta.dirname, "..", "..");

export function makeGateProject(pure: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-gate-"));
  for (const name of [
    "Makefile",
    "package.json",
    "bun.lock",
    "bunfig.toml",
    ".bun-version",
    "tsconfig.json",
  ]) {
    cpSync(join(CHECKOUT, name), join(dir, name));
  }
  mkdirSync(join(dir, "src", "test"), { recursive: true });
  for (const name of ["coverage-gate.ts", "coverage-report.ts"]) {
    cpSync(join(CHECKOUT, "src/test", name), join(dir, "src/test", name));
  }
  writeFileSync(
    join(dir, "src/test/pure-files.ts"),
    `export const PURE_FILES: readonly string[] = ${JSON.stringify(pure)};\n`,
  );
  mkdirSync(join(dir, "src", "test-env"), { recursive: true });
  for (const name of readdirSync(join(CHECKOUT, "src/test-env"))) {
    if (!name.includes(".test.")) {
      cpSync(join(CHECKOUT, "src/test-env", name), join(dir, "src/test-env", name));
    }
  }
  cpSync(join(CHECKOUT, "fake"), join(dir, "fake"), { recursive: true });
  // Each package links to the checkout's. The install stamp is the copy's own, so make does not install.
  mkdirSync(join(dir, "node_modules"));
  for (const name of readdirSync(join(CHECKOUT, "node_modules"))) {
    if (name === ".vite" || name === ".install-stamp") continue;
    symlinkSync(join(CHECKOUT, "node_modules", name), join(dir, "node_modules", name));
  }
  writeFileSync(join(dir, "node_modules/.install-stamp"), "");
  return dir;
}

export function put(dir: string, file: string, text: string): void {
  const path = join(dir, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function has(dir: string, file: string): boolean {
  return existsSync(join(dir, file));
}

export async function make(dir: string, target: string) {
  const proc = Bun.spawn(["make", target], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CI: "true" },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out, err, code, all: `${out}\n${err}` };
}

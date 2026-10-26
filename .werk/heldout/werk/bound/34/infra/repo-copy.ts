import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyApp } from "../../src/test-env/app-copy.ts";

const ROOT = join(import.meta.dirname, "..", "..");

/** A copy of the checkout that `make` runs in: sources, make file, pinned Bun, fake agent. */
export function repoCopy(): { dir: string; dispose: () => void } {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-copy-"));
  const dir = join(root, "app");
  copyApp(dir);
  for (const name of ["Makefile", ".bun-version", "bun.lock"])
    cpSync(join(ROOT, name), join(dir, name));
  cpSync(join(ROOT, "fake"), join(dir, "fake"), { recursive: true });
  writeFileSync(join(dir, "node_modules", ".install-stamp"), "");
  return { dir, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

export async function sh(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, code, all: stdout + stderr };
}

/**
 * A lean checkout for `make`: the make file, the pinned Bun, the test setup and the coverage gate,
 * but none of werk's own tests, so a run takes seconds. The pure file list is the copy's own.
 */
export function leanCopy(pureFiles: string[]): { dir: string; write: (path: string, text: string) => void; dispose: () => void } {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-lean-"));
  const dir = join(root, "app");
  mkdirSync(join(dir, "src", "test-env"), { recursive: true });
  mkdirSync(join(dir, "src", "test"), { recursive: true });
  for (const name of ["package.json", "bunfig.toml", "tsconfig.json", "Makefile", ".bun-version", "bun.lock"])
    cpSync(join(ROOT, name), join(dir, name));
  cpSync(join(ROOT, "fake"), join(dir, "fake"), { recursive: true });
  cpSync(join(ROOT, "src", "fake-agent"), join(dir, "src", "fake-agent"), { recursive: true });
  for (const f of ["env.ts", "preload.ts", "dom.ts"])
    cpSync(join(ROOT, "src", "test-env", f), join(dir, "src", "test-env", f));
  for (const f of ["coverage-gate.ts", "coverage-report.ts"])
    cpSync(join(ROOT, "src", "test", f), join(dir, "src", "test", f));
  const modules = join(dir, "node_modules");
  mkdirSync(modules);
  for (const name of readdirSync(join(ROOT, "node_modules")))
    symlinkSync(join(ROOT, "node_modules", name), join(modules, name));
  writeFileSync(join(modules, ".install-stamp"), "");
  const write = (path: string, text: string) => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  write("src/test/pure-files.ts", `export const PURE_FILES: readonly string[] = ${JSON.stringify(pureFiles)};\n`);
  return { dir, write, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

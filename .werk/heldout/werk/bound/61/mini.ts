/** A small werk-like project for the coverage gate steps: the real Makefile, scripts and gate, a chosen pure-file list. */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..");

export type Mini = {
  dir: string;
  write(path: string, text: string): void;
  list(files: string[]): void;
  make(target: string): Promise<{ code: number; out: string }>;
  dispose(): void;
};

export function mini(): Mini {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-mini-"));
  for (const name of ["Makefile", "package.json", "bunfig.toml", ".bun-version", "bun.lock"]) {
    cpSync(join(ROOT, name), join(dir, name), { preserveTimestamps: true });
  }
  const copyNoTests = (from: string, to: string) => {
    mkdirSync(to, { recursive: true });
    for (const e of readdirSync(from, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name === "fixtures") continue;
        copyNoTests(join(from, e.name), join(to, e.name));
      } else if (!e.name.includes(".test.")) {
        cpSync(join(from, e.name), join(to, e.name));
      }
    }
  };
  copyNoTests(join(ROOT, "src/test"), join(dir, "src/test"));
  copyNoTests(join(ROOT, "src/test-env"), join(dir, "src/test-env"));
  cpSync(join(ROOT, "fake"), join(dir, "fake"), { recursive: true });
  mkdirSync(join(dir, "node_modules"));
  for (const n of readdirSync(join(ROOT, "node_modules"))) {
    if (n === ".vite") continue;
    symlinkSync(join(ROOT, "node_modules", n), join(dir, "node_modules", n));
  }
  // Keep the install stamp newer than package.json so make does not reinstall.
  const stamp = join(dir, "node_modules/.install-stamp");
  if (existsSync(join(ROOT, "node_modules/.install-stamp"))) {
    const later = new Date(Date.now() + 1000);
    utimesSync(join(ROOT, "node_modules/.install-stamp"), later, later);
  }
  void stamp;
  const m: Mini = {
    dir,
    write(path, text) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    },
    list(files) {
      m.write("src/test/pure-files.ts", `export const PURE_FILES: readonly string[] = ${JSON.stringify(files)};\n`);
    },
    async make(target) {
      const p = Bun.spawn(["make", target], { cwd: dir, stdout: "pipe", stderr: "pipe", env: { ...process.env, CI: "true" } });
      const [o, e, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      return { code, out: o + e };
    },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return m;
}

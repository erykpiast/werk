import { expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PURE_FILES } from "../src/test/pure-files.ts";

const ROOT = join(import.meta.dir, "..");

function copyRepo(): string {
  const dest = join(mkdtempSync(join(tmpdir(), "heldout-01-")), "app");
  cpSync(join(ROOT, "src"), join(dest, "src"), { recursive: true });
  cpSync(join(ROOT, "fake"), join(dest, "fake"), { recursive: true });
  for (const name of [
    "Makefile",
    "package.json",
    "bun.lock",
    "bunfig.toml",
    "tsconfig.json",
    "biome.json",
    ".bun-version",
    "playwright.config.ts",
  ]) {
    if (existsSync(join(ROOT, name))) cpSync(join(ROOT, name), join(dest, name));
  }
  symlinkSync(join(ROOT, "node_modules"), join(dest, "node_modules"));
  return dest;
}

async function make(dir: string, target: string) {
  const child = Bun.spawn(["make", target], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, out: stdout + stderr, code };
}

test("make test, make test-coverage, and a missing own test file", async () => {
  const dir = copyRepo();
  try {
    const unit = await make(dir, "test");
    expect(unit.code).toBe(0);
    expect(unit.out).toMatch(/\d+ pass/);
    expect(unit.out).toMatch(/0 fail/);
    // no coverage check: no gate lines of the "ok   100.0%  file" form
    expect(unit.out).not.toMatch(/^ok\s+[\d.]+%\s+src\//m);

    const cov = await make(dir, "test-coverage");
    expect(cov.code).toBe(0);
    for (const file of PURE_FILES) {
      const re = new RegExp(
        `^\\S+\\s+[\\d.]+%\\s+${file.replace(/[.]/g, "\\.")}`,
        "m",
      );
      expect(cov.out).toMatch(re);
    }

    rmSync(join(dir, "src/map/thread.test.ts"));
    const broken = await make(dir, "test-coverage");
    expect(broken.out).toMatch(/\s0(\.0)?%\s+src\/map\/thread\.ts/);
    expect(broken.code).not.toBe(0);
    expect(broken.out).toContain("src/map/thread.test.ts");

    const again = await make(dir, "test");
    expect(again.code).toBe(0);
    expect(again.out).not.toMatch(/^\S+\s+[\d.]+%\s+src\/map\/thread\.ts/m);
  } finally {
    rmSync(join(dir, ".."), { recursive: true, force: true });
  }
}, 300000);

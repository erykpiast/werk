import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PURE_FILES } from "../src/test/pure-files.ts";

const CHECKOUT = resolve(import.meta.dirname, "..");

/** The copy keeps the checkout untouched; node_modules comes along so make installs nothing. */
function copyTree(): string {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-01-"));
  // rsync keeps the relative links inside node_modules intact.
  const copied = Bun.spawnSync(
    ["rsync", "-a", "--exclude", ".git", "--exclude", ".werk-heldout", "--exclude", "coverage", "--exclude", "test-results", `${CHECKOUT}/`, `${root}/`],
  );
  if (copied.exitCode !== 0) throw new Error(`rsync failed: ${copied.stderr}`);
  return root;
}

async function make(dir: string, target: string) {
  const child = Bun.spawn(["make", target], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, all: `${stdout}\n${stderr}`, code };
}

test("01.1 unit tests, then the coverage gate, then a deleted own test", async () => {
  const dir = copyTree();
  const misses: string[] = [];
  const soft = (ok: boolean, what: string) => {
    if (!ok) misses.push(what);
  };
  try {
    const t = await make(dir, "test");
    soft(t.code === 0, `make test exits 0 (got ${t.code})`);
    soft(
      /\d+ pass/.test(t.all) && /0 fail/.test(t.all),
      "make test reports pass counts",
    );
    soft(
      !/FAIL\s+[\d.]+%/.test(t.all) && !/Uncovered Line/.test(t.all),
      "make test has no coverage check",
    );

    const c = await make(dir, "test-coverage");
    for (const file of PURE_FILES) {
      const re = new RegExp(
        `(ok|FAIL)\\s+[\\d.]+%\\s+${file.replace(/[.]/g, "\\.")}`,
      );
      soft(re.test(c.all), `coverage line for ${file}`);
    }
    soft(
      c.code === 0,
      `make test-coverage passes (exit ${c.code}; FAIL lines: ${c.all
        .split("\n")
        .filter((l) => l.startsWith("FAIL"))
        .join(" | ")})`,
    );

    expect(PURE_FILES).toContain("src/map/thread.ts");
    rmSync(join(dir, "src/map/thread.test.ts"));
    expect(existsSync(join(dir, "src/map/thread.test.ts"))).toBe(false);
    const c2 = await make(dir, "test-coverage");
    soft(
      /FAIL\s+0\.0%\s+src\/map\/thread\.ts/.test(c2.all),
      "0% for the file without its test",
    );
    soft(
      c2.all.includes("src/map/thread.test.ts"),
      "names the missing test file",
    );
    soft(c2.code !== 0, "coverage command fails");
    const t2 = await make(dir, "test");
    soft(
      t2.code === 0 || /thread/.test(t2.all) === false,
      `make test still passes (exit ${t2.code})`,
    );
    soft(
      !/missing test file/.test(t2.all),
      "make test shows no coverage failure",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  expect(misses).toEqual([]);
}, 900000);

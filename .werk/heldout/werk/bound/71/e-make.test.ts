// Held-out binder E: step 69.5, `make e2e` on a copy of the checkout.
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECKOUT = join(import.meta.dir, "..");

function walkPngs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkPngs(p));
    else if (e.name.endsWith(".png")) out.push(p);
  }
  return out;
}

test("69.5", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-e-make-")));
  try {
    const copy = join(root, "werk");
    const sync = Bun.spawnSync(
      [
        "rsync",
        "-a",
        "--exclude=.werk-heldout",
        "--exclude=test-results",
        "--exclude=node_modules",
        "--exclude=.git",
        `${CHECKOUT}/`,
        `${copy}/`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(sync.exitCode).toBe(0);
    symlinkSync(join(CHECKOUT, "node_modules"), join(copy, "node_modules"));
    const logOf = (dir: string) => {
      const f = join(dir, ".werk", "log.jsonl");
      return existsSync(f) ? readFileSync(f, "utf8") : null;
    };
    const checkoutBefore = logOf(CHECKOUT);
    const copyBefore = logOf(copy);

    const env = { ...process.env, CI: "1" } as Record<string, string>;
    // The preload's env is the cleaned test env; make runs playwright, whose harness cleans again.
    const run = Bun.spawn(["make", "e2e"], { cwd: copy, env, stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text()]);
    await run.exited;
    const text = out + err;

    // A result for each spec: list reporter lines with a pass or fail mark.
    const results = text.split("\n").filter((l) => /^\s*(✓|✘|-)\s+\d+ \[/.test(l));
    const ran = results.filter((l) => /^\s*(✓|✘)/.test(l)).length;
    const summary = /(\d+) passed/.exec(text);
    expect(summary).not.toBeNull();
    expect(ran).toBeGreaterThan(0);
    // Real server on a copy of the fixture project: the spec harness serves e2e/fixtures/project copies.
    expect(results.some((l) => /client\.e2e\.ts/.test(l))).toBe(true);

    const testDirs = readdirSync(join(copy, "test-results"), { withFileTypes: true }).filter((d) => d.isDirectory());
    const withPng = testDirs.filter((d) => walkPngs(join(copy, "test-results", d.name)).length > 0);
    const noPng = testDirs.filter((d) => !withPng.includes(d)).map((d) => d.name);
    console.log("results:", results.length, "ran:", ran, "dirs:", testDirs.length, "dirs without png:", noPng);
    console.log(results.filter((l) => /harness refuses|fake agent/.test(l)).join("\n"));
    const pngCounts = withPng.map((d) => walkPngs(join(copy, "test-results", d.name)).length);
    expect({ ran, dirsWithPng: withPng.length, onePerTest: pngCounts.every((n) => n === 1) }).toEqual({
      ran,
      dirsWithPng: ran,
      onePerTest: true,
    });

    expect(logOf(CHECKOUT)).toBe(checkoutBefore);
    expect(logOf(copy)).toBe(copyBefore);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 900_000);

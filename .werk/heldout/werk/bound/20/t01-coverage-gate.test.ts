import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO } from "./helpers.ts";

const PURE = (
  readFileSync(join(REPO, "src", "test", "pure-files.ts"), "utf8").match(/"[^"]+\.ts"/g) ?? []
).map((s) => s.slice(1, -1));

/** Runs a command in the copy and returns its exit code and output. */
async function run(cwd: string, cmd: string[]) {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, text: out + err };
}

test("01.1 make test has no coverage check; make test-coverage judges each pure file and names a missing test", async () => {
  expect(PURE.length).toBeGreaterThan(5);
  // The test deletes a test file, so it works on a copy of the checkout and never on the checkout.
  const copy = mkdtempSync(join(tmpdir(), "werk-ho-cov-"));
  try {
    const tar = await run(REPO, ["sh", "-c", `git archive HEAD | tar -x -C ${copy} && cp -cR node_modules ${copy}/node_modules`]);
    expect(tar.code).toBe(0);

    const unit = await run(copy, ["make", "test"]);
    expect(unit.code).toBe(0);
    expect(unit.text).toMatch(/\d+ pass/);
    expect(unit.text).toMatch(/\b0 fail\b/);
    expect(unit.text).not.toMatch(/% Funcs|% Lines/);
    for (const file of PURE) expect(unit.text).not.toMatch(new RegExp(`^ok\\s+[\\d.]+%\\s+${file.replace(/\./g, "\\.")}$`, "m"));

    const cov = await run(copy, ["make", "test-coverage"]);
    expect(cov.code).toBe(0);
    for (const file of PURE) {
      expect(cov.text).toMatch(new RegExp(`^\\S+\\s+[\\d.]+%\\s+${file.replace(/\./g, "\\.")}`, "m"));
    }

    const victim = "src/map/thread.ts";
    expect(PURE).toContain(victim);
    unlinkSync(join(copy, "src/map/thread.test.ts"));
    const failed = await run(copy, ["make", "test-coverage"]);
    expect(failed.code).not.toBe(0);
    expect(failed.text).toMatch(/0(\.0)?%\s+src\/map\/thread\.ts/);
    expect(failed.text).toContain("src/map/thread.test.ts");

    const again = await run(copy, ["make", "test"]);
    expect(again.code).toBe(0);
    expect(again.text).not.toMatch(/^(ok|FAIL|fail)\s+[\d.]+%/m);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}, 600000);

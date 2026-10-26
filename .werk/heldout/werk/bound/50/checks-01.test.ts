import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PURE_FILES } from "../src/test/pure-files.ts";
import { copyRepo } from "./support.ts";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "werk-heldout-01-"));
  copyRepo(dir);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const make = async (target: string) => {
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
  return { code, out: out + err };
};

test(
  "01.1 the agent runs the unit tests and then the coverage gate",
  async () => {
    const unit = await make("test");
    console.log("make test exit", unit.code, unit.out.split("\n").filter((l) => /\(fail\)|error:|pass$|fail$/.test(l)).join("\n"));
    expect(unit.code).toBe(0);
    expect(unit.out).not.toMatch(/coverage/i);

    const cov = await make("test-coverage");
    console.log("make test-coverage exit", cov.code, cov.out.split("\n").slice(-12).join("\n"));
    for (const file of PURE_FILES) {
      const line = cov.out
        .split("\n")
        .find((l) => l.includes(file) && /\d+(\.\d+)?\s*%/.test(l) && !l.includes("|"));
      expect(line, `a gate line for ${file}`).toBeDefined();
    }
    expect(cov.code).toBe(0);

    const victim = "src/toolchain.test.ts";
    expect(PURE_FILES).toContain("src/toolchain.ts");
    expect(existsSync(join(dir, victim))).toBe(true);
    rmSync(join(dir, victim));
    const after = await make("test-coverage");
    console.log("after delete exit", after.code, after.out.split("\n").filter((l) => l.includes("toolchain")).join("\n"));
    const gateLine = after.out
      .split("\n")
      .find((l) => l.includes("src/toolchain.ts") && !l.includes("|"));
    expect(gateLine).toMatch(/\b0(\.0+)?\s*%/);
    expect(after.code).not.toBe(0);
    expect(after.out).toContain(victim);
    const unit2 = await make("test");
    expect(unit2.code).toBe(0);
    expect(unit2.out).not.toMatch(/coverage/i);
  },
  1_800_000,
);

// Steps that change the repository run in a fresh copy of HEAD, never in the checkout.
import { expect, test } from "bun:test";
import { copyFileSync, readFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";

function copy(): string {
  const r = Bun.spawnSync(["sh", join(import.meta.dir, "copy-repo.sh")], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString().trim();
}

function make(dir: string, target: string) {
  const r = Bun.spawnSync(["make", target], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

test("01.1", () => {
  const dir = copy();
  try {
    const t1 = make(dir, "test");
    console.log(t1.out.split("\n").slice(-8).join("\n"));
    expect(t1.code).toBe(0);
    expect(t1.out).toMatch(/\d+ pass/);
    expect(t1.out).not.toMatch(/pure files|% *(scripts|src|web)\//);
    const c1 = make(dir, "test-coverage");
    console.log(c1.out);
    const list = readFileSync(join(dir, "pure-files.txt"), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
    for (const file of list) expect(c1.out).toMatch(new RegExp(`\\d+(\\.\\d+)?%\\s+${file.replaceAll(".", "\\.")}`));
    expect(c1.code).toBe(0);
    const pure = list[0] as string;
    const own = pure.replace(/\.ts$/, ".test.ts");
    unlinkSync(join(dir, own));
    const c2 = make(dir, "test-coverage");
    console.log(c2.out);
    const line = c2.out.split("\n").find((l) => l.includes(` ${pure}`)) ?? "";
    expect(line).toMatch(/\b0(\.0+)?%/);
    expect(c2.code).not.toBe(0);
    expect(c2.out).toContain(own);
    const t2 = make(dir, "test");
    console.log(t2.out.split("\n").slice(-8).join("\n"));
    expect(t2.code).toBe(0);
    expect(t2.out).not.toMatch(/coverage/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 600000);

test("19.5", () => {
  const dir = copy();
  try {
    const link = join(dir, ".claude/agents/test-scope.md");
    const c1 = make(dir, "check");
    console.log(c1.out.split("\n").slice(-15).join("\n"));
    expect(c1.code).toBe(0);
    unlinkSync(link);
    copyFileSync(join(dir, "src/agent/subagents/test-scope.md"), link);
    const c2 = make(dir, "check");
    console.log(c2.out.split("\n").slice(-40).join("\n"));
    expect(c2.code).not.toBe(0);
    expect(c2.out).toContain("test-scope");
    unlinkSync(link);
    symlinkSync("../../src/agent/subagents/test-scope.md", link);
    const c3 = make(dir, "check");
    console.log(c3.out.split("\n").slice(-15).join("\n"));
    expect(c3.code).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 1200000);

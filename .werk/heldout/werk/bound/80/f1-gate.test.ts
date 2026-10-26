import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function make(cwd: string, target: string) {
  const r = Bun.spawnSync(["make", target], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, text: r.stdout.toString() + r.stderr.toString() };
}

test("01.1 unit tests, then coverage gate, then deleted test file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "werk-gate-"));
  try {
    const rs = Bun.spawnSync(
      ["rsync", "-a", "--exclude", ".git", "--exclude", "node_modules", "--exclude", ".werk-heldout", "--exclude", "test-results", `${root}/`, `${dir}/`],
    );
    expect(rs.exitCode).toBe(0);
    const pure = (await Bun.file(join(dir, "pure-files.txt")).text())
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"));

    const t = make(dir, "test");
    console.log("make test tail:", t.text.slice(-600));
    expect(t.code).toBe(0);
    expect(t.text).not.toMatch(/coverage/i);

    const c = make(dir, "test-coverage");
    console.log("make test-coverage tail:", c.text.slice(-800));
    for (const f of pure) expect(c.text).toMatch(new RegExp(`\\d+(\\.\\d+)?%\\s+${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    expect(c.code).toBe(0);

    const victim = "src/cli/card-id.ts";
    const own = victim.replace(/\.ts$/, ".test.ts");
    expect(pure).toContain(victim);
    expect(existsSync(join(dir, own))).toBe(true);
    rmSync(join(dir, own));
    const c2 = make(dir, "test-coverage");
    console.log("coverage after delete:", c2.text.split("\n").filter((l) => l.includes(victim) || l.includes("pure files")).join("\n"));
    const line = c2.text.split("\n").find((l) => l.includes(victim)) ?? "";
    expect(line).toContain("0%");
    expect(c2.code).not.toBe(0);
    expect(c2.text).toContain(own);

    const t2 = make(dir, "test");
    console.log("make test after delete tail:", t2.text.slice(-300));
    expect(t2.code).toBe(0);
    expect(t2.text).not.toMatch(/coverage/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 1_500_000);

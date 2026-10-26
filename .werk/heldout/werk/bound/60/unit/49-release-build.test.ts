import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..");

test("49.1 the release build makes four executables with a matching checksum each", () => {
  const root = mkdtempSync(join(tmpdir(), "werk-49-build-"));
  try {
    const out = join(root, "out");
    const built = Bun.spawnSync(["bun", "src/release/build.ts", out], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
    expect(built.exitCode, built.stderr.toString()).toBe(0);
    const names = readdirSync(out);
    for (const p of ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]) {
      const file = join(out, `werk-${p}`);
      expect(existsSync(file)).toBe(true);
      const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
      const sum = readFileSync(`${file}.sha256`, "utf8");
      expect(sum.split(/\s+/)[0]).toBe(digest);
      expect(sum).toContain(`werk-${p}`);
    }
    expect(names.filter((n) => /^werk-[a-z0-9-]+$/.test(n))).toHaveLength(4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 600000);

// Held-out step 01.1: make test and make test-coverage, on a copy of the checkout.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECKOUT = join(import.meta.dir, "..");
const root = realpathSync(mkdtempSync(join(tmpdir(), "heldout-01-")));
const copy = join(root, "werk");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const sh = (cmd: string[], cwd = copy) => {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
};

test(
  "01.1 make test, make test-coverage, and a deleted own test file",
  () => {
    expect(sh(["rsync", "-a", "--exclude", "node_modules", "--exclude", ".werk-heldout", "--exclude", ".git", `${CHECKOUT}/`, `${copy}/`], CHECKOUT).code).toBe(0);
    expect(sh(["cp", "-cRp", join(CHECKOUT, "node_modules"), join(copy, "node_modules")], CHECKOUT).code).toBe(0);

    const t1 = sh(["make", "test"]);
    console.log(t1.out.split("\n").slice(-6).join("\n"));
    expect(t1.code).toBe(0);
    expect(t1.out).toMatch(/\d+ pass/);
    expect(t1.out).not.toMatch(/% Lines|% Funcs|under 90%|coverage/i);

    const pure = readFileSync(join(copy, "pure-files.txt"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
    const c1 = sh(["make", "test-coverage"]);
    console.log(c1.out);
    for (const file of pure) {
      const lines = c1.out.split("\n").filter((l) => l.includes(file) && /\d+(\.\d+)?%/.test(l));
      expect(lines.length).toBe(1);
    }
    expect(c1.code).toBe(0);

    const victim = "src/map/find.ts";
    expect(pure).toContain(victim);
    rmSync(join(copy, "src/map/find.test.ts"));
    const c2 = sh(["make", "test-coverage"]);
    console.log(c2.out);
    const line = c2.out.split("\n").find((l) => l.includes(victim) && /%/.test(l)) ?? "";
    expect(line).toMatch(/\b0(\.0+)?%/);
    expect(c2.code).not.toBe(0);
    expect(c2.out).toContain("src/map/find.test.ts");

    const t2 = sh(["make", "test"]);
    console.log(t2.out.split("\n").slice(-6).join("\n"));
    expect(t2.code).toBe(0);
    expect(t2.out).not.toMatch(/under 90%|coverage/i);
  },
  600000,
);

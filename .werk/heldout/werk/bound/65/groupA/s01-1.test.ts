import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, sh } from "./clone.ts";

test("01.1 unit tests and the coverage gate", () => {
  const { dir, done } = cloneCheckout();
  try {
    const t1 = sh(dir, ["make", "test"]);
    console.log("[make test #1] exit", t1.code, t1.out.slice(-400));
    expect(t1.code).toBe(0);
    expect(t1.out).not.toMatch(/% Lines|% Funcs|pure files, \d+ under/);

    const c1 = sh(dir, ["make", "test-coverage"]);
    console.log("[make test-coverage #1] exit", c1.code, c1.out.slice(-3000));
    const list = sh(dir, ["cat", "pure-files.txt"]).out.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    for (const f of list) expect(c1.out.split("\n").filter((l) => l.endsWith(` ${f}`) && /\d+(\.\d+)?%/.test(l)).length).toBe(1);
    expect(c1.code).toBe(0);

    rmSync(join(dir, "web/escape.test.ts"));
    const c2 = sh(dir, ["make", "test-coverage"]);
    console.log("[make test-coverage #2] exit", c2.code, c2.out.split("\n").filter((l) => /escape/.test(l)).join("\n"), c2.out.slice(-300));
    const line = c2.out.split("\n").find((l) => l.includes("web/escape.ts")) ?? "";
    expect(line).toMatch(/\b0(\.0+)?%/);
    expect(c2.code).not.toBe(0);
    expect(c2.out).toContain("web/escape.test.ts");

    const t2 = sh(dir, ["make", "test"]);
    console.log("[make test #2] exit", t2.code, t2.out.slice(-300));
    expect(t2.code).toBe(0);
    expect(t2.out).not.toMatch(/% Lines|% Funcs|pure files, \d+ under/);
  } finally {
    done();
  }
}, 1_800_000);

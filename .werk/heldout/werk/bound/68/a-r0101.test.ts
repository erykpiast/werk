import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout } from "./a-repo-copy.ts";

test("01.1 unit tests, then the coverage gate, then a missing own test file", () => {
  const c = cloneCheckout();
  try {
    const t1 = c.sh(["make", "test"]);
    console.log("make test (1):", t1.code, t1.out.slice(-300));
    expect(t1.code).toBe(0);
    expect(t1.out).not.toMatch(/coverage|% of lines|pure files/i);

    const pure = readFileSync(join(c.dir, "pure-files.txt"), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
    const cov = c.sh(["make", "test-coverage"]);
    console.log("make test-coverage (1):", cov.code, cov.out.slice(-300));
    for (const file of pure) expect(cov.out).toMatch(new RegExp(`\\d+\\.\\d+%\\s+${file.replaceAll(".", "\\.")}`));
    expect(cov.code).toBe(0);

    const target = "src/map/tree.ts";
    expect(pure).toContain(target);
    rmSync(join(c.dir, "src/map/tree.test.ts"));
    const cov2 = c.sh(["make", "test-coverage"]);
    const line = cov2.out.split("\n").find((l) => l.includes(target)) ?? "";
    console.log("make test-coverage (2):", cov2.code, line);
    expect(line).toMatch(/0\.00%/);
    expect(cov2.code).not.toBe(0);
    expect(line).toContain("src/map/tree.test.ts");

    const t2 = c.sh(["make", "test"]);
    console.log("make test (2):", t2.code, t2.out.slice(-300));
    expect(t2.code).toBe(0);
    expect(t2.out).not.toMatch(/coverage/i);
  } finally {
    c.remove();
  }
}, 1_200_000);

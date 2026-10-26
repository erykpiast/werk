import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout } from "./a-repo-copy.ts";

test("61.4 the gate fails below 90% on a pure file and passes again", () => {
  const c = cloneCheckout();
  try {
    const target = "src/map/rollup.ts";
    const own = join(c.dir, "src/map/rollup.test.ts");
    const original = readFileSync(own, "utf8");
    // Delete every unit test of the file; one trivial test that loads the module stays.
    writeFileSync(own, `import { test } from "bun:test";\nimport "./rollup.ts";\ntest("loads", () => {});\n`);
    const t = c.sh(["make", "test"]);
    console.log("make test:", t.code, t.out.slice(-200));
    expect(t.code).toBe(0);
    const cov = c.sh(["make", "test-coverage"]);
    const line = cov.out.split("\n").find((l) => l.includes(target)) ?? "";
    console.log("make test-coverage (low):", cov.code, line);
    expect(cov.code).not.toBe(0);
    expect(line).toMatch(/FAIL\s+\d+\.\d+%\s+src\/map\/rollup\.ts/);
    const pct = Number(/(\d+\.\d+)%/.exec(line)?.[1]);
    expect(pct).toBeLessThan(90);
    writeFileSync(own, original);
    const cov2 = c.sh(["make", "test-coverage"]);
    console.log("make test-coverage (restored):", cov2.code, cov2.out.split("\n").find((l) => l.includes(target)));
    expect(cov2.code).toBe(0);
  } finally {
    c.remove();
  }
}, 1_200_000);

import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, sh } from "./clone.ts";

// src/cli/card-id.ts is on the pure-file list; its own test file is src/cli/card-id.test.ts.
test("61.4 coverage gate fails below 90% on one pure file and passes again once restored", () => {
  const { dir, done } = cloneCheckout();
  try {
    const c0 = sh(dir, ["make", "test-coverage"]);
    console.log("[baseline coverage] exit", c0.code);
    expect(c0.code).toBe(0);
    const file = "src/cli/card-id.ts";
    const testFile = join(dir, "src/cli/card-id.test.ts");
    const original = readFileSync(testFile, "utf8");
    console.log("baseline line:", c0.out.split("\n").find((l) => l.includes(file)));
    // Keep only the imports and one trivial test: the rest of the unit tests are deleted.
    const imports = original.split("\n").filter((l) => l.startsWith("import ")).join("\n");
    writeFileSync(testFile, `${imports}\n\ntest("kept", () => { expect(1).toBe(1); });\n`);
    const t = sh(dir, ["make", "test"]);
    console.log("[make test after deletion] exit", t.code, t.out.slice(-300));
    expect(t.code).toBe(0);
    const c1 = sh(dir, ["make", "test-coverage"]);
    const line = c1.out.split("\n").find((l) => l.includes(file)) ?? "";
    console.log("[coverage after deletion] exit", c1.code, "line:", line);
    expect(c1.code).not.toBe(0);
    const pct = Number(/(\d+(?:\.\d+)?)%/.exec(line)?.[1] ?? "NaN");
    expect(pct).toBeLessThan(90);
    writeFileSync(testFile, original);
    const c2 = sh(dir, ["make", "test-coverage"]);
    console.log("[coverage after restore] exit", c2.code);
    expect(c2.code).toBe(0);
  } finally {
    done();
  }
}, 1_800_000);

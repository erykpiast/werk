// Held-out steps 01.1 and 61.4: make test and make test-coverage on a clone of the checkout.
import { expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, make } from "./a-clone.ts";

const LONG = 1_800_000;

function pureList(dir: string): string[] {
  return readFileSync(join(dir, "pure-files.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

test(
  "01.1 the agent runs the unit tests and then the coverage gate",
  () => {
    const c = cloneCheckout();
    try {
      const unit = make(c.dir, "test");
      console.log("make test exit", unit.code, unit.out.slice(-600));
      expect(unit.code).toBe(0);
      expect(unit.out).not.toMatch(/pure files,|under 90%|% of lines/);

      const cov = make(c.dir, "test-coverage");
      console.log("make test-coverage exit", cov.code, cov.out.slice(-1500));
      const files = pureList(c.dir);
      for (const file of files) {
        const lines = cov.out.split("\n").filter((l) => new RegExp(`\\d+(\\.\\d+)?%\\s+${file.replace(/[.]/g, "\\.")}(\\s|$)`).test(l));
        expect({ file, lines: lines.length }).toEqual({ file, lines: 1 });
      }
      expect(cov.code).toBe(0);

      rmSync(join(c.dir, "src/cli/card-id.test.ts"));
      const cov2 = make(c.dir, "test-coverage");
      console.log("second make test-coverage exit", cov2.code, cov2.out.slice(-1500));
      const line = cov2.out.split("\n").find((l) => /src\/cli\/card-id\.ts/.test(l)) ?? "";
      console.log("line:", line);
      expect(line).toMatch(/\b0(\.0+)?%/);
      expect(cov2.code).not.toBe(0);
      expect(cov2.out).toContain("src/cli/card-id.test.ts");

      const unit2 = make(c.dir, "test");
      console.log("make test again exit", unit2.code, unit2.out.slice(-400));
      expect(unit2.code).toBe(0);
      expect(unit2.out).not.toMatch(/pure files,|under 90%|missing own test file/);
    } finally {
      c.done();
    }
  },
  LONG,
);

test(
  "61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above",
  () => {
    const c = cloneCheckout();
    try {
      const base = make(c.dir, "test-coverage");
      console.log("baseline coverage exit", base.code);
      expect(base.code).toBe(0);

      const testFile = join(c.dir, "src/cli/args.test.ts");
      const original = readFileSync(testFile, "utf8");
      // Keep the imports, helpers and the first test only.
      writeFileSync(testFile, `${original.split("\n").slice(0, 27).join("\n")}\n`);

      const unit = make(c.dir, "test");
      console.log("make test exit", unit.code, unit.out.slice(-400));
      expect(unit.code).toBe(0);

      const cov = make(c.dir, "test-coverage");
      const line = cov.out.split("\n").find((l) => /src\/cli\/args\.ts/.test(l)) ?? "";
      console.log("coverage exit", cov.code, "line:", line);
      expect(cov.code).not.toBe(0);
      const pct = Number(/([\d.]+)%/.exec(line)?.[1]);
      expect(pct).toBeLessThan(90);
      expect(pct).toBeGreaterThan(0);

      writeFileSync(testFile, original);
      const cov2 = make(c.dir, "test-coverage");
      console.log("restored coverage exit", cov2.code, cov2.out.split("\n").find((l) => /src\/cli\/args\.ts/.test(l)));
      expect(cov2.code).toBe(0);
    } finally {
      c.done();
    }
  },
  LONG,
);

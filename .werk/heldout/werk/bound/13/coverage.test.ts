// Held-out step 01.1: make test and make test-coverage on a copy of the checkout.
import { afterAll, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { make, repoCopy } from "./repo-copy.ts";

const copy = repoCopy();
afterAll(() => copy.remove());

test(
  "01.1 the agent runs the unit tests and then the coverage gate",
  () => {
    const list = readFileSync(join(copy.dir, "pure-files.txt"), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
    expect(list.length).toBeGreaterThan(0);

    const unit = make(copy.dir, "test");
    expect(unit.code).toBe(0);
    expect(unit.out).toMatch(/\d+ pass/);
    expect(unit.out).not.toMatch(/% Lines|coverage|pure files/i);

    const gate = make(copy.dir, "test-coverage");
    for (const file of list) expect(gate.out).toMatch(new RegExp(`\\d+\\.\\d+%\\s+${file.replace(/[.]/g, "\\.")}`));
    expect(gate.code).toBe(0);

    const target = "src/cli/card-id.ts";
    expect(list).toContain(target);
    rmSync(join(copy.dir, "src/cli/card-id.test.ts"));
    const again = make(copy.dir, "test-coverage");
    const line = again.out.split("\n").find((each) => each.includes(` ${target}`)) as string;
    expect(line).toMatch(/\b0\.00%/);
    expect(again.code).not.toBe(0);
    expect(line).toContain("card-id.test.ts");

    const unitAgain = make(copy.dir, "test");
    expect(unitAgain.code).toBe(0);
    expect(unitAgain.out).not.toMatch(/coverage|pure files/i);
  },
  { timeout: 900_000 },
);

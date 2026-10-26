// Steps 01.1 (make test, then the coverage gate) and 61.4 (the gate fails below 90% and passes again).
import { expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshClone, run, sh } from "./repo-helpers.ts";

const LONG = 1_800_000;

const pureList = (dir: string) =>
  readFileSync(join(dir, "pure-files.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lineFor = (out: string, file: string) =>
  new RegExp(`^(ok|FAIL)\\s+(\\d+(?:\\.\\d+)?)%\\s+${escape(file)}(\\s|$)`, "m").exec(out);

test(
  "01.1 make test, then make test-coverage, then a deleted own test file shows 0%",
  () => {
    const dir = freshClone("cov01");
    const t = run(["make", "test"], dir);
    console.log("make test tail:\n", t.out.slice(-600));
    expect(t.code).toBe(0);
    expect(t.out).not.toMatch(/% Lines|% Funcs|Uncovered Line|coverage/i);

    const c = run(["make", "test-coverage"], dir);
    console.log("make test-coverage:\n", c.out);
    expect(c.code).toBe(0);
    const files = pureList(dir);
    for (const f of files) expect(lineFor(c.out, f)).not.toBeNull();

    rmSync(join(dir, "src", "cli", "card-id.test.ts"));
    const c2 = run(["make", "test-coverage"], dir);
    console.log("after delete:\n", c2.out);
    const m = lineFor(c2.out, "src/cli/card-id.ts");
    expect(m).not.toBeNull();
    expect(Number(m?.[2])).toBe(0);
  },
  LONG,
);

test(
  "61.4 the coverage gate fails below 90% on a pure file and passes again after the tests come back",
  () => {
    const dir = freshClone("cov61");
    const given = run(["make", "test-coverage"], dir);
    expect(given.code).toBe(0);

    // Delete every unit test of src/cli/args.ts but the first one.
    const testFile = join(dir, "src", "cli", "args.test.ts");
    const original = readFileSync(testFile, "utf8");
    const first = original.indexOf("\ntest(");
    const second = original.indexOf("\ntest(", first + 1);
    writeFileSync(testFile, `${original.slice(0, second)}\n`);

    const t = run(["make", "test"], dir);
    console.log("make test tail:\n", t.out.slice(-400));
    expect(t.code).toBe(0);

    const c = run(["make", "test-coverage"], dir);
    console.log("make test-coverage after delete:\n", c.out);
    const m = lineFor(c.out, "src/cli/args.ts");
    console.log("args.ts line:", m?.[0]);
    expect(Number(m?.[2])).toBeLessThan(90);
    expect(c.code).not.toBe(0);
    expect(m?.[1]).toBe("FAIL");

    sh("git checkout -- src/cli/args.test.ts", dir);
    expect(readFileSync(testFile, "utf8")).toBe(original);
    const again = run(["make", "test-coverage"], dir);
    expect(again.code).toBe(0);
  },
  LONG,
);

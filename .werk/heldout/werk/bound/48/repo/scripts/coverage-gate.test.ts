// Named behaviours of the coverage gate (#werk-test-pure-list, #werk-reflink-own-test-coverage).
// Each test builds its own project in a temporary folder and removes it at the end (#werk-test-store).
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const gate = join(import.meta.dir, "coverage-gate.ts");
const projects: string[] = [];

afterEach(() => {
  for (const dir of projects.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "werk-gate-"));
  projects.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

function runGate(cwd: string): { code: number; out: string } {
  const run = Bun.spawnSync([process.execPath, gate], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode, out: run.stdout.toString() + run.stderr.toString() };
}

const pure =
  "export function sign(n: number): number {\n  if (n > 0) return 1;\n  if (n < 0) return -1;\n  return 0;\n}\n";
const fullTest = `import { expect, test } from "bun:test";
import { sign } from "./sign";
test("sign", () => {
  expect(sign(2)).toBe(1);
  expect(sign(-2)).toBe(-1);
  expect(sign(0)).toBe(0);
});
`;
const halfTest = `import { expect, test } from "bun:test";
import { sign } from "./sign";
test("sign", () => {
  expect(sign(2)).toBe(1);
});
`;

describe("coverage gate", () => {
  test("passes a listed file that its own test covers, and prints one line with its percentage", () => {
    const dir = project({ "pure-files.txt": "sign.ts\n", "sign.ts": pure, "sign.test.ts": fullTest });
    const { code, out } = runGate(dir);
    expect(out).toContain("ok    100.00%  sign.ts");
    expect(code).toBe(0);
  });

  test("fails a listed file under 90% of lines", () => {
    const dir = project({ "pure-files.txt": "sign.ts\n", "sign.ts": pure, "sign.test.ts": halfTest });
    const { code, out } = runGate(dir);
    expect(out).toMatch(/FAIL\s+\d+\.\d\d%\s+sign\.ts/);
    expect(code).toBe(1);
  });

  test("fails a listed file with no own test file and names the missing test file", () => {
    const dir = project({ "pure-files.txt": "sign.ts\n", "sign.ts": pure });
    const { code, out } = runGate(dir);
    expect(out).toContain("0.00%  sign.ts  (missing own test file sign.test.ts)");
    expect(code).toBe(1);
  });

  test("does not count lines that another file's test runs", () => {
    const caller = 'import { sign } from "./sign";\nexport const twice = (n: number) => 2 * sign(n);\n';
    const callerTest = `import { expect, test } from "bun:test";
import { twice } from "./caller";
test("twice", () => {
  expect(twice(3)).toBe(2);
  expect(twice(-3)).toBe(-2);
  expect(twice(0)).toBe(0);
});
`;
    const dir = project({
      "pure-files.txt": "caller.ts\nsign.ts\n",
      "caller.ts": caller,
      "caller.test.ts": callerTest,
      "sign.ts": pure,
    });
    const { code, out } = runGate(dir);
    expect(out).toContain("ok    100.00%  caller.ts");
    expect(out).toContain("(missing own test file sign.test.ts)");
    expect(code).toBe(1);
  });

  test("passes a listed file with no executable lines", () => {
    const dir = project({ "pure-files.txt": "types.ts\n", "types.ts": "export type Id = string;\n" });
    const { code, out } = runGate(dir);
    expect(out).toContain("ok    100.00%  types.ts  (no executable lines)");
    expect(code).toBe(0);
  });

  test("fails a listed file whose own tests fail", () => {
    const failing = `import { expect, test } from "bun:test";
import { sign } from "./sign";
test("sign", () => {
  expect(sign(2)).toBe(1);
  expect(sign(-2)).toBe(-1);
  expect(sign(0)).toBe(7);
});
`;
    const dir = project({ "pure-files.txt": "sign.ts\n", "sign.ts": pure, "sign.test.ts": failing });
    const { code, out } = runGate(dir);
    expect(out).toContain("(sign.test.ts fails)");
    expect(code).toBe(1);
  });

  test("fails a listed file that does not exist", () => {
    const dir = project({ "pure-files.txt": "gone.ts\n" });
    const { code, out } = runGate(dir);
    expect(out).toContain("gone.ts");
    expect(code).toBe(1);
  });

  test("fails when the project has no list of pure files", () => {
    const dir = project({ "sign.ts": pure });
    const { code, out } = runGate(dir);
    expect(out).toContain("No pure-files.txt");
    expect(code).toBe(1);
  });
});

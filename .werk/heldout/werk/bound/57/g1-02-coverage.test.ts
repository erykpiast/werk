import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO = join(import.meta.dir, "..");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function dropTests(dir: string) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) dropTests(p);
    else if (e.name.endsWith(".test.ts") || e.name.endsWith(".test.tsx")) rmSync(p);
  }
}

/** A copy of werk's task setup with its own list of pure files and its own files. */
function synthetic(pure: string[], files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-cov-"));
  dirs.push(dir);
  for (const f of ["Makefile", "package.json", "bun.lock", "bunfig.toml", ".bun-version", "biome.json", "tsconfig.json"]) {
    cpSync(join(REPO, f), join(dir, f));
  }
  for (const d of ["fake", "src/test-env", "src/fake-agent", "src/test"]) {
    cpSync(join(REPO, d), join(dir, d), { recursive: true });
  }
  rmSync(join(dir, "src/test/fixtures"), { recursive: true, force: true });
  dropTests(join(dir, "src"));
  writeFileSync(
    join(dir, "src/test/pure-files.ts"),
    `export const PURE_FILES: readonly string[] = ${JSON.stringify(pure)};\n`,
  );
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

async function make(dir: string, target: string) {
  const proc = Bun.spawn(["make", target], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code, all: stdout + stderr };
}

const CODE = `export function add(a: number, b: number): number {\n  return a + b;\n}\n`;
const OWN = `import { expect, test } from "bun:test";\nimport { add } from "./add.ts";\ntest("add", () => expect(add(1, 2)).toBe(3));\n`;

test("02.1 a pure file with its own full test passes at 100%", async () => {
  const dir = synthetic(["src/lib/add.ts"], { "src/lib/add.ts": CODE, "src/lib/add.test.ts": OWN });
  const r = await make(dir, "test-coverage");
  const lines = r.stdout.split("\n").filter((l) => l.includes("src/lib/add.ts") && l.includes("%") && /^(ok|FAIL)/.test(l));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("100.0%");
  expect(r.code).toBe(0);
}, 120000);

test("02.2 deleting the own test fails the file at 0% and names the test, though another test runs it", async () => {
  const dir = synthetic(["src/lib/add.ts"], {
    "src/lib/add.ts": CODE,
    "src/lib/add.test.ts": OWN,
    "src/lib/other.test.ts": `import { expect, test } from "bun:test";\nimport { add } from "./add.ts";\ntest("other", () => expect(add(2, 2)).toBe(4));\n`,
  });
  const first = await make(dir, "test-coverage");
  expect(first.stdout).toContain("100.0%");
  rmSync(join(dir, "src/lib/add.test.ts"));
  const r = await make(dir, "test-coverage");
  expect(r.all).toContain("0.0%");
  expect(r.all).toContain("src/lib/add.test.ts");
  expect(r.code).not.toBe(0);
}, 180000);

test("02.3 a pure file under 90% fails", async () => {
  const code = `export function a(): number {\n  return 1;\n}\nexport function b(): number {\n  return 2;\n}\nexport function c(): number {\n  return 3;\n}\n`;
  const dir = synthetic(["src/lib/part.ts"], {
    "src/lib/part.ts": code,
    "src/lib/part.test.ts": `import { expect, test } from "bun:test";\nimport { a } from "./part.ts";\ntest("a", () => expect(a()).toBe(1));\n`,
  });
  const r = await make(dir, "test-coverage");
  const line = r.stdout.split("\n").find((l) => l.includes("src/lib/part.ts") && /^(ok|FAIL)/.test(l));
  expect(line).toBeDefined();
  expect(line).toMatch(/\d+\.\d%/);
  expect(line).not.toContain("100.0%");
  expect(r.code).not.toBe(0);
}, 120000);

test("02.4 a types-only pure file passes", async () => {
  const dir = synthetic(["src/lib/types.ts"], {
    "src/lib/types.ts": `export type Shape = { name: string };\nexport interface Named {\n  name: string;\n}\n`,
    "src/lib/unrelated.test.ts": `import { expect, test } from "bun:test";\ntest("unit", () => expect(1).toBe(1));\n`,
  });
  const r = await make(dir, "test-coverage");
  const line = r.stdout.split("\n").find((l) => l.includes("src/lib/types.ts"));
  expect(line).toBeDefined();
  expect(line).toMatch(/^ok/);
  expect(r.code).toBe(0);
}, 120000);

test("02.5 make test never runs the gate", async () => {
  const dir = synthetic(["src/lib/add.ts"], {
    "src/lib/add.ts": CODE,
    "src/lib/unrelated.test.ts": `import { expect, test } from "bun:test";\ntest("unit", () => expect(1).toBe(1));\n`,
  });
  const r = await make(dir, "test");
  expect(r.code).toBe(0);
  expect(r.all).toContain("1 pass");
  expect(r.all).not.toContain("src/lib/add.ts");
  expect(r.all).not.toContain("missing test file");
}, 120000);

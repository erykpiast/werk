import { afterEach, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..");
const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function removeTests(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) removeTests(p);
    else if (/\.test\.tsx?$/.test(name)) rmSync(p);
  }
}

/** A trimmed copy of the checkout: its own gate, an own list of pure files, and the given files. */
function projectWith(pure: string[], files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "werk-ho-gate-"));
  made.push(root);
  for (const entry of [
    "Makefile",
    "package.json",
    "bun.lock",
    "bunfig.toml",
    "tsconfig.json",
    ".bun-version",
    "fake",
    "src",
  ]) {
    cpSync(join(CHECKOUT, entry), join(root, entry), {
      recursive: true,
      preserveTimestamps: true,
    });
  }
  removeTests(join(root, "src"));
  symlinkSync(join(CHECKOUT, "node_modules"), join(root, "node_modules"));
  writeFileSync(
    join(root, "src/test/pure-files.ts"),
    `export const PURE_FILES: readonly string[] = ${JSON.stringify(pure)};\n`,
  );
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

async function make(root: string, target: string) {
  const p = Bun.spawn(["make", target], {
    cwd: root,
    env: { ...process.env, CI: "true" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { out: out + err, code };
}

const PURE = "export function add(a: number, b: number) {\n  return a + b;\n}\nexport function sub(a: number, b: number) {\n  return a - b;\n}\n";
const FULL_TEST = 'import { expect, test } from "bun:test";\nimport { add, sub } from "./a.ts";\ntest("a", () => { expect(add(1, 2)).toBe(3); expect(sub(3, 1)).toBe(2); });\n';
const OTHER_TEST = 'import { expect, test } from "bun:test";\nimport { add, sub } from "./pure/a.ts";\ntest("o", () => { expect(add(1, 2)).toBe(3); expect(sub(3, 1)).toBe(2); });\n';

test("02.1 a pure file covered by its own test passes the gate", async () => {
  const root = projectWith(["src/pure/a.ts"], {
    "src/pure/a.ts": PURE,
    "src/pure/a.test.ts": FULL_TEST,
  });
  const r = await make(root, "test-coverage");
  const lines = r.out.split("\n").filter((l) => /^ok\s+100\.0%\s+src\/pure\/a\.ts/.test(l));
  expect(lines, r.out).toHaveLength(1);
  expect(r.code, r.out).toBe(0);
}, 120000);

test("02.2 a pure file whose own test is deleted fails even when another test runs it", async () => {
  const root = projectWith(["src/pure/a.ts"], {
    "src/pure/a.ts": PURE,
    "src/pure/a.test.ts": FULL_TEST,
    "src/other.test.ts": OTHER_TEST,
  });
  const before = await make(root, "test-coverage");
  expect(before.code, before.out).toBe(0);
  rmSync(join(root, "src/pure/a.test.ts"));
  const r = await make(root, "test-coverage");
  expect(r.out).toMatch(/FAIL\s+0\.0%\s+src\/pure\/a\.ts/);
  expect(r.out).toContain("src/pure/a.test.ts");
  expect(r.code).not.toBe(0);
}, 180000);

test("02.3 a pure file under 90% fails the gate", async () => {
  const root = projectWith(["src/pure/a.ts"], {
    "src/pure/a.ts": PURE,
    "src/pure/a.test.ts": 'import { expect, test } from "bun:test";\nimport { add } from "./a.ts";\ntest("a", () => { expect(add(1, 2)).toBe(3); });\n',
  });
  const r = await make(root, "test-coverage");
  expect(r.out).toMatch(/FAIL\s+\d+\.\d%\s+src\/pure\/a\.ts/);
  expect(r.code).not.toBe(0);
}, 120000);

test("02.4 a pure file of type declarations only passes", async () => {
  const root = projectWith(["src/pure/types.ts"], {
    "src/pure/types.ts": "export type Shape = { name: string };\nexport interface Named { name: string }\n",
    "src/other.test.ts": 'import { expect, test } from "bun:test";\ntest("o", () => { expect(1).toBe(1); });\n',
  });
  const r = await make(root, "test-coverage");
  expect(r.out).toMatch(/^ok\s+.*src\/pure\/types\.ts/m);
  expect(r.code, r.out).toBe(0);
}, 120000);

test("02.5 a plain test run never runs the gate", async () => {
  const root = projectWith(["src/pure/a.ts"], {
    "src/pure/a.ts": PURE,
    "src/other.test.ts": 'import { expect, test } from "bun:test";\ntest("o", () => { expect(1).toBe(1); });\n',
  });
  const r = await make(root, "test");
  expect(r.out).toContain("1 pass");
  expect(r.code, r.out).toBe(0);
  expect(r.out).not.toMatch(/%\s+src\/pure\/a\.ts/);
  expect(r.out).not.toContain("missing test file");
  expect(r.out).not.toContain("a.test.ts");
}, 120000);

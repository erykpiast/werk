import { afterEach, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyApp } from "../../src/test-env/app-copy.ts";

const ROOT = join(import.meta.dir, "..", "..");
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function removeTests(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) removeTests(p);
    else if (/\.(test|spec)\.tsx?$/.test(name)) rmSync(p);
  }
}

/** A copy of the app with only the given pure files and tests: a small project with a list of pure files. */
function project(opts: {
  pure: string[];
  files: Record<string, string>;
}): string {
  const root = mkdtempSync(join(tmpdir(), "heldout-02-"));
  roots.push(root);
  const app = join(root, "app");
  copyApp(app);
  for (const f of ["Makefile", ".bun-version", "bun.lock"])
    cpSync(join(ROOT, f), join(app, f));
  removeTests(join(app, "src"));
  removeTests(join(app, "client"));
  writeFileSync(join(app, "node_modules", ".install-stamp"), "");
  writeFileSync(
    join(app, "src/test/pure-files.ts"),
    `export const PURE_FILES: readonly string[] = ${JSON.stringify(opts.pure)};\n`,
  );
  for (const [path, text] of Object.entries(opts.files)) {
    mkdirSync(join(app, path, ".."), { recursive: true });
    writeFileSync(join(app, path), text);
  }
  return app;
}

async function make(app: string, target: string) {
  const p = Bun.spawn(["make", target], {
    cwd: app,
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

const ADD = `export function add(a: number, b: number): number {\n  return a + b;\n}\n`;
const ADD_TEST = `import { expect, test } from "bun:test";\nimport { add } from "./add.ts";\ntest("add", () => expect(add(1, 2)).toBe(3));\n`;

test("02.1 a pure file covered by its own test passes the gate", async () => {
  const app = project({
    pure: ["src/pure/add.ts"],
    files: { "src/pure/add.ts": ADD, "src/pure/add.test.ts": ADD_TEST },
  });
  const r = await make(app, "test-coverage");
  const lines = r.out.split("\n").filter((l) => /src\/pure\/add\.ts\s*(\(|$)/.test(l) && l.includes("%"));
  expect(lines.some((l) => l.includes("100.0%"))).toBe(true);
  expect(r.code).toBe(0);
}, 120000);

test("02.2 deleting a pure file's own test fails even when another test runs its lines", async () => {
  const app = project({
    pure: ["src/pure/add.ts"],
    files: {
      "src/pure/add.ts": ADD,
      "src/pure/add.test.ts": ADD_TEST,
      "src/other/other.test.ts": `import { expect, test } from "bun:test";\nimport { add } from "../pure/add.ts";\ntest("o", () => expect(add(2, 2)).toBe(4));\n`,
    },
  });
  const before = await make(app, "test-coverage");
  expect(before.code).toBe(0);
  expect(before.out).toContain("100.0%");
  rmSync(join(app, "src/pure/add.test.ts"));
  const r = await make(app, "test-coverage");
  expect(r.out).toMatch(/0\.0%\s+src\/pure\/add\.ts/);
  expect(r.out).toContain("src/pure/add.test.ts");
  expect(r.code).not.toBe(0);
}, 240000);

test("02.3 a pure file under 90% fails the gate and shows its percentage", async () => {
  const src = `export function a(): number {\n  return 1;\n}\nexport function b(): number {\n  return 2;\n}\nexport function c(): number {\n  return 3;\n}\nexport function d(): number {\n  return 4;\n}\n`;
  const app = project({
    pure: ["src/pure/many.ts"],
    files: {
      "src/pure/many.ts": src,
      "src/pure/many.test.ts": `import { expect, test } from "bun:test";\nimport { a } from "./many.ts";\ntest("a", () => expect(a()).toBe(1));\n`,
    },
  });
  const r = await make(app, "test-coverage");
  const m = r.out.match(/(\d+\.\d)%\s+src\/pure\/many\.ts/);
  expect(m).not.toBeNull();
  expect(Number(m?.[1])).toBeLessThan(90);
  expect(r.code).not.toBe(0);
}, 120000);

test("02.4 a pure file of type declarations only passes", async () => {
  const app = project({
    pure: ["src/pure/shape.ts"],
    files: {
      "src/pure/shape.ts": `export type Shape = { name: string };\nexport interface Named {\n  name: string;\n}\n`,
      "src/pure/add.test.ts": `import { expect, test } from "bun:test";\ntest("x", () => expect(1).toBe(1));\n`,
    },
  });
  const r = await make(app, "test-coverage");
  expect(r.out).toMatch(/ok\s+100\.0%\s+src\/pure\/shape\.ts/);
  expect(r.code).toBe(0);
}, 120000);

test("02.5 plain test run never runs the gate", async () => {
  const app = project({
    pure: ["src/pure/add.ts"],
    files: {
      "src/pure/add.ts": ADD,
      "src/other/other.test.ts": `import { expect, test } from "bun:test";\ntest("o", () => expect(1).toBe(1));\n`,
    },
  });
  const r = await make(app, "test");
  expect(r.out).toContain("1 pass");
  expect(r.out).not.toContain("src/pure/add.ts");
  expect(r.out).not.toContain("missing test file");
  expect(r.code).toBe(0);
}, 120000);

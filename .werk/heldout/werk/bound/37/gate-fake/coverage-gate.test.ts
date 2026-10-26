import { afterAll, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECKOUT = join(import.meta.dir, "..", "..");
const sandboxes: string[] = [];

function pruneTests(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) pruneTests(p);
    else if (/\.test\.tsx?$/.test(name)) rmSync(p);
  }
}

/** A copy of the checkout (never in place) whose pure list and tests are set by the scenario. */
function sandbox(pureFiles: string[], files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "werk-held-cov-"));
  sandboxes.push(dir);
  for (const name of [
    "src",
    "client",
    "fake",
    "Makefile",
    "package.json",
    "bun.lock",
    "bunfig.toml",
    ".bun-version",
    "tsconfig.json",
  ]) {
    cpSync(join(CHECKOUT, name), join(dir, name), { recursive: true });
  }
  Bun.spawnSync(["cp", "-Rc", join(CHECKOUT, "node_modules"), dir]);
  pruneTests(join(dir, "src"));
  pruneTests(join(dir, "client"));
  writeFileSync(
    join(dir, "src/test/pure-files.ts"),
    `export const PURE_FILES: readonly string[] = ${JSON.stringify(pureFiles)};\n`,
  );
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

async function make(dir: string, target: string) {
  const proc = Bun.spawn(["make", target], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CI: "true" },
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, out, err, all: out + err };
}

const PURE = "src/held/pure.ts";
const OWN = "src/held/pure.test.ts";
const PURE_SRC = `export function a(x: number) {
  return x + 1;
}
export function b(x: number) {
  return x * 2;
}
export function c(x: number) {
  if (x > 10) {
    return "big";
  }
  return "small";
}
`;
const FULL_TEST = `import { expect, test } from "bun:test";
import { a, b, c } from "./pure.ts";
test("all", () => {
  expect(a(1)).toBe(2);
  expect(b(2)).toBe(4);
  expect(c(11)).toBe("big");
  expect(c(1)).toBe("small");
});
`;
const OTHER_TEST = `import { expect, test } from "bun:test";
import { a, b, c } from "./pure.ts";
test("other runs every line", () => {
  expect(a(1)).toBe(2);
  expect(b(2)).toBe(4);
  expect(c(11)).toBe("big");
  expect(c(1)).toBe("small");
});
`;

afterAll(() => {
  for (const d of sandboxes) rmSync(d, { recursive: true, force: true });
});

test("02.1 a pure file covered by its own test passes the gate", async () => {
  const dir = sandbox([PURE], { [PURE]: PURE_SRC, [OWN]: FULL_TEST });
  const r = await make(dir, "test-coverage");
  const lines = r.out.split("\n").filter((l) => l.includes(PURE) && /%\s+src\/held\/pure\.ts/.test(l));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/100\.0%/);
  expect(r.code).toBe(0);
}, 120000);

test("02.2 a pure file whose own test is deleted fails even when another test runs its lines", async () => {
  const dir = sandbox([PURE], {
    [PURE]: PURE_SRC,
    [OWN]: FULL_TEST,
    "src/held/other.test.ts": OTHER_TEST,
  });
  const before = await make(dir, "test-coverage");
  expect(before.code).toBe(0);
  rmSync(join(dir, OWN));
  expect(existsSync(join(dir, OWN))).toBe(false);
  const r = await make(dir, "test-coverage");
  const line = r.out.split("\n").find((l) => /%\s+src\/held\/pure\.ts/.test(l)) ?? "";
  expect(line).toMatch(/\b0\.0%/);
  expect(line).toContain("pure.test.ts");
  expect(r.code).not.toBe(0);
}, 180000);

test("02.3 a pure file under 90% fails the gate", async () => {
  const dir = sandbox([PURE], {
    [PURE]: PURE_SRC,
    [OWN]: `import { expect, test } from "bun:test";
import { a } from "./pure.ts";
test("part", () => {
  expect(a(1)).toBe(2);
});
`,
  });
  const r = await make(dir, "test-coverage");
  const line = r.out.split("\n").find((l) => /%\s+src\/held\/pure\.ts/.test(l)) ?? "";
  expect(line).toMatch(/\d+\.\d%/);
  expect(Number(line.match(/(\d+\.\d)%/)?.[1])).toBeLessThan(90);
  expect(r.code).not.toBe(0);
}, 120000);

test("02.4 a pure file of type declarations only passes", async () => {
  const dir = sandbox(["src/held/types.ts"], {
    "src/held/types.ts": "export type Shape = { name: string };\nexport interface Named { name: string }\n",
    "src/held/other.test.ts": `import { expect, test } from "bun:test";
test("x", () => { expect(1).toBe(1); });
`,
  });
  const r = await make(dir, "test-coverage");
  const line = r.out.split("\n").find((l) => l.includes("src/held/types.ts") && /%/.test(l)) ?? "";
  expect(line).toMatch(/^ok/);
  expect(r.code).toBe(0);
}, 120000);

test("02.5 a plain test run never runs the gate", async () => {
  const dir = sandbox([PURE], {
    [PURE]: PURE_SRC,
    "src/held/other.test.ts": `import { expect, test } from "bun:test";
test("x", () => { expect(1).toBe(1); });
`,
  });
  expect(existsSync(join(dir, OWN))).toBe(false);
  const r = await make(dir, "test");
  expect(r.all).toMatch(/1 pass/);
  expect(r.code).toBe(0);
  expect(r.all).not.toMatch(/%\s+src\/held\/pure\.ts/);
  expect(r.all).not.toContain("missing test file");
  expect(r.all).not.toContain("pure.test.ts");
}, 120000);

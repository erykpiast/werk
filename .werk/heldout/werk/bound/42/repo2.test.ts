// 01.1 (delete test file), 61.4, 61.1 (e2e with no spec), run in the clone that repo.test.ts made.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const clone = "/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/heldout-repo-AU3QVg/clone";
async function shA(cmd: string[], env: Record<string, string | undefined> = {}) {
  const p = Bun.spawn(cmd, { cwd: clone, env: { ...process.env, ...env } as Record<string, string>, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out: out + err };
}
const T = 3_000_000;

test("[01.1] delete own test file", async () => {
  const tf = join(clone, "src/map/commit.test.ts");
  const saved = readFileSync(tf, "utf8");
  rmSync(tf);
  try {
    const c = await shA(["make", "test-coverage"]);
    console.log("COV after delete:", c.out.split("\n").filter((l) => /commit\.ts|test file|under/i.test(l)).join("\n"));
    expect(c.code).not.toBe(0);
    expect(c.out).toMatch(/0(\.0+)?%\s+src\/map\/commit\.ts/);
    expect(c.out).toContain("commit.test.ts");
    const t = await shA(["make", "test"]);
    console.log("MAKE TEST after delete tail:", t.out.split("\n").slice(-6).join("\n"));
    expect(t.code).toBe(0);
    expect(t.out.toLowerCase()).not.toContain("coverage failure");
  } finally {
    writeFileSync(tf, saved);
  }
}, T);

test("[61.4] coverage below 90", async () => {
  const tf = join(clone, "src/map/commit.test.ts");
  const saved = readFileSync(tf, "utf8");
  writeFileSync(tf, `import { expect, test } from "bun:test";\nimport * as c from "./commit.ts";\ntest("x", () => { expect(c).toBeDefined(); });\n`);
  try {
    const t = await shA(["make", "test"]);
    console.log("make test with thin tests:", t.out.split("\n").slice(-5).join("\n"));
    expect(t.code).toBe(0);
    const c = await shA(["make", "test-coverage"]);
    console.log("COV low:", c.out.split("\n").filter((l) => /commit\.ts/.test(l)).join("\n"));
    expect(c.code).not.toBe(0);
    expect(c.out).toMatch(/\d+(\.\d+)?%\s+src\/map\/commit\.ts/);
  } finally {
    writeFileSync(tf, saved);
  }
  const c2 = await shA(["make", "test-coverage"]);
  expect(c2.code).toBe(0);
}, T);

test("[61.1] e2e passes with no browser spec", async () => {
  const e2e = join(clone, "e2e");
  const hold = join(clone, "e2e-held");
  renameSync(e2e, hold);
  mkdirSync(e2e);
  try {
    const r = await shA(["make", "e2e"]);
    console.log("e2e with no spec:", r.code, r.out.split("\n").slice(-4).join("\n"));
    expect(r.code).toBe(0);
  } finally {
    rmSync(e2e, { recursive: true, force: true });
    renameSync(hold, e2e);
  }
}, T);

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PURE_FILES } from "../src/test/pure-files.ts";
import { copyRepo } from "./lib.ts";

let copy: string;
beforeAll(() => {
  copy = copyRepo();
});
afterAll(() => rmSync(copy, { recursive: true, force: true }));

async function sh(cmd: string[]) {
  const p = Bun.spawn(cmd, { cwd: copy, stdout: "pipe", stderr: "pipe", env: { ...process.env, CI: "true" } });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, code, all: `${stdout}\n${stderr}` };
}
const gateLine = (out: string, file: string) =>
  out.split("\n").find((l) => /^(ok  |FAIL)\s+\d+\.\d%\s+/.test(l) && l.includes(`%  ${file}`));
const failedTests = (out: string) => out.split("\n").filter((l) => l.startsWith("(fail)")).join(" | ");

test("01.1 the agent runs the unit tests and then the coverage gate", async () => {
  expect(existsSync(join(copy, "src/cli/args.test.ts"))).toBe(true);
  const issues: string[] = [];

  const plain = await sh(["make", "test"]);
  if (plain.code !== 0) issues.push(`make test exited ${plain.code}: ${failedTests(plain.all)}`);
  if (/% Funcs|% Lines/.test(plain.all)) issues.push("make test printed a coverage table");
  if (plain.stdout.split("\n").some((l) => /^(ok  |FAIL)\s+\d+\.\d%/.test(l))) issues.push("make test printed gate lines");

  const cov = await sh(["make", "test-coverage"]);
  if (cov.code !== 0) issues.push(`make test-coverage exited ${cov.code}: ${failedTests(cov.all)}`);
  // the gate runs after the unit run; run it alone as well so its lines can be read when the unit run failed first
  const gate = await sh(["bun", "src/test/coverage-gate.ts"]);
  const out = cov.code === 0 ? cov.stdout : gate.stdout;
  const missing = PURE_FILES.filter((f) => gateLine(out, f) === undefined);
  if (missing.length > 0) issues.push(`no gate line for ${missing.join(", ")}`);
  if (gate.code !== 0) issues.push("the gate alone failed with every test file present");

  rmSync(join(copy, "src/cli/args.test.ts"));
  const failing = await sh(["make", "test-coverage"]);
  if (failing.code === 0) issues.push("make test-coverage passed with a missing own test file");
  const gate2 = await sh(["bun", "src/test/coverage-gate.ts"]);
  const line = gateLine(failing.stdout, "src/cli/args.ts") ?? gateLine(gate2.stdout, "src/cli/args.ts");
  if (!line || !line.startsWith("FAIL") || !line.includes("0.0%") || !line.includes("src/cli/args.test.ts"))
    issues.push(`gate line for args.ts: ${line}`);
  if (gate2.code === 0) issues.push("the gate alone passed with a missing own test file");

  const again = await sh(["make", "test"]);
  if (again.code !== 0) issues.push(`make test after the deletion exited ${again.code}: ${failedTests(again.all)}`);
  if (/^FAIL\s+\d+\.\d%/m.test(again.all)) issues.push("make test showed a coverage failure after the deletion");

  expect(issues).toEqual([]);
}, 3_600_000);

// The per-file coverage check (#werk-test-pure-list, #werk-reflink-own-test-coverage).
// It runs each listed pure file's own test file alone with coverage on, keeps only that
// file's lines, and fails any file under the threshold. Run it from the project root.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatResult, judge, type LineRecord, ownTestFile, parseLcov, parsePureList, type Result } from "./coverage";

const LIST = "pure-files.txt";
const THRESHOLD = 90;

function hasExecutableLines(file: string): boolean {
  const loader = file.endsWith("x") ? "tsx" : "ts";
  const code = new Bun.Transpiler({ loader }).transformSync(readFileSync(file, "utf8"));
  return code.trim() !== "";
}

function runOwnTest(testFile: string, file: string): { record: LineRecord | undefined; failed: boolean } {
  const dir = mkdtempSync(join(tmpdir(), "werk-coverage-"));
  try {
    const run = Bun.spawnSync(
      [
        process.execPath,
        "test",
        `./${testFile}`,
        "--timeout=15000",
        "--coverage",
        "--coverage-reporter=lcov",
        `--coverage-dir=${dir}`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const lcov = join(dir, "lcov.info");
    const record = existsSync(lcov) ? parseLcov(readFileSync(lcov, "utf8")).get(file) : undefined;
    if (run.exitCode !== 0) process.stderr.write(run.stderr.toString());
    return { record, failed: run.exitCode !== 0 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function check(file: string): Result {
  if (!existsSync(file))
    return { file, percent: 0, pass: false, reason: `listed in ${LIST}, but the file does not exist` };
  const testFile = ownTestFile(file);
  const executable = hasExecutableLines(file);
  const hasOwnTest = existsSync(testFile);
  const run = executable && hasOwnTest ? runOwnTest(testFile, file) : { record: undefined, failed: false };
  return judge({
    file,
    testFile,
    threshold: THRESHOLD,
    executable,
    hasOwnTest,
    testsFailed: run.failed,
    record: run.record,
  });
}

if (!existsSync(LIST)) {
  console.error(`No ${LIST} in ${process.cwd()}. Run the coverage check from the project root.`);
  process.exit(1);
}
const files = parsePureList(readFileSync(LIST, "utf8"));
const results = files.map(check);
for (const result of results) console.log(formatResult(result));
const failed = results.filter((result) => !result.pass).length;
console.log(`${files.length} pure files, ${failed} under ${THRESHOLD}% of lines or without an own test file.`);
process.exit(failed === 0 ? 0 : 1);

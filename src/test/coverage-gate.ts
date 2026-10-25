/**
 * The coverage gate. For each pure file it runs the file's own test alone with
 * coverage on, and judges only that file's lines. Exits 1 when any file fails.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatLine,
  hasExecutableCode,
  judge,
  ownTestPath,
  uniqueFiles,
} from "./coverage-report";
import { PURE_FILES } from "./pure-files";

const root = join(import.meta.dir, "..", "..");

async function ownLcov(file: string): Promise<string | null> {
  const test = ownTestPath(file);
  if (!existsSync(join(root, test))) return null;
  const dir = await mkdtemp(join(tmpdir(), "werk-cov-"));
  try {
    const proc = Bun.spawn(
      [
        process.execPath,
        "test",
        `./${test}`,
        "--coverage",
        "--coverage-reporter=lcov",
        `--coverage-dir=${dir}`,
      ],
      { cwd: root, stdout: "ignore", stderr: "ignore" },
    );
    await proc.exited;
    const report = join(dir, "lcov.info");
    return existsSync(report) ? await readFile(report, "utf8") : "";
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function check(file: string) {
  const source = await readFile(join(root, file), "utf8").catch(() => null);
  if (source !== null && !hasExecutableCode(source)) {
    return { file, percent: 100, pass: true, note: "no executable lines" };
  }
  return judge(file, await ownLcov(file));
}

// Files named on the command line replace the list. The gate's own test uses this.
const listed = process.argv.slice(2);
const results = await Promise.all(
  uniqueFiles(listed.length > 0 ? listed : PURE_FILES).map(check),
);
for (const result of results) console.log(formatLine(result));
process.exit(results.every((r) => r.pass) ? 0 : 1);

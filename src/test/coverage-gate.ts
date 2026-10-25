/**
 * The coverage gate. For each pure file it runs the file's own test alone with
 * coverage on, and judges only that file's lines. Exits 1 when any file fails.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatLine, judge, ownTestPath, uniqueFiles } from "./coverage-report";
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

const results = await Promise.all(
  uniqueFiles(PURE_FILES).map(async (file) => judge(file, await ownLcov(file))),
);
for (const result of results) console.log(formatLine(result));
process.exit(results.every((r) => r.pass) ? 0 : 1);

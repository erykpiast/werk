// The pure half of the per-file coverage check: #werk-test-pure-list, #werk-reflink-own-test-coverage.
// The half that runs the tests and reads files is coverage-gate.ts.

export type LineRecord = { found: number; hit: number };

export type Result = { file: string; percent: number; pass: boolean; reason: string | undefined };

/** The list of pure files is a set: one path per line, `#` starts a comment (#werk-test-pure-list-union). */
export function parsePureList(text: string): string[] {
  const files = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  return [...new Set(files)];
}

/** A pure file's own test file sits beside it, with `.test` before the extension. */
export function ownTestFile(file: string): string {
  return file.replace(/(\.[^./]+)$/, ".test$1");
}

/** Reads the lines found and hit of each source file in an lcov report. */
export function parseLcov(text: string): Map<string, LineRecord> {
  const records = new Map<string, LineRecord>();
  let file: string | undefined;
  let record: LineRecord = { found: 0, hit: 0 };
  for (const line of text.split("\n")) {
    if (line.startsWith("SF:")) {
      file = line.slice(3).trim();
      record = { found: 0, hit: 0 };
    } else if (line.startsWith("LF:")) {
      record.found = Number(line.slice(3));
    } else if (line.startsWith("LH:")) {
      record.hit = Number(line.slice(3));
    } else if (line.trim() === "end_of_record" && file !== undefined) {
      records.set(file, record);
      file = undefined;
    }
  }
  return records;
}

export function lineCoverage(record: LineRecord): number {
  return record.found === 0 ? 100 : (record.hit / record.found) * 100;
}

export function judge(input: {
  file: string;
  testFile: string;
  threshold: number;
  executable: boolean;
  hasOwnTest: boolean;
  testsFailed?: boolean;
  record: LineRecord | undefined;
}): Result {
  const { file, testFile, threshold } = input;
  if (!input.executable) return { file, percent: 100, pass: true, reason: "no executable lines" };
  if (!input.hasOwnTest) return { file, percent: 0, pass: false, reason: `missing own test file ${testFile}` };
  if (input.record === undefined) return { file, percent: 0, pass: false, reason: `${testFile} never loads it` };
  const percent = lineCoverage(input.record);
  if (input.testsFailed) return { file, percent, pass: false, reason: `${testFile} fails` };
  return { file, percent, pass: percent >= threshold, reason: undefined };
}

export function formatResult(result: Result): string {
  const verdict = (result.pass ? "ok" : "FAIL").padEnd(4);
  const percent = `${result.percent.toFixed(2)}%`.padStart(7);
  const reason = result.reason === undefined ? "" : `  (${result.reason})`;
  return `${verdict}  ${percent}  ${result.file}${reason}`;
}

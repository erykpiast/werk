/** The line threshold, in percent, that each pure file must reach. */
export const THRESHOLD = 90;

export type FileResult = {
  file: string;
  percent: number;
  pass: boolean;
  note?: string;
};

/** The own test file of a pure file: beside it, with .test before the extension. */
export function ownTestPath(file: string): string {
  const dot = file.lastIndexOf(".");
  const slash = file.lastIndexOf("/");
  if (dot <= slash) return `${file}.test`;
  return `${file.slice(0, dot)}.test${file.slice(dot)}`;
}

/** Whether source code has any statement that runs: types, interfaces and bare exports do not. */
export function hasExecutableCode(source: string): boolean {
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
  return (
    js
      .replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")
      .replace(/\bexport\s*\{\s*\}\s*;?/g, "")
      .trim() !== ""
  );
}

/** The pure files with each file once, in the order of its first entry. */
export function uniqueFiles(files: readonly string[]): string[] {
  return [...new Set(files)];
}

/** Line counts of one file from an lcov report. Null when the report has no record of it. */
export function lineCounts(
  lcov: string,
  file: string,
): { found: number; hit: number } | null {
  let current: string | null = null;
  let found = 0;
  let hit = 0;
  let seen = false;
  for (const raw of lcov.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      current = line.slice(3);
    } else if (line === "end_of_record") {
      current = null;
    } else if (line.startsWith("DA:") && current !== null) {
      if (current !== file && !current.endsWith(`/${file}`)) continue;
      seen = true;
      found += 1;
      const count = Number(line.slice(3).split(",")[1]);
      if (count > 0) hit += 1;
    } else if (line.startsWith("LF:") && current !== null) {
      if (current === file || current.endsWith(`/${file}`)) seen = true;
    }
  }
  return seen ? { found, hit } : null;
}

/** The verdict for one pure file, from the lcov of its own test run. Null lcov means no own test file. */
export function judge(file: string, lcov: string | null): FileResult {
  if (lcov === null) {
    return {
      file,
      percent: 0,
      pass: false,
      note: `missing test file ${ownTestPath(file)}`,
    };
  }
  const counts = lineCounts(lcov, file);
  if (counts === null || counts.found === 0) {
    if (counts === null) {
      return {
        file,
        percent: 0,
        pass: false,
        note: `own test ${ownTestPath(file)} does not load the file`,
      };
    }
    return { file, percent: 100, pass: true, note: "no executable lines" };
  }
  const percent = (counts.hit / counts.found) * 100;
  return { file, percent, pass: percent >= THRESHOLD };
}

/** One output line per file. */
export function formatLine(result: FileResult): string {
  const mark = result.pass ? "ok  " : "FAIL";
  const note = result.note ? `  (${result.note})` : "";
  return `${mark} ${result.percent.toFixed(1).padStart(5)}%  ${result.file}${note}`;
}

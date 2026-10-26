/**
 * The coverage gate, as pure functions: lcov text in, a verdict out. See #werk-test-scope:
 * pure files get a number, I/O files get named behaviours instead.
 */

export type FileCoverage = { linesFound: number; linesHit: number }

export type GateRow = { file: string; percent: number | undefined; ok: boolean }

export type GateResult = { ok: boolean; rows: GateRow[] }

/** Reads the line counts of each file from an lcov report. */
export function parseLcov(text: string): Map<string, FileCoverage> {
  const files = new Map<string, FileCoverage>()
  let file: string | undefined
  let found = 0
  let hit = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('SF:')) {
      file = line.slice(3)
      found = 0
      hit = 0
    } else if (line.startsWith('LF:')) found = Number(line.slice(3))
    else if (line.startsWith('LH:')) hit = Number(line.slice(3))
    else if (line === 'end_of_record' && file !== undefined) {
      files.set(file, { linesFound: found, linesHit: hit })
      file = undefined
    }
  }
  return files
}

/** The share of lines hit, in percent. A file with no lines counts as fully covered. */
export function percent({ linesFound, linesHit }: FileCoverage): number {
  return linesFound === 0 ? 100 : (linesHit / linesFound) * 100
}

/**
 * Checks every listed file against the threshold. A listed file that is missing from the
 * report fails: no test loaded it, so its coverage is unknown.
 */
export function checkGate(report: Map<string, FileCoverage>, files: readonly string[], threshold: number): GateResult {
  const rows = files.map((file): GateRow => {
    const coverage = report.get(file)
    if (!coverage) return { file, percent: undefined, ok: false }
    const value = percent(coverage)
    return { file, percent: value, ok: value >= threshold }
  })
  return { ok: rows.every((row) => row.ok), rows }
}

export function formatGate(result: GateResult, threshold: number): string {
  const lines = result.rows.map((row) => {
    const value = row.percent === undefined ? 'not in the report' : `${row.percent.toFixed(2)}%`
    return `${row.ok ? 'ok  ' : 'FAIL'}  ${row.file}  ${value}`
  })
  const verdict = result.ok
    ? `coverage gate passed: every pure file is at or over ${threshold}%`
    : `coverage gate failed: ${result.rows.filter((row) => !row.ok).length} pure file(s) under ${threshold}%`
  return [...lines, verdict].join('\n')
}

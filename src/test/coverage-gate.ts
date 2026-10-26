#!/usr/bin/env bun
/**
 * The 90% line gate, per pure file. See #werk-test-scope and #werk-test-scope-src0-pure-scope.
 *
 * Bun's own `coverageThreshold` is one number over every file a test loads. That prices an
 * I/O line the same as a pure one — the exact thing #werk-test-scope:opt0 lost on. So this
 * judges only the files on the list of pure files (pure-files.txt), each on its own.
 *
 * #werk-reflink-own-test-coverage: a line counts only when the file's own test file runs it.
 * The own test file of `src/x.ts` is `src/x.test.ts`, and of `web/x.js` it is `src/x.test.ts`.
 * Each own test file runs alone with coverage on, and only the record of its pure file is
 * kept. The records join into one report, and the check reads that report. A pure file with
 * no own test file is 0%, and the check names the missing file.
 *
 * The ordinary `bun test` still runs the whole suite. This runs one coverage pass per pure file.
 *
 * Usage: bun src/test/coverage-gate.ts
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

const THRESHOLD = 90
const LIST = join(dirname(new URL(import.meta.url).pathname), 'pure-files.txt')

/** The pure files, from the list's text. One path per line; `#` starts a comment. The list
 *  is a set (#werk-test-pure-list-union): a repeat counts once, and the order is kept only
 *  so the output reads in the list's order. */
export function parsePureList(text: string): string[] {
  const out = new Set<string>()
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim()
    if (line) out.add(line)
  }
  return [...out]
}

export const PURE = parsePureList(readFileSync(LIST, 'utf8'))

/** The one test file a pure file owns, by the project's naming convention. */
export function ownTestFile(file: string): string {
  const name = basename(file).replace(/\.[jt]sx?$/, '')
  const dir = file.startsWith('web/') ? 'src' : dirname(file)
  return `${dir}/${name}.test.ts`
}

/** Lines found and lines hit, per source file, from an lcov report. */
export function parseLcov(text: string): Map<string, { found: number; hit: number }> {
  const out = new Map<string, { found: number; hit: number }>()
  for (const [file, record] of lcovRecords(text)) {
    const found = Number(record.match(/^LF:(\d+)$/m)?.[1] ?? 0)
    const hit = Number(record.match(/^LH:(\d+)$/m)?.[1] ?? 0)
    out.set(file, { found, hit })
  }
  return out
}

/** Each record of an lcov report, by its source file, with its text up to `end_of_record`. */
export function lcovRecords(text: string): Map<string, string> {
  const out = new Map<string, string>()
  let file: string | null = null
  let lines: string[] = []
  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) {
      file = line.slice(3).trim()
      lines = [line]
    } else if (file) {
      lines.push(line)
      if (line.trim() === 'end_of_record') {
        out.set(file, `${lines.join('\n')}\n`)
        file = null
      }
    }
  }
  return out
}

export type Verdict = { file: string; pct: number; ok: boolean; detail: string }

/** Judge each pure file against the threshold, from the joined report of own-test runs.
 *  `missing` holds the pure files that have no own test file. */
export function judge(files: string[], report: Map<string, { found: number; hit: number }>, missing: Set<string>): Verdict[] {
  return files.map((file) => {
    if (missing.has(file)) return { file, pct: 0, ok: false, detail: `no own test file: ${ownTestFile(file)} is missing` }
    const r = report.get(file)
    const pct = r && r.found > 0 ? (100 * r.hit) / r.found : 0
    const detail = r ? `${r.hit}/${r.found} lines from ${ownTestFile(file)}` : `${ownTestFile(file)} does not load this file`
    return { file, pct, ok: pct >= THRESHOLD, detail }
  })
}

if (import.meta.main) {
  const scratch = mkdtempSync(join(tmpdir(), 'werk-cov-'))
  const missing = new Set<string>()
  const failedRuns: string[] = []
  let joined = ''
  for (const [i, file] of PURE.entries()) {
    const own = ownTestFile(file)
    if (!existsSync(own)) {
      missing.add(file)
      continue
    }
    const dir = join(scratch, String(i))
    const run = Bun.spawnSync(['bun', 'test', own, '--coverage', '--coverage-reporter=lcov', `--coverage-dir=${dir}`], {
      stdout: 'ignore',
      stderr: 'pipe',
      env: { ...process.env, CI: 'true' },
    })
    if (run.exitCode !== 0) failedRuns.push(own)
    const lcov = join(dir, 'lcov.info')
    const record = existsSync(lcov) ? lcovRecords(readFileSync(lcov, 'utf8')).get(file) : undefined
    if (record) joined += record
  }
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync('coverage', { recursive: true })
  writeFileSync('coverage/pure-lcov.info', joined)

  const verdicts = judge(PURE, parseLcov(joined), missing)
  console.log(`\npure-code line gate, ${THRESHOLD}% per file, own test file only`)
  for (const v of verdicts) console.log(`  ${v.ok ? 'ok  ' : 'FAIL'}  ${v.pct.toFixed(1).padStart(5)}%  ${v.file}  (${v.detail})`)
  for (const own of failedRuns) console.error(`coverage-gate: ${own} failed when run alone`)
  const failed = verdicts.filter((v) => !v.ok).length
  if (failed || failedRuns.length) {
    console.error(`coverage-gate: ${failed} pure file(s) under ${THRESHOLD}%`)
    process.exit(1)
  }
  console.log(`coverage-gate: all ${PURE.length} pure files at ${THRESHOLD}% or more`)
}

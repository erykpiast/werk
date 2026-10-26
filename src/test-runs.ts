/**
 * The record of unit test runs, for the Measure tab's test panel (#vi-flow-ms-tests). A run of
 * the unit tests leaves a junit report; this folds it into one line per run — how many tests
 * ran and which failed — and appends that line to a log beside the pipeline log. Pure parsing
 * and one append, so the recorder script and the server share them.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { paths } from './project.ts'

/** One test that failed in a run. `timeout` is true when the runner's own time limit ended it,
 *  or the message says a time limit was reached. */
export type FailedTest = { name: string; file: string; ms: number; timeout: boolean; message: string }

/** One run of the unit tests: when it ended, how many tests ran, and the ones that failed. */
export type TestRun = { at: string; tests: number; failed: FailedTest[] }

const unescapeXml = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)
  return m ? unescapeXml(m[1]) : ''
}

const TIMEOUT_TEXT = /timed out|time limit|timeout|wall-clock cap|no event for \d+ms/i

/** Fold one junit report into a run. A test counts as failed when its case holds a failure. */
export function parseJunit(xml: string, at: string): TestRun {
  let tests = 0
  const failed: FailedTest[] = []
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    tests++
    const body = m[3] ?? ''
    const f = /<failure\b([^>]*?)(\/>|>)/.exec(body)
    if (!f) continue
    const message = attr(f[1], 'message') || unescapeXml(body.replace(/<[^>]+>/g, ''))
    failed.push({
      name: attr(m[1], 'name'),
      file: attr(m[1], 'file'),
      ms: Math.round(Number(attr(m[1], 'time')) * 1000),
      timeout: attr(f[1], 'type') === 'TimeoutError' || TIMEOUT_TEXT.test(message),
      message: message.split('\n').find((l) => l.trim())?.slice(0, 240) ?? '',
    })
  }
  return { at, tests, failed }
}

export function appendRun(run: TestRun, path = paths.testRuns) {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, JSON.stringify(run) + '\n')
}

/** Every recorded run, oldest first. A line that does not parse is skipped, not fatal. */
export function readTestRuns(path = paths.testRuns): TestRun[] {
  if (!existsSync(path)) return []
  const out: TestRun[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as TestRun)
    } catch {
      /* a half-written line */
    }
  }
  return out
}

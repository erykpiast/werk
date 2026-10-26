/**
 * The fail report over the builder loop's passes — #ms-fail. Pure: the caller folds the passes
 * from the pipeline log, this turns them into each fail's gate and cause and the numbers
 * derived from them.
 */
import type { Cause, GateDetail } from './build-prompt.ts'
import type { PassFacts } from './pipeline.ts'

/** The facts of one pass that the report reads. */
export type FailInput = Pick<PassFacts, 'ticket' | 'loopRun' | 'pass' | 'at' | 'green' | 'cap' | 'gate' | 'flaky' | 'flakyChecks' | 'infra' | 'causeOfLast' | 'gateOfLast' | 'failure'>

/** `at` is when the failed pass ran, so a view can window the fails. */
export type Fail = { ticket: string; loopRun: string; pass: number; at: string; keys: string[]; cause: Cause; why?: string }

export type GateRow = { key: string; total: number; causes: Partial<Record<Cause, number>> }

export type FailReport = {
  /** Loop runs: one build of one ticket. A ticket the merge loop sends back builds twice. */
  builds: number
  passes: number
  firstPassGreen: number
  capHit: number
  passesPerBuild: { median: number; p90: number; max: number }
  fails: Fail[]
  byGate: GateRow[]
  byCause: Partial<Record<Cause, number>>
  signals: string[]
}

/** The first guesses of #ms-fail, until data shows which are noisy. */
export const THRESHOLDS = { capHitShare: 0.1, capHitMinBuilds: 10, streak: 3, falseShare: 0.2, falseMinFails: 5 }

/** One gate can fail on several things at once: each card a grader failed, each review area
 *  and severity. Each is its own key, so the report counts what failed, not only where. */
export function gateKeys(g: GateDetail): string[] {
  switch (g.gate) {
    case 'check':
    case 'merge':
    case 'step':
      return [`${g.gate}: ${g.name}`]
    case 'grader':
      return g.cards.length ? [...new Set(g.cards.map((c) => `grader: #${c}`))] : ['grader']
    case 'review':
      return g.findings.length ? [...new Set(g.findings.map((f) => `review: ${f.area} ${f.severity}`))] : ['review']
    case 'looping':
    case 'silence':
    case 'died':
      return [g.gate]
  }
}

const rank = (sorted: number[], q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] : 0)

const pct = (n: number, d: number) => `${Math.round((100 * n) / d)}%`

export function failReport(records: FailInput[]): FailReport {
  const builds = new Map<string, FailInput[]>()
  for (const r of records) builds.set(r.loopRun, [...(builds.get(r.loopRun) ?? []), r])
  for (const list of builds.values()) list.sort((a, b) => a.pass - b.pass)
  const ordered = [...builds.entries()].sort(([, a], [, b]) => a[0].at.localeCompare(b[0].at))

  const fails: Fail[] = []
  let firstPassGreen = 0
  let capHit = 0
  for (const [loopRun, list] of ordered) {
    const first = list[0]
    if (first.pass === 1 && first.green && !first.gateOfLast) firstPassGreen++
    const last = list.at(-1)!
    if (!last.green && last.cap !== undefined && last.pass >= last.cap) capHit++
    // A sent-back build starts after a red merge, recorded on its first pass.
    if (first.pass === 1 && first.gateOfLast) {
      fails.push({ ticket: first.ticket, loopRun, pass: 0, at: first.at, keys: gateKeys(first.gateOfLast), cause: first.causeOfLast?.cause ?? 'unknown', why: first.causeOfLast?.why })
    }
    for (const r of list) {
      // #ms-fail-cause: a flaky check does not fail its pass, green or red, but it is counted.
      for (const cmd of r.flakyChecks ?? []) fails.push({ ticket: r.ticket, loopRun, pass: r.pass, at: r.at, keys: [`check: ${cmd}`], cause: 'flaky-check' })
      if (r.green) continue
      const next = list.find((n) => n.pass === r.pass + 1)
      const keys = r.gate ? gateKeys(r.gate) : [r.failure ?? 'unknown']
      if (r.infra) fails.push({ ticket: r.ticket, loopRun, pass: r.pass, at: r.at, keys, cause: 'check-infra', why: r.infra })
      else if (r.flaky) fails.push({ ticket: r.ticket, loopRun, pass: r.pass, at: r.at, keys, cause: 'flaky-check' })
      else fails.push({ ticket: r.ticket, loopRun, pass: r.pass, at: r.at, keys, cause: next?.causeOfLast?.cause ?? 'unknown', why: next?.causeOfLast?.why })
    }
  }

  const rows = new Map<string, GateRow>()
  const byCause: Partial<Record<Cause, number>> = {}
  for (const f of fails) {
    byCause[f.cause] = (byCause[f.cause] ?? 0) + 1
    for (const key of f.keys) {
      const row = rows.get(key) ?? { key, total: 0, causes: {} }
      row.total++
      row.causes[f.cause] = (row.causes[f.cause] ?? 0) + 1
      rows.set(key, row)
    }
  }
  const byGate = [...rows.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))

  const counts = ordered.map(([, list]) => list.length).sort((a, b) => a - b)
  const signals: string[] = []
  const n = ordered.length
  if (n >= THRESHOLDS.capHitMinBuilds && capHit / n > THRESHOLDS.capHitShare) {
    signals.push(`${capHit} of ${n} builds (${pct(capHit, n)}) reached the retry cap, above ${pct(THRESHOLDS.capHitShare, 1)}: look at ticket size and spec quality before the builder`)
  }
  // The same key in consecutive builds: it is a candidate for a check or a rubric line.
  const keysOf = ordered.map(([loopRun]) => new Set(fails.filter((f) => f.loopRun === loopRun).flatMap((f) => f.keys)))
  for (const key of rows.keys()) {
    let run = 0
    let best = 0
    for (const s of keysOf) best = Math.max(best, (run = s.has(key) ? run + 1 : 0))
    if (best >= THRESHOLDS.streak) signals.push(`"${key}" failed ${best} builds in a row: make it a check or a rubric line`)
  }
  // A false finding is a judge's fault, so the share is per judge: the grader, each review area.
  const judges = new Map<string, { all: number; false: number }>()
  for (const f of fails) {
    for (const j of new Set(f.keys.filter((k) => k.startsWith('grader') || k.startsWith('review')).map((k) => (k.startsWith('grader') ? 'grader' : k.split(' ').slice(0, 2).join(' '))))) {
      const c = judges.get(j) ?? { all: 0, false: 0 }
      c.all++
      if (f.cause === 'false-finding') c.false++
      judges.set(j, c)
    }
  }
  for (const [j, c] of judges) {
    if (c.all >= THRESHOLDS.falseMinFails && c.false / c.all > THRESHOLDS.falseShare) {
      signals.push(`${j}: ${c.false} of ${c.all} fails (${pct(c.false, c.all)}) were false findings, above ${pct(THRESHOLDS.falseShare, 1)}: its prompt needs a fix`)
    }
  }

  // Any fail where the check, not the code, was at fault is a fix to that check.
  for (const row of byGate) {
    const bad = (row.causes['flaky-check'] ?? 0) + (row.causes['check-infra'] ?? 0)
    if (bad) signals.push(`"${row.key}": ${bad} fails were flaky or check infra, not the code: fix the check, not the builder`)
  }

  return {
    builds: n,
    passes: records.length,
    firstPassGreen,
    capHit,
    passesPerBuild: { median: rank(counts, 0.5), p90: rank(counts, 0.9), max: counts.at(-1) ?? 0 },
    fails,
    byGate,
    byCause,
    signals,
  }
}

const CAUSE_ORDER: Cause[] = ['builder-error', 'spec-gap', 'false-finding', 'test-wrong', 'flaky-check', 'check-infra', 'conflict', 'unknown']

export function renderFailReport(r: FailReport): string[] {
  if (r.builds === 0) return ['No builder loop records yet.']
  const causes = (c: Partial<Record<Cause, number>>) =>
    CAUSE_ORDER.filter((k) => c[k])
      .map((k) => `${k} ${c[k]}`)
      .join(', ')
  const width = Math.max(...r.byGate.map((g) => g.key.length), 4)
  return [
    `${r.passes} passes over ${r.builds} builds`,
    `first pass green: ${r.firstPassGreen} of ${r.builds} (${pct(r.firstPassGreen, r.builds)})`,
    `retry cap reached: ${r.capHit} of ${r.builds} (${pct(r.capHit, r.builds)})`,
    `passes per build: median ${r.passesPerBuild.median}, p90 ${r.passesPerBuild.p90}, max ${r.passesPerBuild.max}`,
    '',
    `${r.fails.length} fails by cause: ${causes(r.byCause) || 'none'}`,
    ...(r.byGate.length ? ['', 'fails by gate:', ...r.byGate.map((g) => `  ${g.key.padEnd(width)}  ${g.total}  (${causes(g.causes)})`)] : []),
    ...(r.signals.length ? ['', 'signals:', ...r.signals.map((s) => `  ! ${s}`)] : []),
  ]
}
